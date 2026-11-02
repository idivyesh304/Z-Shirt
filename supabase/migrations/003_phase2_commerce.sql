-- =====================================================================
-- Z-SHIRTS · Phase 2 · Shop, stock, orders, payments, returns,
--                     notifications, milestones + editable profit split
-- Run after 001 and 002.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Profit / loss sharing: 25% each by default, editable by all partners
-- ---------------------------------------------------------------------
alter type request_type add value if not exists 'price_change';
alter type request_type add value if not exists 'stock_writeoff';

select set_config('zs.internal', 'on', false);

update settings set value = '"equal"'::jsonb, label = 'How profit is shared: equal, investment ratio or custom %'
 where key = 'profit_rule' and value = 'null'::jsonb;
update settings set value = '"equal"'::jsonb, label = 'How loss is shared: equal, investment ratio or custom %'
 where key = 'loss_rule' and value = 'null'::jsonb;

insert into settings (key, value, label) values
  ('custom_split',           '{}'::jsonb, 'Custom % per partner (used when the rule is "custom")'),
  ('shipping_fee',           '0'::jsonb,  'Delivery charge on website orders (₹)'),
  ('free_shipping_above',    '0'::jsonb,  'Free delivery above this order value (₹, 0 = always use the fee)'),
  ('cod_enabled',            '1'::jsonb,  'Cash on delivery on the website (1 = on, 0 = off)'),
  ('max_store_discount_pct', '10'::jsonb, 'Highest discount the team can give on a manual order (%)'),
  ('low_stock_alert',        '5'::jsonb,  'Alert when any size/colour falls to this many pieces'),
  ('return_window_days',     '7'::jsonb,  'Days after delivery a customer can ask for replacement/return')
on conflict (key) do nothing;

select set_config('zs.internal', 'off', false);

-- Ledger learns two new kinds of entry: sales and refunds
alter table ledger drop constraint if exists ledger_kind_check;
alter table ledger add constraint ledger_kind_check
  check (kind in ('capital_in', 'partner_payout', 'expense', 'income', 'sale', 'refund'));

-- ---------------------------------------------------------------------
-- B. Catalogue
-- ---------------------------------------------------------------------
create table categories (
  id      bigint generated always as identity primary key,
  name    text not null unique,
  slug    text not null unique,
  sort    int  not null default 0,
  active  boolean not null default true
);

create table products (
  id            bigint generated always as identity primary key,
  name          text not null,
  slug          text not null unique,
  category_id   bigint references categories(id),
  type          text not null default 'Oversized Tee',
  description   text not null default '',
  fabric        text,
  gsm           int,
  mrp           numeric(10,2) not null check (mrp > 0),
  price         numeric(10,2) not null check (price > 0),
  gst_rate      numeric(5,2)  not null default 5 check (gst_rate between 0 and 28),
  images        text[] not null default '{}',
  tags          text[] not null default '{}',
  featured      boolean not null default false,
  active        boolean not null default true,
  published_at  timestamptz,             -- null = draft, not visible in the shop
  created_by    uuid references members(id),
  created_at    timestamptz not null default now(),
  check (price <= mrp)
);

create table product_variants (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id),
  colour      text not null,
  colour_hex  text not null default '#111111',
  size        text not null,
  sku         text not null unique,
  active      boolean not null default true,
  unique (product_id, colour, size)
);

-- Every piece in or out. Stock = sum of this table. Never edited.
create table stock_moves (
  id          bigint generated always as identity primary key,
  variant_id  bigint not null references product_variants(id),
  qty         int not null check (qty <> 0),
  reason      text not null check (reason in ('opening', 'production', 'sale', 'cancel', 'rto',
                                              'return', 'replacement_out', 'writeoff')),
  order_id    bigint,
  note        text,
  by_member   uuid references members(id),
  created_at  timestamptz not null default now()
);
create index on stock_moves (variant_id);

-- ---------------------------------------------------------------------
-- C. Orders
-- ---------------------------------------------------------------------
create sequence order_no_seq start 1001;

create table orders (
  id                   bigint generated always as identity primary key,
  order_no             text not null unique default ('ZS' || nextval('order_no_seq')),
  channel              text not null check (channel in ('website', 'instagram', 'whatsapp', 'store')),
  status               text not null default 'placed'
                         check (status in ('placed', 'confirmed', 'packed', 'shipped', 'delivered',
                                           'cancelled', 'rto', 'returned')),
  customer_name        text not null,
  customer_phone       text,
  customer_email       text,
  address              jsonb not null default '{}'::jsonb,
  payment_method       text not null check (payment_method in ('online', 'cod', 'cash', 'upi')),
  payment_status       text not null default 'pending' check (payment_status in ('pending', 'paid', 'refunded')),
  mrp_total            numeric(12,2) not null default 0,
  subtotal             numeric(12,2) not null default 0,
  discount             numeric(12,2) not null default 0,
  shipping             numeric(12,2) not null default 0,
  total                numeric(12,2) not null default 0,
  razorpay_order_id    text unique,
  razorpay_payment_id  text unique,
  courier              text,
  tracking_no          text,
  note                 text,
  created_by           uuid references members(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  delivered_at         timestamptz
);
create index on orders (status, created_at desc);
create index on orders (customer_phone);

alter table ledger add column if not exists order_id bigint references orders(id);

create table order_items (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references orders(id),
  variant_id     bigint not null references product_variants(id),
  product_name   text not null,
  variant_label  text not null,
  qty            int not null check (qty > 0),
  mrp            numeric(10,2) not null,
  price          numeric(10,2) not null,
  line_total     numeric(12,2) not null
);

create table order_events (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references orders(id),
  at          timestamptz not null default now(),
  status      text not null,
  note        text,
  actor_name  text
);
create index on order_events (order_id);

create table service_requests (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references orders(id),
  kind        text not null check (kind in ('replacement', 'return')),
  reason      text not null,
  items       jsonb not null,            -- [{order_item_id, qty, new_variant_id?}]
  status      text not null default 'open' check (status in ('open', 'approved', 'rejected', 'completed')),
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table notifications (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  kind      text not null check (kind in ('order', 'payment', 'status', 'service', 'approval', 'milestone', 'stock')),
  audience  text not null default 'all' check (audience in ('all', 'partners')),
  title     text not null,
  body      text,
  order_id  bigint references orders(id),
  amount    numeric(12,2),
  celebrate boolean not null default false
);
create index on notifications (at desc);

-- ---------------------------------------------------------------------
-- D. Guards: permanent history, writes only through functions, audit
-- ---------------------------------------------------------------------
create trigger stock_moves_permanent  before update or delete on stock_moves  for each row execute function forbid_change();
create trigger order_items_permanent  before update or delete on order_items  for each row execute function forbid_change();
create trigger order_events_permanent before update or delete on order_events for each row execute function forbid_change();
create trigger orders_no_delete       before delete on orders                 for each row execute function forbid_change();
create trigger products_no_delete     before delete on products               for each row execute function forbid_change();
create trigger variants_no_delete     before delete on product_variants       for each row execute function forbid_change();
create trigger service_no_delete      before delete on service_requests       for each row execute function forbid_change();
create trigger notif_no_change        before update or delete on notifications for each row execute function forbid_change();

create trigger categories_internal before insert or update on categories       for each row execute function require_internal();
create trigger products_internal   before insert or update on products         for each row execute function require_internal();
create trigger variants_internal   before insert or update on product_variants for each row execute function require_internal();
create trigger stock_internal      before insert on stock_moves                for each row execute function require_internal();
create trigger orders_internal     before insert or update on orders           for each row execute function require_internal();
create trigger items_internal      before insert on order_items                for each row execute function require_internal();
create trigger events_internal     before insert on order_events               for each row execute function require_internal();
create trigger service_internal    before insert or update on service_requests for each row execute function require_internal();
create trigger notif_internal      before insert on notifications              for each row execute function require_internal();

create trigger audit_products   after insert or update on products         for each row execute function write_audit();
create trigger audit_variants   after insert or update on product_variants for each row execute function write_audit();
create trigger audit_categories after insert or update on categories       for each row execute function write_audit();
create trigger audit_stock      after insert on stock_moves                for each row execute function write_audit();
create trigger audit_orders     after insert or update on orders           for each row execute function write_audit();
create trigger audit_service    after insert or update on service_requests for each row execute function write_audit();

-- ---------------------------------------------------------------------
-- E. Helpers
-- ---------------------------------------------------------------------
create function stock_of(p_variant bigint) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::int from stock_moves where variant_id = p_variant
$$;

create function actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from members where auth_user_id = auth.uid()), 'Customer')
$$;

create function phone10(p text) returns text
language sql immutable as $$ select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) $$;

create function slugify(p text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'))
$$;

create function _notify(p_kind text, p_title text, p_body text, p_order bigint default null,
                        p_amount numeric default null, p_celebrate boolean default false,
                        p_audience text default 'all') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('zs.internal', 'on', true);
  insert into notifications (kind, title, body, order_id, amount, celebrate, audience)
  values (p_kind, p_title, p_body, p_order, p_amount, p_celebrate, p_audience);
end $$;

create function _event(p_order bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('zs.internal', 'on', true);
  insert into order_events (order_id, status, note, actor_name) values (p_order, p_status, p_note, actor_name());
end $$;

create function channel_label(p text) returns text
language sql immutable as $$
  select case p when 'website' then 'Website' when 'instagram' then 'Instagram'
                when 'whatsapp' then 'WhatsApp' when 'store' then 'Store' else p end
$$;

-- Records a sale in the books and fires milestone celebrations.
create function _post_sale(p_order bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  v_total_sales numeric;
  v_prev numeric;
  v_orders int;
  m numeric;
begin
  select * into o from orders where id = p_order;
  perform set_config('zs.internal', 'on', true);
  insert into ledger (kind, amount, description, order_id)
  values ('sale', o.total, 'Order ' || o.order_no || ' · ' || channel_label(o.channel), o.id);

  select coalesce(sum(amount), 0) into v_total_sales from ledger where kind = 'sale';
  v_prev := v_total_sales - o.total;
  foreach m in array array[10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000]::numeric[] loop
    if v_prev < m and v_total_sales >= m then
      perform _notify('milestone',
        case when m >= 100000 then '₹' || rtrim(to_char(m / 100000, 'FM999990.##'), '.') || ' lakh in sales!'
             else '₹' || trim(to_char(m, 'FM99,99,999')) || ' in sales!' end,
        'Z-SHIRTS just crossed a new sales milestone.', o.id, m, true);
    end if;
  end loop;

  select count(*) into v_orders from orders where payment_status = 'paid';
  if v_orders = any (array[1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) then
    perform _notify('milestone',
      case when v_orders = 1 then 'FIRST ORDER EVER!' else v_orders || ' paid orders!' end,
      case when v_orders = 1 then 'Day one. ' || o.customer_name || ' is customer number one.'
           else 'Another milestone for Z-SHIRTS.' end,
      o.id, null, true);
  end if;
end $$;

create function _post_refund(p_order bigint, p_amount numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order;
  perform set_config('zs.internal', 'on', true);
  insert into ledger (kind, amount, description, order_id)
  values ('refund', -p_amount, 'Refund · order ' || o.order_no || ' · ' || p_reason, o.id);
end $$;

-- Low-stock alert when a size/colour crosses the limit
create function stock_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_now int := stock_of(new.variant_id);
  v_lim int := coalesce(setting_num('low_stock_alert'), 5)::int;
  v record;
begin
  if new.qty < 0 and v_now <= v_lim and v_now - new.qty > v_lim then
    select p.name, pv.colour, pv.size into v
    from product_variants pv join products p on p.id = pv.product_id where pv.id = new.variant_id;
    perform _notify('stock',
      case when v_now <= 0 then 'Sold out: ' else 'Low stock: ' end || v.name,
      v.colour || ' / ' || v.size || ' · ' || greatest(v_now, 0) || ' left', new.order_id);
  end if;
  return null;
end $$;
create trigger stock_low_alert after insert on stock_moves for each row execute function stock_alert();

-- Partners hear about every new approval request
create function approval_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and new.required_approvals > 0 then
    perform _notify('approval', 'Approval needed: ' || replace(initcap(new.type::text), '_', ' '),
      new.description || coalesce(' · ₹' || trim(to_char(new.amount, 'FM99,99,99,990.00')), ''),
      null, new.amount, false, 'partners');
  end if;
  return null;
end $$;
create trigger requests_alert after insert on requests for each row execute function approval_alert();

-- ---------------------------------------------------------------------
-- F. Catalogue functions (team)
-- ---------------------------------------------------------------------
create function upsert_category(p_name text, p_sort int default 0) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a category name.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into categories (name, slug, sort) values (trim(p_name), slugify(p_name), coalesce(p_sort, 0))
  on conflict (slug) do update set name = excluded.name, sort = excluded.sort, active = true
  returning id into v_id;
  return v_id;
end $$;

-- Create or edit a product with its colours/sizes.
-- p = {id?, name, category_id, type, description, fabric, gsm, mrp, price, gst_rate,
--      images[], tags[], featured, active, publish, variants:[{colour, colour_hex, size}]}
create function upsert_product(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  old products;
  v_id bigint;
  v jsonb;
  v_slug text;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Enter the product name.'; end if;
  if (p->>'mrp')::numeric is null or (p->>'price')::numeric is null then raise exception 'Enter MRP and selling price.'; end if;
  if (p->>'price')::numeric > (p->>'mrp')::numeric then raise exception 'Selling price cannot be more than MRP.'; end if;

  perform set_config('zs.internal', 'on', true);

  if p->>'id' is null then
    v_slug := slugify(p->>'name');
    if exists (select 1 from products where slug = v_slug) then
      v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
    end if;
    insert into products (name, slug, category_id, type, description, fabric, gsm, mrp, price, gst_rate,
                          images, tags, featured, created_by, published_at)
    values (trim(p->>'name'), v_slug, (p->>'category_id')::bigint, coalesce(nullif(p->>'type', ''), 'Oversized Tee'),
            coalesce(p->>'description', ''), p->>'fabric', (p->>'gsm')::int,
            (p->>'mrp')::numeric, (p->>'price')::numeric, coalesce((p->>'gst_rate')::numeric, 5),
            coalesce(array(select jsonb_array_elements_text(p->'images')), '{}'),
            coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}'),
            coalesce((p->>'featured')::boolean, false), m.id,
            -- partners publish straight away; Mahendra's products wait for a partner
            case when m.role = 'partner' and coalesce((p->>'publish')::boolean, true) then now() end)
    returning id into v_id;
  else
    select * into old from products where id = (p->>'id')::bigint;
    if old.id is null then raise exception 'Product not found.'; end if;
    if old.published_at is not null
       and ((p->>'price')::numeric <> old.price or (p->>'mrp')::numeric <> old.mrp) then
      raise exception 'This product is live. Changing its price needs all partners — use "Request price change".';
    end if;
    update products set
      name = trim(p->>'name'), category_id = (p->>'category_id')::bigint,
      type = coalesce(nullif(p->>'type', ''), type), description = coalesce(p->>'description', ''),
      fabric = p->>'fabric', gsm = (p->>'gsm')::int,
      mrp = (p->>'mrp')::numeric, price = (p->>'price')::numeric,
      gst_rate = coalesce((p->>'gst_rate')::numeric, gst_rate),
      images = coalesce(array(select jsonb_array_elements_text(p->'images')), images),
      tags = coalesce(array(select jsonb_array_elements_text(p->'tags')), tags),
      featured = coalesce((p->>'featured')::boolean, featured),
      active = coalesce((p->>'active')::boolean, active)
    where id = old.id;
    v_id := old.id;
  end if;

  for v in select * from jsonb_array_elements(coalesce(p->'variants', '[]'::jsonb)) loop
    if coalesce(trim(v->>'colour'), '') = '' or coalesce(trim(v->>'size'), '') = '' then continue; end if;
    insert into product_variants (product_id, colour, colour_hex, size, sku)
    values (v_id, trim(v->>'colour'), coalesce(nullif(v->>'colour_hex', ''), '#111111'), upper(trim(v->>'size')),
            'ZS-' || v_id || '-' || upper(left(regexp_replace(v->>'colour', '[^A-Za-z]', '', 'g'), 3)) || '-' || upper(trim(v->>'size')))
    on conflict (product_id, colour, size) do update
      set active = coalesce((v->>'active')::boolean, true), colour_hex = excluded.colour_hex;
  end loop;

  return v_id;
end $$;

create function publish_product(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_partner() then raise exception 'Only a partner can publish a product to the shop.'; end if;
  perform set_config('zs.internal', 'on', true);
  update products set published_at = coalesce(published_at, now()), active = true where id = p_id;
end $$;

-- New pieces from production or opening stock (anyone on the team)
create function add_stock(p_variant bigint, p_qty int, p_reason text default 'production', p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare m members := current_member();
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then raise exception 'Enter how many pieces were added.'; end if;
  if p_reason not in ('production', 'opening') then raise exception 'Stock can only be added as production or opening stock.'; end if;
  if not exists (select 1 from product_variants where id = p_variant) then raise exception 'Size/colour not found.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into stock_moves (variant_id, qty, reason, note, by_member) values (p_variant, p_qty, p_reason, p_note, m.id);
  return stock_of(p_variant);
end $$;

-- ---------------------------------------------------------------------
-- G. Orders
-- ---------------------------------------------------------------------
create function _create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                              p_member uuid, p_discount_pct numeric) returns orders
language plpgsql security definer set search_path = public as $$
declare
  o       orders;
  it      record;
  v       record;
  v_stock int;
  v_sub   numeric := 0;
  v_mrp   numeric := 0;
  v_disc  numeric;
  v_ship  numeric;
  v_name  text := trim(coalesce(p_customer->>'name', ''));
  v_phone text := phone10(p_customer->>'phone');
  v_addr  jsonb := coalesce(p_customer->'address', '{}'::jsonb);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty.';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Too many items in one order.'; end if;

  if p_channel = 'store' then
    v_name := coalesce(nullif(v_name, ''), 'Walk-in customer');
  else
    if length(v_name) < 2 then raise exception 'Enter the customer''s name.'; end if;
    if length(v_phone) <> 10 then raise exception 'Enter a valid 10-digit mobile number.'; end if;
    if coalesce(trim(v_addr->>'line1'), '') = '' or coalesce(trim(v_addr->>'city'), '') = ''
       or coalesce(v_addr->>'pincode', '') !~ '^\d{6}$' then
      raise exception 'Enter the full delivery address with a 6-digit pincode.';
    end if;
  end if;

  perform set_config('zs.internal', 'on', true);
  insert into orders (channel, customer_name, customer_phone, customer_email, address, payment_method, created_by)
  values (p_channel, v_name, nullif(v_phone, ''), nullif(trim(coalesce(p_customer->>'email', '')), ''),
          v_addr, p_method, p_member)
  returning * into o;

  for it in
    select (e->>'variant_id')::bigint as variant_id, sum((e->>'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e group by 1
  loop
    if it.qty is null or it.qty <= 0 or it.qty > 20 then raise exception 'Quantity must be between 1 and 20.'; end if;
    select pv.id, pv.colour, pv.size, p.name, p.mrp, p.price
      into v
    from product_variants pv join products p on p.id = pv.product_id
    where pv.id = it.variant_id and pv.active and p.active and p.published_at is not null
    for update of pv;                       -- one order at a time per size/colour: no overselling
    if not found then raise exception 'One of the items is no longer available.'; end if;
    v_stock := stock_of(v.id);
    if v_stock < it.qty then
      raise exception 'Only % left of % (% / %).', greatest(v_stock, 0), v.name, v.colour, v.size;
    end if;
    insert into order_items (order_id, variant_id, product_name, variant_label, qty, mrp, price, line_total)
    values (o.id, v.id, v.name, v.colour || ' / ' || v.size, it.qty, v.mrp, v.price, v.price * it.qty);
    insert into stock_moves (variant_id, qty, reason, order_id, by_member) values (v.id, -it.qty, 'sale', o.id, p_member);
    v_sub := v_sub + v.price * it.qty;
    v_mrp := v_mrp + v.mrp * it.qty;
  end loop;

  v_disc := round(v_sub * coalesce(p_discount_pct, 0) / 100, 0);
  v_ship := case
              when p_channel = 'store' then 0
              when setting_num('free_shipping_above') > 0 and v_sub - v_disc >= setting_num('free_shipping_above') then 0
              else coalesce(setting_num('shipping_fee'), 0) end;

  update orders set mrp_total = v_mrp, subtotal = v_sub, discount = v_disc, shipping = v_ship,
                    total = v_sub - v_disc + v_ship
  where id = o.id returning * into o;

  perform _event(o.id, 'placed', channel_label(p_channel) || ' order');
  return o;
end $$;

-- Customer checkout on the website (no login needed)
create function place_web_order(p_customer jsonb, p_items jsonb, p_method text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if p_method not in ('online', 'cod') then raise exception 'Choose online payment or cash on delivery.'; end if;
  if p_method = 'cod' and coalesce(setting_num('cod_enabled'), 0) = 0 then
    raise exception 'Cash on delivery is not available right now.';
  end if;
  o := _create_order('website', p_customer, p_items, p_method, null, 0);
  if p_method = 'cod' then
    perform _notify('order', 'New website order · COD', o.customer_name || ' · ' || o.order_no, o.id, o.total, true);
  end if;
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'shipping', o.shipping,
                            'payment_method', o.payment_method);
end $$;

-- Called only by the payment server function after Razorpay is verified
create function attach_razorpay_order(p_order_no text, p_rzp_order_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where order_no = p_order_no for update;
  if o.id is null or o.payment_method <> 'online' or o.payment_status <> 'pending' or o.status = 'cancelled' then
    raise exception 'Order is not waiting for online payment.';
  end if;
  perform set_config('zs.internal', 'on', true);
  update orders set razorpay_order_id = p_rzp_order_id, updated_at = now() where id = o.id;
  return jsonb_build_object('order_no', o.order_no, 'amount_paise', (o.total * 100)::bigint,
                            'name', o.customer_name, 'phone', o.customer_phone, 'email', o.customer_email);
end $$;

create function confirm_online_payment(p_order_no text, p_rzp_order_id text, p_payment_id text, p_amount_paise bigint)
returns text
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where order_no = p_order_no for update;
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.payment_status = 'paid' then return 'already_paid'; end if;
  if o.razorpay_order_id is distinct from p_rzp_order_id then raise exception 'Payment does not belong to this order.'; end if;
  if p_amount_paise <> (o.total * 100)::bigint then raise exception 'Paid amount does not match the order total.'; end if;

  perform set_config('zs.internal', 'on', true);
  update orders set payment_status = 'paid', razorpay_payment_id = p_payment_id, updated_at = now() where id = o.id;
  perform _event(o.id, o.status, 'Online payment received');
  perform _post_sale(o.id);
  if o.status = 'cancelled' then
    perform _notify('payment', 'Payment for a cancelled order', o.order_no || ' was auto-cancelled before payment — refund or re-open it.',
                    o.id, o.total, false, 'partners');
  else
    perform _notify('order', 'New website order · Paid online', o.customer_name || ' · ' || o.order_no, o.id, o.total, true);
  end if;
  return 'paid';
end $$;

-- Online orders never paid within 30 minutes give their stock back (run every few minutes by cron)
create function release_unpaid_orders(p_minutes int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare o orders; n int := 0; it record;
begin
  perform set_config('zs.internal', 'on', true);
  for o in select * from orders
           where payment_method = 'online' and payment_status = 'pending' and status = 'placed'
             and created_at < now() - make_interval(mins => p_minutes)
           for update skip locked
  loop
    for it in select variant_id, qty from order_items where order_id = o.id loop
      insert into stock_moves (variant_id, qty, reason, order_id, note) values (it.variant_id, it.qty, 'cancel', o.id, 'Unpaid online order');
    end loop;
    update orders set status = 'cancelled', updated_at = now() where id = o.id;
    insert into order_events (order_id, status, note, actor_name) values (o.id, 'cancelled', 'Payment not completed in time', 'System');
    n := n + 1;
  end loop;
  return n;
end $$;

-- Team enters Instagram / WhatsApp orders and store sales
create function staff_create_order(p_channel text, p_customer jsonb, p_items jsonb, p_method text,
                                   p_discount_pct numeric default 0, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  o orders;
  v_paid boolean;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_channel not in ('instagram', 'whatsapp', 'store') then raise exception 'Choose Store, Instagram or WhatsApp.'; end if;
  if p_channel = 'store' and p_method not in ('cash', 'upi') then raise exception 'Store sales are paid by cash or UPI.'; end if;
  if p_channel <> 'store' and p_method not in ('upi', 'cod') then raise exception 'Choose prepaid (UPI) or cash on delivery.'; end if;
  if coalesce(p_discount_pct, 0) < 0 or coalesce(p_discount_pct, 0) > coalesce(setting_num('max_store_discount_pct'), 0) then
    raise exception 'Discount can be at most %', setting_num('max_store_discount_pct') || '%.';
  end if;

  o := _create_order(p_channel, p_customer, p_items, p_method, m.id, p_discount_pct);
  v_paid := p_method in ('cash', 'upi');

  perform set_config('zs.internal', 'on', true);
  update orders set
    payment_status = case when v_paid then 'paid' else 'pending' end,
    status = case when p_channel = 'store' then 'delivered' else 'confirmed' end,
    delivered_at = case when p_channel = 'store' then now() end,
    note = nullif(trim(coalesce(p_note, '')), '')
  where id = o.id returning * into o;
  perform _event(o.id, o.status, case when p_channel = 'store' then 'Sold at store · ' || upper(p_method) else 'Confirmed by ' || m.name end);
  if v_paid then perform _post_sale(o.id); end if;
  perform _notify('order',
    case p_channel when 'store' then 'Store sale' else 'New ' || channel_label(p_channel) || ' order' end
      || case when v_paid then ' · Paid' else ' · COD' end,
    o.customer_name || ' · ' || o.order_no || ' · by ' || m.name, o.id, o.total, true);
  return jsonb_build_object('order_no', o.order_no, 'total', o.total, 'id', o.id);
end $$;

-- Move an order forward. Each status has only the next sensible steps.
create function set_order_status(p_order_id bigint, p_status text, p_note text default null,
                                 p_courier text default null, p_tracking text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  o orders;
  it record;
  v_allowed text[];
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into o from orders where id = p_order_id for update;
  if o.id is null then raise exception 'Order not found.'; end if;

  v_allowed := case o.status
    when 'placed'    then array['confirmed', 'cancelled']
    when 'confirmed' then array['packed', 'cancelled']
    when 'packed'    then array['shipped', 'cancelled']
    when 'shipped'   then array['delivered', 'rto']
    else array[]::text[] end;
  if not (p_status = any (v_allowed)) then
    raise exception 'A % order cannot be marked %.', o.status, p_status;
  end if;
  if o.payment_method = 'online' and o.payment_status = 'pending' and p_status <> 'cancelled' then
    raise exception 'This order is still waiting for online payment.';
  end if;
  if p_status = 'shipped' and coalesce(trim(p_courier), '') = '' then
    raise exception 'Enter the courier name (and tracking number) when shipping.';
  end if;
  if p_status in ('cancelled', 'rto') and o.payment_status = 'paid' and m.role <> 'partner' then
    raise exception 'This order is already paid, so cancelling means a refund. Only a partner can do this.';
  end if;
  if p_status = 'cancelled' and coalesce(trim(p_note), '') = '' then
    raise exception 'Write why the order is being cancelled.';
  end if;

  perform set_config('zs.internal', 'on', true);

  if p_status in ('cancelled', 'rto') then
    for it in select variant_id, qty from order_items where order_id = o.id loop
      insert into stock_moves (variant_id, qty, reason, order_id, by_member)
      values (it.variant_id, it.qty, case when p_status = 'rto' then 'rto' else 'cancel' end, o.id, m.id);
    end loop;
    if o.payment_status = 'paid' then
      update orders set payment_status = 'refunded' where id = o.id;
      perform _post_refund(o.id, o.total, case when p_status = 'rto' then 'RTO' else 'cancelled' end);
    end if;
  end if;

  update orders set
    status = p_status,
    courier = coalesce(nullif(trim(coalesce(p_courier, '')), ''), courier),
    tracking_no = coalesce(nullif(trim(coalesce(p_tracking, '')), ''), tracking_no),
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    updated_at = now()
  where id = o.id;

  if p_status = 'delivered' and o.payment_status = 'pending' then
    update orders set payment_status = 'paid' where id = o.id;      -- COD collected
    perform _post_sale(o.id);
  end if;

  perform _event(o.id, p_status, nullif(trim(coalesce(p_note, '')), ''));

  if p_status = 'rto' then
    perform _notify('status', 'RTO · ' || o.order_no, o.customer_name || ' · stock is back on the shelf', o.id, o.total);
  elsif p_status = 'delivered' then
    perform _notify('status', 'Delivered · ' || o.order_no, o.customer_name, o.id, o.total);
  elsif p_status = 'cancelled' then
    perform _notify('status', 'Cancelled · ' || o.order_no, coalesce(p_note, ''), o.id, o.total);
  end if;
  return p_status;
end $$;

-- Customer: look up an order with order number + phone
create function track_order(p_order_no text, p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where upper(order_no) = upper(trim(p_order_no));
  if o.id is null or o.customer_phone is distinct from phone10(p_phone) then
    raise exception 'No order found with that number and phone.';
  end if;
  return jsonb_build_object(
    'order_no', o.order_no, 'status', o.status, 'payment_method', o.payment_method,
    'payment_status', o.payment_status, 'total', o.total, 'shipping', o.shipping, 'discount', o.discount,
    'created_at', o.created_at, 'delivered_at', o.delivered_at, 'courier', o.courier, 'tracking_no', o.tracking_no,
    'customer_name', o.customer_name,
    'return_days', setting_num('return_window_days'),
    'items', (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.product_name, 'variant', i.variant_label,
                                                  'qty', i.qty, 'price', i.price, 'variant_id', i.variant_id,
                                                  'product_id', pv.product_id) order by i.id)
              from order_items i join product_variants pv on pv.id = i.variant_id where i.order_id = o.id),
    'events', (select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note',
                                                   case when e.actor_name in ('Customer', 'System') then e.note end) order by e.at)
               from order_events e where e.order_id = o.id),
    'requests', (select jsonb_agg(jsonb_build_object('kind', s.kind, 'status', s.status, 'resolution', s.resolution, 'at', s.created_at))
                 from service_requests s where s.order_id = o.id));
end $$;

-- Customer: ask for a replacement (other size/colour) or a return
create function request_service(p_order_no text, p_phone text, p_kind text, p_reason text, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  o orders;
  it jsonb;
  oi order_items;
  v_id bigint;
begin
  select * into o from orders where upper(order_no) = upper(trim(p_order_no));
  if o.id is null or o.customer_phone is distinct from phone10(p_phone) then
    raise exception 'No order found with that number and phone.';
  end if;
  if p_kind not in ('replacement', 'return') then raise exception 'Choose replacement or return.'; end if;
  if o.status <> 'delivered' or o.delivered_at is null then raise exception 'Requests open once the order is delivered.'; end if;
  if o.delivered_at < now() - make_interval(days => coalesce(setting_num('return_window_days'), 7)::int) then
    raise exception 'The % day window for this order has closed.', setting_num('return_window_days');
  end if;
  if exists (select 1 from service_requests where order_id = o.id and status in ('open', 'approved')) then
    raise exception 'There is already an open request for this order.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Tell us what went wrong.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Choose the item.'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into oi from order_items where id = (it->>'order_item_id')::bigint and order_id = o.id;
    if oi.id is null then raise exception 'Item does not belong to this order.'; end if;
    if (it->>'qty')::int is null or (it->>'qty')::int < 1 or (it->>'qty')::int > oi.qty then raise exception 'Wrong quantity.'; end if;
    if p_kind = 'replacement' then
      if not exists (select 1 from product_variants a join product_variants b on a.product_id = b.product_id
                     where a.id = oi.variant_id and b.id = (it->>'new_variant_id')::bigint and b.active) then
        raise exception 'Choose the size/colour you want instead.';
      end if;
    end if;
  end loop;

  perform set_config('zs.internal', 'on', true);
  insert into service_requests (order_id, kind, reason, items) values (o.id, p_kind, trim(p_reason), p_items)
  returning id into v_id;
  perform _event(o.id, o.status, initcap(p_kind) || ' requested: ' || trim(p_reason));
  perform _notify('service', initcap(p_kind) || ' request · ' || o.order_no, o.customer_name || ': ' || trim(p_reason), o.id);
  return v_id;
end $$;

-- Team: approve / reject / complete a replacement or return
create function set_service_status(p_id bigint, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  s service_requests;
  o orders;
  it jsonb;
  oi order_items;
  v_refund numeric := 0;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  select * into s from service_requests where id = p_id for update;
  if s.id is null then raise exception 'Request not found.'; end if;
  select * into o from orders where id = s.order_id for update;
  if s.kind = 'return' and m.role <> 'partner' and p_action in ('approve', 'complete') then
    raise exception 'Returns mean a refund, so a partner must approve and complete them.';
  end if;

  perform set_config('zs.internal', 'on', true);

  if p_action in ('approve', 'reject') then
    if s.status <> 'open' then raise exception 'This request is already %.', s.status; end if;
    if p_action = 'reject' and coalesce(trim(p_note), '') = '' then raise exception 'Write a reason for the customer.'; end if;
    update service_requests set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
           resolution = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = s.id;
    perform _event(o.id, o.status, initcap(s.kind) || ' ' || p_action || 'd' || coalesce(': ' || nullif(trim(p_note), ''), ''));
    return p_action || 'd';
  end if;

  if p_action <> 'complete' then raise exception 'Unknown action.'; end if;
  if s.status <> 'approved' then raise exception 'Approve the request first.'; end if;

  for it in select * from jsonb_array_elements(s.items) loop
    select * into oi from order_items where id = (it->>'order_item_id')::bigint;
    insert into stock_moves (variant_id, qty, reason, order_id, by_member, note)
    values (oi.variant_id, (it->>'qty')::int, 'return', o.id, m.id, 'Received back from customer');
    if s.kind = 'replacement' then
      perform 1 from product_variants where id = (it->>'new_variant_id')::bigint for update;
      if stock_of((it->>'new_variant_id')::bigint) < (it->>'qty')::int then
        raise exception 'The replacement size/colour is out of stock. Add stock first.';
      end if;
      insert into stock_moves (variant_id, qty, reason, order_id, by_member, note)
      values ((it->>'new_variant_id')::bigint, -(it->>'qty')::int, 'replacement_out', o.id, m.id, 'Sent as replacement');
    else
      -- refund what the customer actually paid for this item (after any order discount)
      v_refund := v_refund + round(oi.price * (it->>'qty')::int * (o.subtotal - o.discount) / nullif(o.subtotal, 0), 2);
    end if;
  end loop;

  if s.kind = 'return' then
    if o.payment_status = 'paid' and v_refund > 0 then
      perform _post_refund(o.id, v_refund, 'return');
    end if;
    update orders set status = 'returned', updated_at = now() where id = o.id;
  end if;
  update service_requests set status = 'completed', resolution = coalesce(nullif(trim(coalesce(p_note, '')), ''), resolution),
         updated_at = now() where id = s.id;
  perform _event(o.id, case when s.kind = 'return' then 'returned' else o.status end,
                 initcap(s.kind) || ' completed' || case when v_refund > 0 then ' · refund ₹' || v_refund else '' end);
  return 'completed';
end $$;

-- ---------------------------------------------------------------------
-- H. Approval engine: now also price changes, stock write-offs, custom split
-- ---------------------------------------------------------------------
create or replace function apply_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r requests;
  e ledger;
  v_petty numeric;
  v_big   numeric;
begin
  select * into r from requests where id = p_id;
  perform set_config('zs.internal', 'on', true);

  case r.type
    when 'expense' then
      insert into ledger (kind, amount, description, request_id) values ('expense', -r.amount, r.description, r.id);
    when 'income' then
      insert into ledger (kind, amount, description, request_id) values ('income', r.amount, r.description, r.id);
    when 'capital_in' then
      insert into ledger (kind, amount, partner_id, description, request_id)
      values ('capital_in', r.amount, (r.payload->>'partner_id')::uuid, r.description, r.id);
    when 'partner_payout' then
      insert into ledger (kind, amount, partner_id, description, request_id)
      values ('partner_payout', -r.amount, (r.payload->>'partner_id')::uuid, r.description, r.id);
    when 'reversal' then
      select * into e from ledger where id = (r.payload->>'entry_id')::bigint;
      insert into ledger (kind, amount, partner_id, description, request_id, reverses_entry, order_id)
      values (e.kind, -e.amount, e.partner_id, 'Reversal of entry #' || e.id || ': ' || r.description, r.id, e.id, e.order_id);
    when 'setting_change' then
      update settings set value = to_jsonb((r.payload->>'value')::numeric), updated_at = now() where key = r.payload->>'key';
      v_petty := setting_num('employee_petty_limit');
      v_big   := setting_num('all_partner_limit');
      if v_petty >= v_big then
        raise exception 'Employee limit (₹%) must stay below the all-partner limit (₹%).', v_petty, v_big;
      end if;
    when 'share_rule' then
      update settings set value = to_jsonb(r.payload->>'profit_rule'), updated_at = now() where key = 'profit_rule';
      update settings set value = to_jsonb(r.payload->>'loss_rule'),   updated_at = now() where key = 'loss_rule';
      if r.payload ? 'split' then
        update settings set value = r.payload->'split', updated_at = now() where key = 'custom_split';
      end if;
    when 'price_change' then
      update products set price = (r.payload->>'price')::numeric, mrp = (r.payload->>'mrp')::numeric
      where id = (r.payload->>'product_id')::bigint;
    when 'stock_writeoff' then
      perform 1 from product_variants where id = (r.payload->>'variant_id')::bigint for update;
      if stock_of((r.payload->>'variant_id')::bigint) < (r.payload->>'qty')::int then
        raise exception 'Not enough stock left to write off.';
      end if;
      insert into stock_moves (variant_id, qty, reason, note)
      values ((r.payload->>'variant_id')::bigint, -(r.payload->>'qty')::int, 'writeoff', r.description);
  end case;
end $$;

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
                   'cod_enabled', 'max_store_discount_pct', 'low_stock_alert', 'return_window_days') then
        raise exception 'That setting cannot be changed this way.';
      end if;
      if (p_payload->>'value')::numeric is null or (p_payload->>'value')::numeric < 0
         or (k in ('employee_petty_limit', 'all_partner_limit') and (p_payload->>'value')::numeric <= 0) then
        raise exception 'Enter a valid amount.';
      end if;
      if k = 'cod_enabled' and (p_payload->>'value')::numeric not in (0, 1) then raise exception 'Use 1 for on, 0 for off.'; end if;
      if k = 'max_store_discount_pct' and (p_payload->>'value')::numeric > 90 then raise exception 'Discount limit is too high.'; end if;
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

-- ---------------------------------------------------------------------
-- I. Reports
-- ---------------------------------------------------------------------
drop view if exists partner_positions;
drop view if exists business_summary;

create view business_summary with (security_invoker = true) as
select
  coalesce(sum(amount), 0)                                                as cash_balance,
  coalesce(sum(amount)  filter (where kind = 'capital_in'), 0)            as total_capital,
  coalesce(-sum(amount) filter (where kind = 'partner_payout'), 0)        as total_payouts,
  coalesce(-sum(amount) filter (where kind = 'expense'), 0)               as total_expenses,
  coalesce(sum(amount)  filter (where kind = 'income'), 0)                as total_income,
  coalesce(sum(amount)  filter (where kind = 'sale'), 0)                  as total_sales,
  coalesce(-sum(amount) filter (where kind = 'refund'), 0)                as total_refunds,
  coalesce(sum(amount)  filter (where kind in ('income', 'expense', 'sale', 'refund')), 0) as business_result
from ledger;

create view partner_positions with (security_invoker = true) as
with p as (
  select id, name from members where role = 'partner' and active
), cap as (
  select partner_id,
         coalesce(sum(amount) filter (where kind = 'capital_in'), 0)      as capital,
         coalesce(-sum(amount) filter (where kind = 'partner_payout'), 0) as payouts
  from ledger where partner_id is not null group by partner_id
), tot as (
  select coalesce(sum(capital), 0) as total_capital from cap
), res as (
  select coalesce(sum(amount) filter (where kind in ('expense', 'income', 'sale', 'refund')), 0) as result from ledger
), rules as (
  select (select value #>> '{}' from settings where key = 'profit_rule') as profit_rule,
         (select value #>> '{}' from settings where key = 'loss_rule')   as loss_rule,
         (select value from settings where key = 'custom_split')         as split
), n as (
  select count(*) as n from p
), calc as (
  select p.id as partner_id, p.name,
         coalesce(cap.capital, 0) as capital,
         coalesce(cap.payouts, 0) as payouts,
         case when tot.total_capital > 0 then coalesce(cap.capital, 0) / tot.total_capital end as investment_share,
         res.result as business_result,
         case when res.result >= 0 then rules.profit_rule else rules.loss_rule end as applied_rule,
         (rules.split ->> p.id::text)::numeric / 100 as custom_share,
         n.n
  from p left join cap on cap.partner_id = p.id
  cross join tot cross join res cross join rules cross join n
), shares as (
  select calc.*,
         case applied_rule when 'investment' then investment_share
                           when 'equal'      then 1.0 / n
                           when 'custom'     then custom_share end as result_share
  from calc
)
select partner_id, name, capital, payouts, investment_share, business_result, applied_rule, result_share,
       round(business_result * result_share, 2)                     as result_amount,
       round(capital - payouts + business_result * result_share, 2) as settlement_balance
from shares
where is_partner();

-- Public shop catalogue (only published products, no costs or internals)
create view catalog as
select p.id, p.name, p.slug, c.name as category, c.slug as category_slug, p.type, p.description,
       p.fabric, p.gsm, p.mrp, p.price,
       round((1 - p.price / p.mrp) * 100)::int as discount_pct,
       p.images, p.tags, p.featured, p.published_at,
       coalesce(v.variants, '[]'::jsonb) as variants,
       coalesce(v.total_stock, 0) as total_stock
from products p
left join categories c on c.id = p.category_id
left join lateral (
  select jsonb_agg(jsonb_build_object('id', pv.id, 'colour', pv.colour, 'hex', pv.colour_hex, 'size', pv.size,
                                      'stock', greatest(stock_of(pv.id), 0))
                   order by pv.colour, array_position(array['XS','S','M','L','XL','XXL','3XL','4XL'], pv.size), pv.size) as variants,
         sum(greatest(stock_of(pv.id), 0)) as total_stock
  from product_variants pv where pv.product_id = p.id and pv.active
) v on true
where p.active and p.published_at is not null;

-- Shop-safe settings (delivery fee, COD, return window) for the public website
create view public_settings as
select key, value from settings
where key in ('shipping_fee', 'free_shipping_above', 'cod_enabled', 'return_window_days');

create view stock_board with (security_invoker = true) as
select pv.id as variant_id, pv.product_id, p.name as product_name, p.published_at is not null as published,
       p.active as product_active, pv.colour, pv.colour_hex, pv.size, pv.sku, pv.active,
       stock_of(pv.id) as stock,
       p.price, p.mrp
from product_variants pv join products p on p.id = pv.product_id;

create view order_board with (security_invoker = true) as
select o.*,
       (select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.product_name, 'variant', i.variant_label,
                                            'qty', i.qty, 'price', i.price, 'variant_id', i.variant_id) order by i.id)
        from order_items i where i.order_id = o.id) as items,
       (select coalesce(sum(qty), 0) from order_items i where i.order_id = o.id) as pieces,
       (select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note', e.note, 'by', e.actor_name) order by e.at)
        from order_events e where e.order_id = o.id) as events,
       (select count(*) from service_requests s where s.order_id = o.id and s.status in ('open', 'approved')) as open_requests
from orders o;

create view service_board with (security_invoker = true) as
select s.*, o.order_no, o.customer_name, o.customer_phone, o.payment_status, o.address,
       (select jsonb_agg(jsonb_build_object(
          'qty', (x->>'qty')::int,
          'item', (select i.product_name || ' · ' || i.variant_label from order_items i where i.id = (x->>'order_item_id')::bigint),
          'new', (select pv.colour || ' / ' || pv.size from product_variants pv where pv.id = (x->>'new_variant_id')::bigint)))
        from jsonb_array_elements(s.items) x) as item_list
from service_requests s join orders o on o.id = s.order_id;

create view sales_daily with (security_invoker = true) as
select (o.created_at at time zone 'Asia/Kolkata')::date as day,
       count(*) filter (where o.status not in ('cancelled'))                        as orders,
       coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'rto', 'returned')), 0) as value,
       coalesce(sum((select sum(qty) from order_items i where i.order_id = o.id))
                filter (where o.status not in ('cancelled', 'rto', 'returned')), 0)  as pieces
from orders o
where o.created_at > now() - interval '60 days'
  and not (o.payment_method = 'online' and o.payment_status = 'pending')
group by 1;

-- ---------------------------------------------------------------------
-- J. Who can see what
-- ---------------------------------------------------------------------
alter table categories       enable row level security;
alter table products         enable row level security;
alter table product_variants enable row level security;
alter table stock_moves      enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table order_events     enable row level security;
alter table service_requests enable row level security;
alter table notifications    enable row level security;

create policy categories_read on categories for select to anon, authenticated
  using (active or (current_member()).id is not null);
create policy products_read on products for select to anon, authenticated
  using ((active and published_at is not null) or (current_member()).id is not null);
create policy variants_read on product_variants for select to anon, authenticated
  using (active or (current_member()).id is not null);

create policy stock_read   on stock_moves      for select to authenticated using ((current_member()).id is not null);
create policy orders_read  on orders           for select to authenticated using ((current_member()).id is not null);
create policy items_read   on order_items      for select to authenticated using ((current_member()).id is not null);
create policy events_read  on order_events     for select to authenticated using ((current_member()).id is not null);
create policy service_read on service_requests for select to authenticated using ((current_member()).id is not null);
create policy notif_read   on notifications    for select to authenticated
  using ((current_member()).id is not null and (audience = 'all' or is_partner()));

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant select on categories, products, product_variants, catalog, public_settings to anon;
revoke all on all sequences in schema public from anon, authenticated;

-- internal pieces: never callable from outside
do $$
declare f text;
begin
  foreach f in array array[
    '_notify(text,text,text,bigint,numeric,boolean,text)', '_event(bigint,text,text)', '_post_sale(bigint)',
    '_post_refund(bigint,numeric,text)', '_create_order(text,jsonb,jsonb,text,uuid,numeric)',
    'stock_alert()', 'approval_alert()', 'apply_request(bigint)',
    'attach_razorpay_order(text,text)', 'confirm_online_payment(text,text,text,bigint)', 'release_unpaid_orders(integer)']
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- team functions
revoke execute on function upsert_category(text, int), upsert_product(jsonb), publish_product(bigint),
  add_stock(bigint, int, text, text), staff_create_order(text, jsonb, jsonb, text, numeric, text),
  set_order_status(bigint, text, text, text, text), set_service_status(bigint, text, text) from public, anon;
grant execute on function upsert_category(text, int), upsert_product(jsonb), publish_product(bigint),
  add_stock(bigint, int, text, text), staff_create_order(text, jsonb, jsonb, text, numeric, text),
  set_order_status(bigint, text, text, text, text), set_service_status(bigint, text, text) to authenticated;

-- customer functions (shop works without login)
grant execute on function place_web_order(jsonb, jsonb, text), track_order(text, text),
  request_service(text, text, text, text, jsonb), stock_of(bigint) to anon, authenticated;

-- live notifications to the team app
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
