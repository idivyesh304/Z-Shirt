-- =====================================================================
-- Z-SHIRTS · Phase 5 · first-login welcome, more celebration moments,
-- demand + best-seller insights
-- Run after 001-007.
-- =====================================================================

alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in
  ('order', 'payment', 'status', 'service', 'approval', 'milestone', 'stock', 'sale', 'dispatch', 'launch', 'client'));

-- ---------------------------------------------------------------- 1. first-login welcome
alter table members add column if not exists welcomed_at timestamptz;

create or replace function my_welcome() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m members := current_member(); r jsonb;
begin
  if m.id is null then return null; end if;
  select jsonb_build_object(
    'name', m.name, 'role', m.role, 'welcomed_at', m.welcomed_at,
    'partner_no', (select z.n from (select x.id, row_number() over (order by x.created_at, x.name) as n from members x where x.role = 'partner' and x.active) z where z.id = m.id),
    'partners', (select jsonb_agg(x.name order by x.name) from members x where x.role = 'partner' and x.active),
    'employee', (select string_agg(x.name, ', ') from members x where x.role = 'employee' and x.active),
    'capital', case when m.role = 'partner' then (select coalesce(sum(amount), 0) from ledger where partner_id = m.id and kind = 'capital_in') end,
    'total_capital', case when m.role = 'partner' then (select coalesce(sum(amount), 0) from ledger where kind = 'capital_in') end,
    'products', (select count(*) from products where published_at is not null and active),
    'orders', (select count(*) from orders where status <> 'cancelled'),
    'shift', case when m.role = 'employee' then hr_policy() end)
  into r;
  return r;
end $$;

create or replace function mark_welcomed() returns void
language plpgsql security definer set search_path = public as $$
begin
  if (current_member()).id is null then return; end if;
  perform set_config('zs.internal', 'on', true);
  update members set welcomed_at = now() where id = (current_member()).id and welcomed_at is null;
end $$;

-- ---------------------------------------------------------------- 2. moments: offline sale, dispatch, new product, new customer
create or replace function staff_create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                                   p_discount_pct numeric default 0, p_note text default null,
                                   p_coupon text default null, p_sold_by uuid default null,
                                   p_sold_by_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  o orders;
  v_paid boolean;
  v_here boolean := is_in_person(p_channel);
  v_who text;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_channel not in ('store', 'event', 'stall', 'instagram', 'whatsapp', 'referral', 'influencer') then
    raise exception 'Choose where this sale happened.';
  end if;
  if v_here and p_method not in ('cash', 'upi') then raise exception 'In-person sales are paid by cash or UPI.'; end if;
  if not v_here and p_method not in ('upi', 'cod') then raise exception 'Choose prepaid (UPI) or cash on delivery.'; end if;
  if coalesce(p_discount_pct, 0) < 0 or coalesce(p_discount_pct, 0) > coalesce(setting_num('max_store_discount_pct'), 0) then
    raise exception 'Discount can be at most %', setting_num('max_store_discount_pct') || '%.';
  end if;
  if p_sold_by is not null and not exists (select 1 from members where id = p_sold_by and active) then
    raise exception 'Choose who made this sale.';
  end if;

  o := _create_order(p_channel, p_customer, p_items, p_method, m.id,
                     jsonb_build_object('discount_pct', coalesce(p_discount_pct, 0), 'coupon', p_coupon,
                                        'sold_by', p_sold_by, 'sold_by_name', p_sold_by_name));
  v_paid := p_method in ('cash', 'upi');

  perform set_config('zs.internal', 'on', true);
  update orders set
    payment_status = case when v_paid then 'paid' else 'pending' end,
    status = case when v_here then 'delivered' else 'confirmed' end,
    delivered_at = case when v_here then now() end,
    note = nullif(trim(coalesce(p_note, '')), '')
  where id = o.id returning * into o;
  v_who := coalesce((select name from members where id = o.sold_by), o.sold_by_name, m.name);
  perform _event(o.id, o.status, case when v_here then 'Sold at ' || lower(channel_label(p_channel)) || ' · ' || upper(p_method) || ' · by ' || v_who
                                      else 'Confirmed by ' || m.name || ' · sold by ' || v_who end);
  if v_paid then perform _post_sale(o.id); end if;
  if o.status = 'delivered' and o.payment_status = 'paid' then perform _earn_points(o.id); end if;
  perform _notify(case when v_here then 'sale' else 'order' end,
    case when v_here then channel_label(p_channel) || ' sale' else 'New ' || channel_label(p_channel) || ' order' end
      || case when v_paid then ' · Paid' else ' · COD' end,
    o.customer_name || ' · ' || o.order_no || ' · by ' || v_who, o.id, o.total, true);
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'id', o.id);
end $$;

create or replace function moments_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_real boolean; v_was boolean;
begin
  -- dispatched
  if tg_op = 'UPDATE' and new.status = 'shipped' and old.status is distinct from 'shipped' then
    perform _notify('dispatch', 'Dispatched · ' || new.order_no,
      new.customer_name || coalesce(' · ' || nullif(new.address->>'city', ''), '') || coalesce(' · ' || new.courier, ''), new.id, new.total, true);
  end if;
  -- a new customer: first real order from this phone
  v_real := new.status <> 'cancelled' and not (new.payment_method = 'online' and new.payment_status <> 'paid');
  v_was := tg_op = 'UPDATE' and old.status <> 'cancelled' and not (old.payment_method = 'online' and old.payment_status <> 'paid');
  if v_real and not v_was and new.customer_phone is not null
     and not exists (select 1 from orders o where o.customer_phone = new.customer_phone and o.id <> new.id and o.status <> 'cancelled'
                     and not (o.payment_method = 'online' and o.payment_status <> 'paid')) then
    perform _notify('client', 'New customer · ' || new.customer_name,
      'First order from ' || coalesce(nullif(new.address->>'city', ''), channel_label(new.channel)) || ' · ' || new.order_no, new.id, new.total, true);
  end if;
  return null;
end $$;
create trigger orders_moments after insert or update on orders for each row execute function moments_on_order();

create or replace function moments_on_product() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published_at is not null and (tg_op = 'INSERT' or old.published_at is null) then
    perform _notify('launch', 'New product live · ' || new.name,
      case when new.drop_at is not null and new.drop_at > now() then 'Drops ' || to_char(new.drop_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') else 'Now in the shop' end,
      null, new.price, true);
  end if;
  return null;
end $$;
create trigger products_moments after insert or update of published_at on products for each row execute function moments_on_product();

-- ---------------------------------------------------------------- 3. demand + best sellers
-- p_days: 7 = this week, 15, 30 = this month. Counts paid / COD orders that were not cancelled or returned.
create or replace function demand_report(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1)); r jsonb;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  with lines as (
    select i.qty, i.line_total, pv.id as variant_id, pv.colour, pv.colour_hex, pv.size, p.id as product_id, p.name, c.name as category, o.id as order_id
    from order_items i join orders o on o.id = i.order_id
    join product_variants pv on pv.id = i.variant_id join products p on p.id = pv.product_id
    left join categories c on c.id = p.category_id
    where o.created_at >= v_from and o.status not in ('cancelled', 'rto', 'returned')
      and not (o.payment_method = 'online' and o.payment_status <> 'paid')
  ), waiting as (
    select pv.product_id, pv.colour, pv.size, count(*) as n
    from restock_requests rr join product_variants pv on pv.id = rr.variant_id where rr.notified_at is null group by 1, 2, 3
  ), stock as (
    select pv.product_id, sum(greatest(stock_of(pv.id), 0)) as pcs from product_variants pv where pv.active group by 1
  )
  select jsonb_build_object(
    'days', p_days,
    'pieces', (select coalesce(sum(qty), 0) from lines),
    'products', coalesce((select jsonb_agg(x order by x.units desc, x.revenue desc) from (
        select l.product_id, l.name, l.category, sum(l.qty) as units, sum(l.line_total) as revenue, count(distinct l.order_id) as orders,
               coalesce((select pcs from stock s where s.product_id = l.product_id), 0) as stock_left,
               coalesce((select sum(n) from waiting w where w.product_id = l.product_id), 0) as waiting,
               (select jsonb_agg(z order by z.u desc) from (select l2.colour as c, sum(l2.qty) as u from lines l2 where l2.product_id = l.product_id group by 1) z) as by_colour
        from lines l group by l.product_id, l.name, l.category) x), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(x order by x.units desc) from (
        select coalesce(category, 'Other') as name, sum(qty) as units, sum(line_total) as revenue from lines group by 1) x), '[]'::jsonb),
    'colours', coalesce((select jsonb_agg(x order by x.units desc) from (
        select initcap(colour) as name, max(colour_hex) as hex, sum(qty) as units from lines group by 1) x), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(x order by x.units desc) from (
        select size as name, sum(qty) as units from lines group by 1) x), '[]'::jsonb),
    'wanted', coalesce((select jsonb_agg(x order by x.n desc) from (
        select p.name, w.colour, w.size, w.n from waiting w join products p on p.id = w.product_id) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function my_welcome(), mark_welcomed(), demand_report(int) from public, anon;
grant execute on function my_welcome(), mark_welcomed(), demand_report(int) to authenticated;
revoke execute on function moments_on_order(), moments_on_product() from public, anon, authenticated;
