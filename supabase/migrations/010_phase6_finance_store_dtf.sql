-- =====================================================================
-- Z-SHIRTS · Phase 6 · DTF print stock, store day (open/close), petty cash,
-- company finance (P&L, EBITDA, EBIT, PBT, PAT, GST)
-- Run after 009.
-- =====================================================================

-- ---------------------------------------------------------------- 1. DTF prints (one design per product)
create table dtf_moves (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id),
  qty         int not null check (qty <> 0),
  reason      text not null check (reason in ('purchase', 'used', 'damaged')),
  batch_id    bigint references production_batches(id),
  cost        numeric(12,2),
  note        text,
  by_member   uuid references members(id),
  at          timestamptz not null default now()
);

create view dtf_stock with (security_invoker = true) as
select p.id as product_id, p.name, sum(d.qty)::int as qty,
       sum(d.qty) filter (where d.reason = 'purchase')::int as bought, -sum(d.qty) filter (where d.reason = 'used')::int as used,
       round(sum(d.cost) filter (where d.reason = 'purchase') / nullif(sum(d.qty) filter (where d.reason = 'purchase'), 0), 2) as cost_per_print
from dtf_moves d join products p on p.id = d.product_id group by p.id, p.name;

create function add_dtf(p_product bigint, p_qty int, p_reason text default 'purchase', p_cost numeric default null, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v int; pn text;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select name into pn from products where id = p_product;
  if pn is null then raise exception 'Choose the tee design.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many prints.'; end if;
  if p_reason not in ('purchase', 'damaged') then raise exception 'Choose bought or damaged.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into dtf_moves (product_id, qty, reason, cost, note, by_member)
  values (p_product, case when p_reason = 'damaged' then -p_qty else p_qty end, p_reason, p_cost, p_note, m.id);
  if p_reason = 'damaged' then
    perform _notify('stock', 'DTF prints damaged: ' || p_qty || ' × ' || pn, coalesce(p_note, '') || ' · by ' || m.name, null, null, false, 'partners');
  end if;
  select coalesce(sum(qty), 0) into v from dtf_moves where product_id = p_product;
  return v;
end $$;

create or replace function set_batch_stage(p_id bigint, p_stage text) returns text
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  b production_batches;
  it jsonb;
  v_qty int := 0;
  v_have int;
  v_cost numeric;
  v_old numeric;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into b from production_batches where id = p_id for update;
  if b.id is null then raise exception 'Batch not found.'; end if;
  if b.stage in ('ready', 'cancelled') then raise exception 'This batch is already %.', b.stage; end if;
  if p_stage not in ('planned', 'blanks', 'printing', 'quality_check', 'ready', 'cancelled') then raise exception 'Unknown stage.'; end if;
  perform set_config('zs.internal', 'on', true);
  -- printing starts: the plain tees leave blank stock (only for colours you track as blanks)
  if p_stage in ('printing', 'quality_check', 'ready') and not exists (select 1 from blank_moves where batch_id = b.id) then
    insert into blank_moves (colour, colour_hex, size, qty, reason, batch_id, note, by_member)
    select initcap(pv.colour), pv.colour_hex, pv.size, -(bi->>'qty')::int, 'used', b.id, 'Batch ' || b.code, m.id
    from jsonb_array_elements(b.items) bi join product_variants pv on pv.id = (bi->>'variant_id')::bigint
    where exists (select 1 from blank_moves bm where lower(bm.colour) = lower(pv.colour) and bm.size = pv.size);
  end if;
  -- DTF prints for this design leave DTF stock at the same time (only if you track DTF for this tee)
  if p_stage in ('printing', 'quality_check', 'ready') and not exists (select 1 from dtf_moves where batch_id = b.id)
     and exists (select 1 from dtf_moves where product_id = b.product_id) then
    insert into dtf_moves (product_id, qty, reason, batch_id, note, by_member)
    select b.product_id, -sum((bi->>'qty')::int), 'used', b.id, 'Batch ' || b.code, m.id from jsonb_array_elements(b.items) bi;
  end if;
  if p_stage = 'ready' then
    select coalesce(sum(greatest(stock_of(pv.id), 0)), 0) into v_have from product_variants pv where pv.product_id = b.product_id;
    for it in select * from jsonb_array_elements(b.items) loop
      insert into stock_moves (variant_id, qty, reason, note, by_member)
      values ((it->>'variant_id')::bigint, (it->>'qty')::int, 'production', 'Batch ' || b.code, m.id);
      v_qty := v_qty + (it->>'qty')::int;
    end loop;
    v_cost := (b.blank_cost + b.print_cost + b.other_cost);
    if v_qty > 0 and v_cost > 0 then
      select cost_price into v_old from products where id = b.product_id;
      update products set cost_price = round((v_old * v_have + v_cost) / (v_have + v_qty), 2) where id = b.product_id;
    end if;
    perform _notify('stock', 'Batch ready: ' || b.code, v_qty || ' pieces added to stock', null, null, true);
  end if;
  update production_batches set stage = p_stage, updated_at = now(),
         ready_at = case when p_stage = 'ready' then now() end where id = b.id;
  return p_stage;
end $$;

-- ---------------------------------------------------------------- 2. store day: opening time, closing time, balances
create table store_days (
  day         date primary key,
  opened_at   timestamptz not null default now(),
  opened_by   uuid references members(id),
  note        text
);

create function store_open(p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); d store_days;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if exists (select 1 from store_days where day = today_ist()) then raise exception 'The store is already open today.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into store_days (day, opened_by, note) values (today_ist(), m.id, nullif(trim(coalesce(p_note, '')), '')) returning * into d;
  perform _notify('status', 'Store opened · ' || to_char(d.opened_at at time zone 'Asia/Kolkata', 'HH12:MI AM'), 'by ' || m.name, null, null, false, 'partners');
  return to_jsonb(d);
end $$;

-- day-by-day store register (partners see money, Mahendra sees times)
create function store_register(p_days int default 14) returns table (
  day date, opened_at timestamptz, opened_by text, closed_at timestamptz, closed_by text,
  opening numeric, cash_sales numeric, upi_sales numeric, handed_over numeric, expected numeric, counted numeric, difference numeric, bills bigint, pieces bigint)
language plpgsql stable security definer set search_path = public as $$
declare p boolean := is_partner();
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  return query
  select d::date,
    sd.opened_at, (select name from members where id = sd.opened_by),
    cc.created_at, (select name from members where id = cc.by_member),
    case when p then coalesce(cc.opening, (select x.counted from cash_closes x where x.day < d::date order by x.day desc limit 1), 0) end,
    case when p then coalesce((select sum(o.total) from orders o where o.channel in ('store', 'event', 'stall') and o.payment_method = 'cash'
       and o.status not in ('cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date = d::date), 0) end,
    case when p then coalesce((select sum(o.total) from orders o where o.channel in ('store', 'event', 'stall') and o.payment_method = 'upi'
       and o.status not in ('cancelled') and (o.created_at at time zone 'Asia/Kolkata')::date = d::date), 0) end,
    case when p then coalesce((select sum(amount) from cash_moves cm where cm.kind = 'handover' and cm.day = d::date), 0) end,
    case when p then cc.expected end, case when p then cc.counted end, case when p then cc.difference end,
    (select count(*) from orders o where o.channel in ('store', 'event', 'stall') and o.status <> 'cancelled' and (o.created_at at time zone 'Asia/Kolkata')::date = d::date),
    (select coalesce(sum(i.qty), 0) from orders o join order_items i on i.order_id = o.id where o.channel in ('store', 'event', 'stall') and o.status <> 'cancelled'
       and (o.created_at at time zone 'Asia/Kolkata')::date = d::date)::bigint
  from generate_series(today_ist() - (greatest(coalesce(p_days, 14), 1) - 1), today_ist(), interval '1 day') d
  left join store_days sd on sd.day = d::date
  left join cash_closes cc on cc.day = d::date
  order by 1 desc;
end $$;

-- ---------------------------------------------------------------- 3. petty cash (separate from the sales drawer)
create table petty_moves (
  id          bigint generated always as identity primary key,
  day         date not null default today_ist(),
  kind        text not null check (kind in ('topup', 'spend', 'return')),
  amount      numeric(12,2) not null check (amount > 0),
  holder      uuid not null references members(id),
  reason      text not null,
  category    text,
  photo_path  text,
  request_id  bigint references requests(id),
  by_member   uuid references members(id),
  created_at  timestamptz not null default now()
);

create function petty_balance_of(p_holder uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case kind when 'topup' then amount else -amount end), 0) from petty_moves where holder = p_holder
$$;

-- a partner gives petty cash to Mahendra (or takes unused petty cash back)
create function petty_topup(p_holder uuid, p_amount numeric, p_note text default null, p_return boolean default false) returns numeric
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); h members;
begin
  if not is_partner() then raise exception 'Only partners give or take back petty cash.'; end if;
  select * into h from members where id = p_holder and active;
  if h.id is null then raise exception 'Choose who holds the petty cash.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if p_return and p_amount > petty_balance_of(h.id) then raise exception 'More than the petty cash left.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into petty_moves (kind, amount, holder, reason, by_member)
  values (case when p_return then 'return' else 'topup' end, p_amount, h.id,
          case when p_return then 'Returned to ' || m.name else 'Given by ' || m.name end || coalesce(' · ' || nullif(trim(p_note), ''), ''), m.id);
  perform _notify('approval', case when p_return then 'Petty cash returned ₹' else 'Petty cash given ₹' end || trim(to_char(p_amount, 'FM99,99,990')),
    case when p_return then h.name || ' returned it to ' || m.name else m.name || ' gave it to ' || h.name end, null, p_amount, false, 'partners');
  return petty_balance_of(h.id);
end $$;

-- Mahendra spends petty cash: bill photo required; it goes into the books as an expense
create function petty_spend(p_amount numeric, p_reason text, p_category text, p_photo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare m members := current_member(); v_req bigint;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Write what you bought.'; end if;
  if coalesce(trim(p_photo), '') = '' then raise exception 'Add a photo of the bill.'; end if;
  if p_amount > petty_balance_of(m.id) then raise exception 'Not enough petty cash (₹% left). Ask a partner to top it up.', petty_balance_of(m.id); end if;
  if p_amount > coalesce(setting_num('employee_petty_limit'), 0) then raise exception 'Up to ₹% at a time from petty cash. Raise a normal expense for more.', setting_num('employee_petty_limit'); end if;
  v_req := raise_request('expense', p_amount, trim(p_reason) || ' (petty cash)', p_photo, jsonb_build_object('category', coalesce(nullif(p_category, ''), 'other'), 'paid_from', 'petty'));
  perform set_config('zs.internal', 'on', true);
  insert into petty_moves (kind, amount, holder, reason, category, photo_path, request_id, by_member)
  values ('spend', p_amount, m.id, trim(p_reason), nullif(p_category, ''), p_photo, v_req, m.id);
  return petty_balance_of(m.id);
end $$;

create view petty_board with (security_invoker = true) as
select mm.id as holder, mm.name, petty_balance_of(mm.id) as balance,
       (select max(created_at) from petty_moves pm where pm.holder = mm.id) as last_at
from members mm where mm.active and (is_partner() or mm.id = (current_member()).id)
  and exists (select 1 from petty_moves pm where pm.holder = mm.id);

-- ---------------------------------------------------------------- 4. company finance
select set_config('zs.internal', 'on', false);
insert into settings (key, value, label) values
  ('income_tax_rate_pct', '31.2'::jsonb, 'Income tax on profit for the firm (%) — partnership firm 30% + 4% cess')
on conflict (key) do nothing;
select set_config('zs.internal', 'off', false);

-- P&L for any period [p_from, p_to). Sale prices include GST, so GST is taken out first.
create function finance_statement(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sales numeric; v_refunds numeric; v_gst numeric; v_rate numeric; v_income numeric; v_cogs numeric; v_prod numeric;
  v_opex numeric; v_equip numeric; v_interest numeric; v_tax_paid numeric; v_rev numeric; v_gp numeric; v_ebitda numeric;
  v_ebit numeric; v_pbt numeric; v_tax numeric; v_pat numeric; v_cats jsonb; v_cogs_basis text; v_taxrate numeric;
begin
  if not is_partner() then raise exception 'Partners only.'; end if;
  select coalesce(sum(amount), 0) into v_sales from ledger where kind = 'sale' and entry_date >= p_from and entry_date < p_to;
  select coalesce(-sum(amount), 0) into v_refunds from ledger where kind = 'refund' and entry_date >= p_from and entry_date < p_to;
  select coalesce(sum(amount), 0) into v_income from ledger where kind = 'income' and entry_date >= p_from and entry_date < p_to;
  -- weighted GST rate of what was sold (5% for tees up to ₹2,500 a piece)
  select coalesce(sum(i.line_total * p.gst_rate) / nullif(sum(i.line_total), 0), 5) into v_rate
  from ledger l join order_items i on i.order_id = l.order_id join product_variants pv on pv.id = i.variant_id join products p on p.id = pv.product_id
  where l.kind = 'sale' and l.entry_date >= p_from and l.entry_date < p_to;
  v_gst := round((v_sales - v_refunds) * v_rate / (100 + v_rate), 2);
  v_rev := v_sales - v_refunds - v_gst;
  -- cost of the tees sold (from production cost); orders returned later are left out
  select coalesce(sum(i.unit_cost * i.qty), 0) into v_cogs
  from ledger l join orders o on o.id = l.order_id join order_items i on i.order_id = o.id
  where l.kind = 'sale' and l.entry_date >= p_from and l.entry_date < p_to and o.status not in ('returned', 'rto');
  select coalesce(-sum(amount), 0) into v_prod from ledger where kind = 'expense' and category = 'production' and entry_date >= p_from and entry_date < p_to;
  v_cogs_basis := 'cost price';
  if v_cogs = 0 and v_prod > 0 then v_cogs := v_prod; v_cogs_basis := 'production spend'; end if;
  select coalesce(-sum(amount) filter (where coalesce(category, 'other') not in ('production', 'equipment', 'interest', 'tax')), 0),
         coalesce(-sum(amount) filter (where category = 'equipment'), 0),
         coalesce(-sum(amount) filter (where category = 'interest'), 0),
         coalesce(-sum(amount) filter (where category = 'tax'), 0)
    into v_opex, v_equip, v_interest, v_tax_paid
  from ledger where kind = 'expense' and entry_date >= p_from and entry_date < p_to;
  select coalesce(jsonb_object_agg(cat, amt), '{}'::jsonb) into v_cats from (
    select coalesce(category, 'other') as cat, -sum(amount) as amt from ledger
    where kind = 'expense' and entry_date >= p_from and entry_date < p_to group by 1) x;
  v_taxrate := coalesce(setting_num('income_tax_rate_pct'), 31.2);
  v_gp := v_rev - v_cogs;
  v_ebitda := v_gp - v_opex;
  v_ebit := v_ebitda - v_equip;                 -- equipment is written off in the month it is bought
  v_pbt := v_ebit - v_interest + v_income;
  v_tax := round(greatest(v_pbt, 0) * v_taxrate / 100, 2);
  v_pat := v_pbt - v_tax;
  return jsonb_build_object(
    'from', p_from, 'to', p_to - 1,
    'gross_sales', v_sales, 'refunds', v_refunds, 'gst_rate', round(v_rate, 2), 'output_gst', v_gst, 'revenue', v_rev,
    'cogs', v_cogs, 'cogs_basis', v_cogs_basis, 'production_spend', v_prod, 'gross_profit', v_gp,
    'opex', v_opex, 'expenses_by_category', v_cats, 'ebitda', v_ebitda, 'depreciation', v_equip, 'ebit', v_ebit,
    'interest', v_interest, 'other_income', v_income, 'pbt', v_pbt, 'tax_rate', v_taxrate, 'tax', v_tax, 'pat', v_pat,
    'tax_paid', v_tax_paid,
    'gross_margin', case when v_rev > 0 then round(100 * v_gp / v_rev, 1) end,
    'ebitda_margin', case when v_rev > 0 then round(100 * v_ebitda / v_rev, 1) end,
    'ebit_margin', case when v_rev > 0 then round(100 * v_ebit / v_rev, 1) end,
    'net_margin', case when v_rev > 0 then round(100 * v_pat / v_rev, 1) end,
    'orders', (select count(distinct order_id) from ledger where kind = 'sale' and entry_date >= p_from and entry_date < p_to),
    'cash_balance', (select coalesce(sum(amount), 0) from ledger where entry_date < p_to));
end $$;

-- income tax rate can be changed by all partners
create or replace function raise_request(
  p_type        request_type,
  p_amount      numeric,
  p_description text,
  p_proof_path  text  default null,
  p_payload     jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m        members;
  v_req    int;
  v_n      int := partner_count();
  v_petty  numeric := setting_num('employee_petty_limit');
  v_big    numeric := setting_num('all_partner_limit');
  v_id     bigint;
  v_sum    numeric;
  e        ledger;
  pr       products;
  k        text;
begin
  m := current_member();
  if m.id is null then raise exception 'You are not registered as a Z-SHIRTS member.'; end if;
  if m.role = 'employee' and p_type::text not in ('expense', 'income', 'stock_writeoff') then
    raise exception 'Employees can only record expenses, income and damaged stock.';
  end if;
  if month_is_closed(today_ist()) then raise exception 'This month is already closed by all partners.'; end if;
  p_payload := coalesce(p_payload, '{}'::jsonb);

  case p_type::text
    when 'expense' then
      if p_amount is null then raise exception 'Enter the expense amount.'; end if;
      if coalesce(trim(p_proof_path), '') = '' then raise exception 'A photo of the bill is required for every expense.'; end if;
      v_req := case when p_amount <= v_petty then 0 when p_amount <= v_big then least(2, v_n) else v_n end;

    when 'income' then
      if p_amount is null then raise exception 'Enter the amount received.'; end if;
      v_req := least(2, v_n);

    when 'capital_in', 'partner_payout' then
      if p_amount is null then raise exception 'Enter the amount.'; end if;
      if coalesce(trim(p_proof_path), '') = '' then raise exception 'Attach the bank transfer screenshot as proof.'; end if;
      if not exists (select 1 from members where id = (p_payload->>'partner_id')::uuid and role = 'partner' and active) then
        raise exception 'Choose which partner this is for.';
      end if;
      v_req := v_n;

    when 'reversal' then
      select * into e from ledger where id = (p_payload->>'entry_id')::bigint;
      if e.id is null then raise exception 'Entry not found.'; end if;
      if e.reverses_entry is not null then raise exception 'A reversal cannot itself be reversed. Raise a new entry.'; end if;
      if exists (select 1 from ledger where reverses_entry = e.id) then raise exception 'Entry #% has already been reversed.', e.id; end if;
      if exists (select 1 from requests where type = 'reversal' and status = 'pending' and payload->>'entry_id' = e.id::text) then
        raise exception 'A reversal for entry #% is already waiting for approval.', e.id;
      end if;
      p_amount := abs(e.amount);
      v_req := v_n;

    when 'setting_change' then
      k := p_payload->>'key';
      if k not in ('employee_petty_limit', 'all_partner_limit', 'shipping_fee', 'free_shipping_above',
                   'cod_enabled', 'max_store_discount_pct', 'low_stock_alert', 'return_window_days',
                   'loyalty_points_per_100', 'loyalty_max_redeem_pct', 'income_tax_rate_pct') then
        raise exception 'That setting cannot be changed this way.';
      end if;
      if (p_payload->>'value')::numeric is null or (p_payload->>'value')::numeric < 0
         or (k in ('employee_petty_limit', 'all_partner_limit') and (p_payload->>'value')::numeric <= 0) then
        raise exception 'Enter a valid amount.';
      end if;
      if k = 'cod_enabled' and (p_payload->>'value')::numeric not in (0, 1) then raise exception 'Use 1 for on, 0 for off.'; end if;
      if k in ('max_store_discount_pct', 'loyalty_max_redeem_pct') and (p_payload->>'value')::numeric > 90 then raise exception 'That percentage is too high.'; end if;
      if (k = 'employee_petty_limit' and (p_payload->>'value')::numeric >= v_big)
         or (k = 'all_partner_limit' and (p_payload->>'value')::numeric <= v_petty) then
        raise exception 'Employee limit must stay below the all-partner limit (now ₹% and ₹%).', v_petty, v_big;
      end if;
      v_req := v_n;

    when 'share_rule' then
      if p_payload->>'profit_rule' not in ('investment', 'equal', 'custom')
         or p_payload->>'loss_rule' not in ('investment', 'equal', 'custom') then
        raise exception 'Choose equal, investment ratio or custom for both profit and loss.';
      end if;
      if 'custom' in (p_payload->>'profit_rule', p_payload->>'loss_rule') then
        if jsonb_typeof(p_payload->'split') is distinct from 'object' then raise exception 'Enter the percentage for every partner.'; end if;
        if exists (select 1 from members where role = 'partner' and active and not (p_payload->'split' ? id::text)) then
          raise exception 'Enter the percentage for every partner.';
        end if;
        select sum(value::numeric) into v_sum from jsonb_each_text(p_payload->'split');
        if v_sum is distinct from 100 then raise exception 'The custom percentages must add up to 100 (now %).', v_sum; end if;
        if exists (select 1 from jsonb_each_text(p_payload->'split') where value::numeric < 0) then
          raise exception 'Percentages cannot be negative.';
        end if;
      end if;
      v_req := v_n;

    when 'price_change' then
      select * into pr from products where id = (p_payload->>'product_id')::bigint;
      if pr.id is null then raise exception 'Product not found.'; end if;
      if (p_payload->>'price')::numeric is null or (p_payload->>'mrp')::numeric is null
         or (p_payload->>'price')::numeric <= 0 or (p_payload->>'price')::numeric > (p_payload->>'mrp')::numeric then
        raise exception 'Selling price must be above 0 and not more than MRP.';
      end if;
      if exists (select 1 from requests where type::text = 'price_change' and status = 'pending'
                 and payload->>'product_id' = pr.id::text) then
        raise exception 'A price change for this product is already waiting for approval.';
      end if;
      v_req := v_n;

    when 'stock_writeoff' then
      if (p_payload->>'qty')::int is null or (p_payload->>'qty')::int <= 0 then raise exception 'Enter how many pieces.'; end if;
      if stock_of((p_payload->>'variant_id')::bigint) < (p_payload->>'qty')::int then
        raise exception 'Only % in stock.', stock_of((p_payload->>'variant_id')::bigint);
      end if;
      v_req := v_n;

    when 'hr_policy' then
      if jsonb_typeof(p_payload->'policy') is distinct from 'object' then raise exception 'Nothing to change.'; end if;
      if exists (select 1 from jsonb_object_keys(p_payload->'policy') k2
                 where k2 not in ('shift_start', 'shift_end', 'grace_min', 'lates_per_half_day', 'weekly_off', 'paid_leaves_per_month',
                                  'ot_after', 'ot_multiplier', 'office_lat', 'office_lng', 'office_radius_m', 'lunch_min', 'half_day_allowed')) then
        raise exception 'Unknown HR rule.';
      end if;
      v_req := v_n;

    when 'salary_change' then
      if not exists (select 1 from members where id = (p_payload->>'member_id')::uuid and role = 'employee') then raise exception 'Choose the employee.'; end if;
      if (p_payload->>'salary')::numeric is null or (p_payload->>'salary')::numeric < 0 then raise exception 'Enter the monthly salary.'; end if;
      v_req := v_n;

    when 'decision' then
      if coalesce(length(trim(p_description)), 0) < 5 then raise exception 'Describe the decision.'; end if;
      v_req := case when p_payload->>'rule' = 'majority' then (v_n / 2) + 1 else v_n end;

    else
      raise exception 'Unknown request type.';
  end case;

  perform set_config('zs.internal', 'on', true);
  insert into requests (type, amount, description, proof_path, payload, raised_by, required_approvals)
  values (p_type, p_amount, trim(p_description), nullif(trim(p_proof_path), ''), p_payload, m.id, v_req)
  returning id into v_id;

  if m.role = 'partner' and v_req > 0 then
    insert into votes (request_id, member_id, decision, note) values (v_id, m.id, 'approve', 'Raised this request');
  end if;
  perform evaluate_request(v_id);
  return v_id;
end $$;

-- ---------------------------------------------------------------- guards + access
alter table cash_closes add column if not exists closed_note text;
do $$
declare t text;
begin
  foreach t in array array['dtf_moves', 'store_days', 'petty_moves'] loop
    execute format('create trigger %I before insert or update or delete on %I for each row execute function require_internal()', t || '_internal', t);
    execute format('create trigger %I after insert or update on %I for each row execute function write_audit()', 'audit_' || t, t);
    execute format('alter table %I enable row level security', t);
    execute format('create trigger %I before update or delete on %I for each row execute function forbid_change()', t || '_permanent', t);
  end loop;
end $$;
create policy dtf_read    on dtf_moves   for select to authenticated using ((current_member()).id is not null);
create policy sday_read   on store_days  for select to authenticated using ((current_member()).id is not null);
create policy petty_read  on petty_moves for select to authenticated using (is_partner() or holder = (current_member()).id);

revoke all on dtf_moves, dtf_stock, store_days, petty_moves, petty_board from anon;
grant select on dtf_moves, dtf_stock, store_days, petty_moves, petty_board to authenticated;
revoke execute on function add_dtf(bigint, int, text, numeric, text), store_open(text), store_register(int), petty_balance_of(uuid),
  petty_topup(uuid, numeric, text, boolean), petty_spend(numeric, text, text, text), finance_statement(date, date) from public, anon;
grant execute on function add_dtf(bigint, int, text, numeric, text), store_open(text), store_register(int), petty_balance_of(uuid),
  petty_topup(uuid, numeric, text, boolean), petty_spend(numeric, text, text, text), finance_statement(date, date) to authenticated;
