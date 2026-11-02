-- =====================================================================
-- Z-SHIRTS · Store cash rules
--   · Cash enters the drawer only through sales. No cash in, no other cash out.
--   · Cash leaves only as a handover to a named partner, recorded by Mahendra
--     (for any partner) or by the partner who takes it (for himself).
--   · Only partners see the drawer amount. Mahendra counts blind at closing.
-- Run after 008.
-- =====================================================================

alter table cash_moves add column if not exists taken_by uuid references members(id);
alter table cash_moves drop constraint if exists cash_moves_kind_check;
alter table cash_moves add constraint cash_moves_kind_check check (kind in ('in', 'out', 'handover'));

drop function if exists cash_punch(text, numeric, text, text, text);

-- what the drawer should hold right now (internal)
create or replace function _drawer_now(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, today_ist());
  v_open numeric; v_sales numeric; v_ref numeric; v_hand numeric; v_other numeric;
begin
  select counted into v_open from cash_closes where day < v_day order by day desc limit 1;
  select coalesce(sum(l.amount), 0) into v_sales from ledger l join orders o on o.id = l.order_id
   where l.kind = 'sale' and o.payment_method = 'cash' and l.entry_date = v_day;
  select coalesce(-sum(l.amount), 0) into v_ref from ledger l join orders o on o.id = l.order_id
   where l.kind = 'refund' and o.payment_method = 'cash' and l.entry_date = v_day;
  select coalesce(sum(amount) filter (where kind = 'handover'), 0),
         coalesce(sum(case kind when 'in' then amount when 'out' then -amount else 0 end), 0)
    into v_hand, v_other from cash_moves where day = v_day;
  return jsonb_build_object('day', v_day, 'opening', coalesce(v_open, 0), 'cash_sales', v_sales, 'cash_refunds', v_ref,
    'handed_over', v_hand, 'cash_in', greatest(v_other, 0), 'cash_out', v_hand + greatest(-v_other, 0),
    'expected', coalesce(v_open, 0) + v_sales - v_ref - v_hand + v_other,
    'closed', exists (select 1 from cash_closes where day = v_day));
end $$;

-- partners see the amounts; Mahendra only sees whether the day is closed
create or replace function cash_day_preview(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  if (current_member()).id is null then raise exception 'Members only.'; end if;
  d := _drawer_now(p_day);
  if not is_partner() then return jsonb_build_object('day', d->'day', 'closed', d->'closed'); end if;
  return d;
end $$;

create or replace function cash_handover(p_amount numeric, p_taken_by uuid, p_note text default null, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  t members;
  d jsonb;
  c cash_moves;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount handed over.'; end if;
  select * into t from members where id = p_taken_by and role = 'partner' and active;
  if t.id is null then raise exception 'Choose the partner who took the cash.'; end if;
  if m.role = 'partner' and t.id <> m.id then raise exception 'Record only the cash you took yourself. Mahendra records handovers to other partners.'; end if;
  d := _drawer_now(null);
  if (d->>'closed')::boolean then raise exception 'Today''s cash is already closed. Record it tomorrow.'; end if;
  if p_amount > (d->>'expected')::numeric then raise exception 'That is more cash than the store should have. Check the amount.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into cash_moves (kind, amount, reason, category, photo_path, by_member, taken_by)
  values ('handover', p_amount, 'Cash handed to ' || t.name || coalesce(' · ' || nullif(trim(p_note), ''), ''), 'handover',
          nullif(trim(coalesce(p_photo, '')), ''), m.id, t.id)
  returning * into c;
  perform _notify('approval', t.name || ' took ₹' || trim(to_char(p_amount, 'FM99,99,990')) || ' cash from the store',
    'Recorded by ' || m.name || coalesce(' · ' || nullif(trim(p_note), ''), ''), null, p_amount, false, 'partners');
  return jsonb_build_object('id', c.id, 'amount', c.amount, 'taken_by', t.name);
end $$;

create or replace function close_cash_day(p_counted numeric, p_cash_out numeric, p_note text, p_photo text, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  d jsonb;
  c cash_closes;
begin
  if m.id is null then raise exception 'Members only.'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter the cash you counted.'; end if;
  if coalesce(trim(p_photo), '') = '' then raise exception 'Add a photo of the counted cash.'; end if;
  d := _drawer_now(p_day);
  if (d->>'closed')::boolean then raise exception 'This day is already closed.'; end if;
  perform set_config('zs.internal', 'on', true);
  insert into cash_closes (day, opening, cash_sales, cash_refunds, cash_in, cash_out, expected, counted, difference, note, photo_path, by_member)
  values ((d->>'day')::date, (d->>'opening')::numeric, (d->>'cash_sales')::numeric, (d->>'cash_refunds')::numeric,
          (d->>'cash_in')::numeric, (d->>'cash_out')::numeric, (d->>'expected')::numeric, p_counted,
          p_counted - (d->>'expected')::numeric, nullif(trim(coalesce(p_note, '')), ''), p_photo, m.id)
  returning * into c;
  if c.difference <> 0 then
    perform _notify('approval', 'Cash ' || case when c.difference < 0 then 'short' else 'extra' end || ' by ₹' || abs(c.difference),
      'Cash close ' || to_char(c.day, 'DD Mon') || ' by ' || m.name || ' · expected ₹' || c.expected || ', counted ₹' || c.counted,
      null, abs(c.difference), false, 'partners');
  else
    perform _notify('approval', 'Cash matched ✓ ' || to_char(c.day, 'DD Mon'), 'Counted ₹' || c.counted || ' by ' || m.name, null, c.counted, false, 'partners');
  end if;
  if is_partner() then return to_jsonb(c); end if;
  return jsonb_build_object('day', c.day, 'closed', true);   -- Mahendra counts blind
end $$;

-- cash each partner has collected from the store
create or replace view cash_with_partners with (security_invoker = true) as
select mm.id as partner_id, mm.name, coalesce(sum(cm.amount), 0) as collected, count(cm.id) as handovers, max(cm.created_at) as last_at
from members mm left join cash_moves cm on cm.taken_by = mm.id and cm.kind = 'handover'
where mm.role = 'partner' and mm.active and is_partner()
group by mm.id, mm.name;

-- only partners see drawer amounts; Mahendra sees the handovers he recorded himself
drop policy if exists cashm_read on cash_moves;
create policy cashm_read on cash_moves for select to authenticated using (is_partner() or by_member = (current_member()).id);
drop policy if exists cash_read on cash_closes;
create policy cash_read on cash_closes for select to authenticated using (is_partner());

revoke execute on function _drawer_now(date) from public, anon, authenticated;
revoke execute on function cash_handover(numeric, uuid, text, text) from public, anon;
grant execute on function cash_handover(numeric, uuid, text, text) to authenticated;
revoke all on cash_with_partners from anon;
grant select on cash_with_partners to authenticated;
