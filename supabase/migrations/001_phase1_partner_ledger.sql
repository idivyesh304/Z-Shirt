-- =====================================================================
-- Z-SHIRTS  ·  Phase 1  ·  Partner ledger, approvals and audit trail
-- =====================================================================
-- The rules in this file are enforced INSIDE the database, not just in
-- the app screens. Even someone who opens the database directly cannot
-- edit or delete a money entry, approve their own payout alone, or post
-- an entry into a month that all partners have closed.
--
-- Run this once in Supabase → SQL Editor, then run 002_storage.sql and
-- seed/members.sql (after editing the e-mails in it).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type member_role    as enum ('partner', 'employee');
create type request_type   as enum ('expense', 'income', 'capital_in', 'partner_payout',
                                    'reversal', 'setting_change', 'share_rule');
create type request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type vote_decision  as enum ('approve', 'reject');

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table members (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,                 -- filled automatically when they first log in
  name          text not null,
  email         text not null unique,
  role          member_role not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table settings (
  key         text primary key,
  value       jsonb not null,
  label       text not null,
  updated_at  timestamptz not null default now()
);

create table requests (
  id                  bigint generated always as identity primary key,
  type                request_type not null,
  amount              numeric(14,2) check (amount is null or amount > 0),
  description         text not null check (length(trim(description)) >= 3),
  proof_path          text,                  -- photo of bill / bank screenshot in storage
  payload             jsonb not null default '{}'::jsonb,
  raised_by           uuid not null references members(id),
  required_approvals  int  not null check (required_approvals >= 0),
  status              request_status not null default 'pending',
  created_at          timestamptz not null default now(),
  decided_at          timestamptz
);

create table votes (
  request_id  bigint not null references requests(id),
  member_id   uuid   not null references members(id),
  decision    vote_decision not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (request_id, member_id)
);

-- amount > 0 = money INTO the business, amount < 0 = money OUT
create table ledger (
  id              bigint generated always as identity primary key,
  entry_date      date not null default ((now() at time zone 'Asia/Kolkata')::date),
  kind            text not null check (kind in ('capital_in', 'partner_payout', 'expense', 'income')),
  amount          numeric(14,2) not null check (amount <> 0),
  partner_id      uuid references members(id),
  description     text not null,
  request_id      bigint references requests(id),
  reverses_entry  bigint unique references ledger(id),   -- each entry can be reversed only once
  created_at      timestamptz not null default now()
);

create table month_close_signatures (
  month         date not null check (month = date_trunc('month', month)::date),
  member_id     uuid not null references members(id),
  bank_balance  numeric(14,2) not null,       -- balance the partner saw on the bank statement
  note          text,
  signed_at     timestamptz not null default now(),
  primary key (month, member_id)
);

create table audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text,
  action      text not null,
  table_name  text not null,
  row_ref     text,
  old_data    jsonb,
  new_data    jsonb
);

create index on requests (status, created_at desc);
create index on ledger (entry_date);
create index on ledger (partner_id);
create index on audit_log (at desc);

-- ---------------------------------------------------------------------
-- Starting settings (changing any of them later needs ALL partners)
-- ---------------------------------------------------------------------
insert into settings (key, value, label) values
  ('employee_petty_limit', '2000'::jsonb,  'Employee can spend up to this without approval (bill photo still required)'),
  ('all_partner_limit',    '15000'::jsonb, 'Expenses above this need ALL partners; below it, 2 partners'),
  ('profit_rule',          'null'::jsonb,  'How profit is shared: investment ratio or equal'),
  ('loss_rule',            'null'::jsonb,  'How loss is shared: investment ratio or equal');

-- ---------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------
create function today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create function current_member() returns members
language sql stable security definer set search_path = public as $$
  select * from members where auth_user_id = auth.uid() and active
$$;

create function is_partner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members
                 where auth_user_id = auth.uid() and role = 'partner' and active)
$$;

create function partner_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from members where role = 'partner' and active
$$;

create function setting_num(k text) returns numeric
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::numeric from settings where key = k
$$;

create function month_is_closed(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select partner_count() > 0
     and (select count(*) from month_close_signatures
          where month = date_trunc('month', d)::date) >= partner_count()
$$;

-- ---------------------------------------------------------------------
-- Guard triggers
-- ---------------------------------------------------------------------
-- 1. Money entries, votes, signatures and the audit log can NEVER change.
create function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is permanent: entries can never be edited or deleted. Use a reversal request instead.',
    tg_table_name;
end $$;

create trigger ledger_permanent    before update or delete on ledger                 for each row execute function forbid_change();
create trigger votes_permanent     before update or delete on votes                  for each row execute function forbid_change();
create trigger signatures_permanent before update or delete on month_close_signatures for each row execute function forbid_change();
create trigger audit_permanent     before update or delete on audit_log              for each row execute function forbid_change();
create trigger requests_no_delete  before delete on requests                         for each row execute function forbid_change();
create trigger members_no_delete   before delete on members                          for each row execute function forbid_change();
create trigger settings_no_delete  before delete on settings                         for each row execute function forbid_change();

-- 2. Writes only through the approval functions below (flag set inside them).
create function require_internal() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('zs.internal', true), '') <> 'on' then
    raise exception 'Direct changes to % are not allowed. Use the Z-SHIRTS app.', tg_table_name;
  end if;
  return new;
end $$;

create trigger ledger_internal     before insert on ledger                 for each row execute function require_internal();
create trigger votes_internal      before insert on votes                  for each row execute function require_internal();
create trigger signatures_internal before insert on month_close_signatures for each row execute function require_internal();
create trigger requests_internal   before insert or update on requests     for each row execute function require_internal();
create trigger settings_internal   before insert or update on settings     for each row execute function require_internal();
create trigger members_internal    before insert or update on members      for each row execute function require_internal();

-- 3. Nothing can be posted into a month that every partner has signed off.
create function block_closed_month() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if month_is_closed(new.entry_date) then
    raise exception 'The month of % is closed and locked by all partners.', to_char(new.entry_date, 'Mon YYYY');
  end if;
  return new;
end $$;

create trigger ledger_month_lock before insert on ledger for each row execute function block_closed_month();

-- 4. Audit trail: every insert/update on every table, with who did it.
create function write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_ref  text;
begin
  select name into v_name from members where auth_user_id = auth.uid();
  v_ref := coalesce(to_jsonb(new), to_jsonb(old)) ->> 'id';
  if v_ref is null then
    v_ref := coalesce(to_jsonb(new), to_jsonb(old)) ->> 'key';
  end if;
  insert into audit_log (actor, actor_name, action, table_name, row_ref, old_data, new_data)
  values (auth.uid(), coalesce(v_name, 'system / database owner'), tg_op, tg_table_name, v_ref,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return null;
end $$;

create trigger audit_members    after insert or update or delete on members                for each row execute function write_audit();
create trigger audit_settings   after insert or update or delete on settings               for each row execute function write_audit();
create trigger audit_requests   after insert or update or delete on requests               for each row execute function write_audit();
create trigger audit_votes      after insert on votes                                      for each row execute function write_audit();
create trigger audit_ledger     after insert on ledger                                     for each row execute function write_audit();
create trigger audit_signatures after insert on month_close_signatures                     for each row execute function write_audit();

-- ---------------------------------------------------------------------
-- Approval engine (internal — not callable from the app directly)
-- ---------------------------------------------------------------------
create function apply_request(p_id bigint) returns void
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
      insert into ledger (kind, amount, description, request_id)
      values ('expense', -r.amount, r.description, r.id);

    when 'income' then
      insert into ledger (kind, amount, description, request_id)
      values ('income', r.amount, r.description, r.id);

    when 'capital_in' then
      insert into ledger (kind, amount, partner_id, description, request_id)
      values ('capital_in', r.amount, (r.payload->>'partner_id')::uuid, r.description, r.id);

    when 'partner_payout' then
      insert into ledger (kind, amount, partner_id, description, request_id)
      values ('partner_payout', -r.amount, (r.payload->>'partner_id')::uuid, r.description, r.id);

    when 'reversal' then
      select * into e from ledger where id = (r.payload->>'entry_id')::bigint;
      insert into ledger (kind, amount, partner_id, description, request_id, reverses_entry)
      values (e.kind, -e.amount, e.partner_id,
              'Reversal of entry #' || e.id || ': ' || r.description, r.id, e.id);

    when 'setting_change' then
      update settings set value = to_jsonb((r.payload->>'value')::numeric), updated_at = now()
      where key = r.payload->>'key';
      v_petty := setting_num('employee_petty_limit');
      v_big   := setting_num('all_partner_limit');
      if v_petty >= v_big then
        raise exception 'Employee limit (₹%) must stay below the all-partner limit (₹%).', v_petty, v_big;
      end if;

    when 'share_rule' then
      update settings set value = to_jsonb(r.payload->>'profit_rule'), updated_at = now() where key = 'profit_rule';
      update settings set value = to_jsonb(r.payload->>'loss_rule'),   updated_at = now() where key = 'loss_rule';
  end case;
end $$;

create function evaluate_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  r requests;
  v_yes int;
  v_no  int;
begin
  select * into r from requests where id = p_id for update;
  if r.status <> 'pending' then return; end if;

  select count(*) filter (where decision = 'approve'),
         count(*) filter (where decision = 'reject')
    into v_yes, v_no
  from votes where request_id = p_id;

  perform set_config('zs.internal', 'on', true);

  if v_yes >= r.required_approvals then
    update requests set status = 'approved', decided_at = now() where id = p_id;
    perform apply_request(p_id);
  elsif v_no > partner_count() - r.required_approvals then
    -- enough partners said no that approval is no longer possible
    update requests set status = 'rejected', decided_at = now() where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Functions the app calls
-- ---------------------------------------------------------------------

-- Raise any request. Returns the request number.
create function raise_request(
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
  e        ledger;
begin
  m := current_member();
  if m.id is null then
    raise exception 'You are not registered as a Z-SHIRTS member.';
  end if;
  if m.role = 'employee' and p_type not in ('expense', 'income') then
    raise exception 'Employees can only record expenses and income.';
  end if;
  if month_is_closed(today_ist()) then
    raise exception 'This month is already closed by all partners.';
  end if;

  p_payload := coalesce(p_payload, '{}'::jsonb);

  case p_type
    when 'expense' then
      if p_amount is null then raise exception 'Enter the expense amount.'; end if;
      if coalesce(trim(p_proof_path), '') = '' then
        raise exception 'A photo of the bill is required for every expense.';
      end if;
      v_req := case when p_amount <= v_petty then 0
                    when p_amount <= v_big   then least(2, v_n)
                    else v_n end;

    when 'income' then
      if p_amount is null then raise exception 'Enter the amount received.'; end if;
      v_req := least(2, v_n);   -- money coming in is still confirmed by 2 partners

    when 'capital_in', 'partner_payout' then
      if p_amount is null then raise exception 'Enter the amount.'; end if;
      if coalesce(trim(p_proof_path), '') = '' then
        raise exception 'Attach the bank transfer screenshot as proof.';
      end if;
      if not exists (select 1 from members
                     where id = (p_payload->>'partner_id')::uuid and role = 'partner' and active) then
        raise exception 'Choose which partner this is for.';
      end if;
      v_req := v_n;

    when 'reversal' then
      select * into e from ledger where id = (p_payload->>'entry_id')::bigint;
      if e.id is null then raise exception 'Entry not found.'; end if;
      if e.reverses_entry is not null then raise exception 'A reversal cannot itself be reversed. Raise a new entry.'; end if;
      if exists (select 1 from ledger where reverses_entry = e.id) then
        raise exception 'Entry #% has already been reversed.', e.id;
      end if;
      if exists (select 1 from requests where type = 'reversal' and status = 'pending'
                 and payload->>'entry_id' = e.id::text) then
        raise exception 'A reversal for entry #% is already waiting for approval.', e.id;
      end if;
      p_amount := abs(e.amount);
      v_req := v_n;

    when 'setting_change' then
      if p_payload->>'key' not in ('employee_petty_limit', 'all_partner_limit') then
        raise exception 'Only the spending limits can be changed this way.';
      end if;
      if (p_payload->>'value')::numeric is null or (p_payload->>'value')::numeric <= 0 then
        raise exception 'Enter a valid amount.';
      end if;
      if (p_payload->>'key' = 'employee_petty_limit' and (p_payload->>'value')::numeric >= v_big)
         or (p_payload->>'key' = 'all_partner_limit' and (p_payload->>'value')::numeric <= v_petty) then
        raise exception 'Employee limit must stay below the all-partner limit (now ₹% and ₹%).', v_petty, v_big;
      end if;
      v_req := v_n;

    when 'share_rule' then
      if p_payload->>'profit_rule' not in ('investment', 'equal')
         or p_payload->>'loss_rule' not in ('investment', 'equal') then
        raise exception 'Choose investment or equal for both profit and loss.';
      end if;
      v_req := v_n;
  end case;

  perform set_config('zs.internal', 'on', true);

  insert into requests (type, amount, description, proof_path, payload, raised_by, required_approvals)
  values (p_type, p_amount, trim(p_description), nullif(trim(p_proof_path), ''), p_payload, m.id, v_req)
  returning id into v_id;

  -- a partner who raises a request is counted as approving it
  if m.role = 'partner' and v_req > 0 then
    insert into votes (request_id, member_id, decision, note)
    values (v_id, m.id, 'approve', 'Raised this request');
  end if;

  perform evaluate_request(v_id);
  return v_id;
end $$;

-- A partner approves or rejects a pending request.
create function cast_vote(p_request_id bigint, p_decision vote_decision, p_note text default null)
returns request_status
language plpgsql security definer set search_path = public as $$
declare
  m members;
  r requests;
begin
  m := current_member();
  if m.id is null or m.role <> 'partner' then
    raise exception 'Only partners can approve or reject.';
  end if;
  select * into r from requests where id = p_request_id;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %.', r.status; end if;
  if exists (select 1 from votes where request_id = p_request_id and member_id = m.id) then
    raise exception 'You have already voted on this request.';
  end if;
  if p_decision = 'reject' and coalesce(trim(p_note), '') = '' then
    raise exception 'Please write a reason when rejecting.';
  end if;

  perform set_config('zs.internal', 'on', true);
  insert into votes (request_id, member_id, decision, note)
  values (p_request_id, m.id, p_decision, nullif(trim(p_note), ''));

  perform evaluate_request(p_request_id);
  return (select status from requests where id = p_request_id);
end $$;

-- Whoever raised a pending request can withdraw it.
create function cancel_request(p_request_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  r requests;
begin
  select * into r from requests where id = p_request_id;
  if r.id is null or r.raised_by is distinct from m.id then
    raise exception 'You can only cancel your own requests.';
  end if;
  if r.status <> 'pending' then raise exception 'Only pending requests can be cancelled.'; end if;
  perform set_config('zs.internal', 'on', true);
  update requests set status = 'cancelled', decided_at = now() where id = p_request_id;
end $$;

-- A partner signs off a finished month. When every partner has signed, it is locked.
create function sign_month_close(p_month date, p_bank_balance numeric, p_note text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  m members := current_member();
  v_month date := date_trunc('month', p_month)::date;
begin
  if m.id is null or m.role <> 'partner' then
    raise exception 'Only partners can close a month.';
  end if;
  if v_month >= date_trunc('month', today_ist())::date then
    raise exception 'A month can only be closed after it has ended.';
  end if;
  if p_bank_balance is null then
    raise exception 'Enter the closing balance from the bank statement.';
  end if;
  if exists (select 1 from month_close_signatures where month = v_month and member_id = m.id) then
    raise exception 'You have already signed this month.';
  end if;
  perform set_config('zs.internal', 'on', true);
  insert into month_close_signatures (month, member_id, bank_balance, note)
  values (v_month, m.id, p_bank_balance, nullif(trim(p_note), ''));
  return (select count(*)::int from month_close_signatures where month = v_month);
end $$;

-- ---------------------------------------------------------------------
-- Link a login to a member automatically (by e-mail)
-- ---------------------------------------------------------------------
create function link_member_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('zs.internal', 'on', true);
  update members set auth_user_id = new.id
  where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function link_member_on_signup();

-- ---------------------------------------------------------------------
-- Reports (views run with the viewer's own permissions)
-- ---------------------------------------------------------------------
create view partner_positions with (security_invoker = true) as
with p as (
  select id, name from members where role = 'partner' and active
), cap as (
  select partner_id,
         coalesce(sum(amount) filter (where kind = 'capital_in'), 0)       as capital,
         coalesce(-sum(amount) filter (where kind = 'partner_payout'), 0)  as payouts
  from ledger where partner_id is not null group by partner_id
), tot as (
  select coalesce(sum(capital), 0) as total_capital from cap
), res as (
  select coalesce(sum(amount) filter (where kind in ('expense', 'income')), 0) as result from ledger
), rules as (
  select (select value #>> '{}' from settings where key = 'profit_rule') as profit_rule,
         (select value #>> '{}' from settings where key = 'loss_rule')   as loss_rule
), n as (
  select count(*) as n from p
), calc as (
  select p.id as partner_id, p.name,
         coalesce(cap.capital, 0) as capital,
         coalesce(cap.payouts, 0) as payouts,
         case when tot.total_capital > 0 then coalesce(cap.capital, 0) / tot.total_capital end as investment_share,
         res.result as business_result,
         case when res.result >= 0 then rules.profit_rule else rules.loss_rule end as applied_rule,
         n.n
  from p
  left join cap on cap.partner_id = p.id
  cross join tot cross join res cross join rules cross join n
)
select partner_id, name, capital, payouts, investment_share, business_result, applied_rule,
       case applied_rule when 'investment' then investment_share
                         when 'equal'      then 1.0 / n end                       as result_share,
       round(business_result * case applied_rule when 'investment' then investment_share
                                                 when 'equal' then 1.0 / n end, 2) as result_amount,
       -- what this partner would get back (+) or owe (−) if the business were settled today
       round(capital - payouts + business_result * case applied_rule when 'investment' then investment_share
                                                                     when 'equal' then 1.0 / n end, 2) as settlement_balance
from calc
where is_partner();

create view business_summary with (security_invoker = true) as
select
  coalesce(sum(amount), 0)                                               as cash_balance,
  coalesce(sum(amount)  filter (where kind = 'capital_in'), 0)           as total_capital,
  coalesce(-sum(amount) filter (where kind = 'partner_payout'), 0)       as total_payouts,
  coalesce(-sum(amount) filter (where kind = 'expense'), 0)              as total_expenses,
  coalesce(sum(amount)  filter (where kind = 'income'), 0)               as total_income,
  coalesce(sum(amount)  filter (where kind in ('income', 'expense')), 0) as business_result
from ledger;

create view request_board with (security_invoker = true) as
select r.*,
       m.name as raised_by_name,
       m.role as raised_by_role,
       coalesce(v.yes, 0) as approvals,
       coalesce(v.no, 0)  as rejections,
       v.voters
from requests r
join members m on m.id = r.raised_by
left join lateral (
  select count(*) filter (where decision = 'approve') as yes,
         count(*) filter (where decision = 'reject')  as no,
         jsonb_agg(jsonb_build_object('member_id', vt.member_id, 'name', mm.name,
                                      'decision', vt.decision, 'note', vt.note, 'at', vt.created_at)
                   order by vt.created_at) as voters
  from votes vt join members mm on mm.id = vt.member_id
  where vt.request_id = r.id
) v on true;

create view month_status with (security_invoker = true) as
with m as (
  select date_trunc('month', entry_date)::date as month, sum(amount) as month_movement
  from ledger group by 1
)
select m.month,
       m.month_movement,
       sum(m.month_movement) over (order by m.month)                     as closing_balance,
       (select count(*) from month_close_signatures s where s.month = m.month) as signatures,
       month_is_closed(m.month)                                           as locked
from m;

-- ---------------------------------------------------------------------
-- Row-level security: who can SEE what
-- ---------------------------------------------------------------------
alter table members                enable row level security;
alter table settings               enable row level security;
alter table requests               enable row level security;
alter table votes                  enable row level security;
alter table ledger                 enable row level security;
alter table month_close_signatures enable row level security;
alter table audit_log              enable row level security;

create policy members_read  on members  for select to authenticated using ((current_member()).id is not null);
create policy settings_read on settings for select to authenticated using ((current_member()).id is not null);

create policy requests_read on requests for select to authenticated
  using (is_partner() or raised_by = (current_member()).id);

create policy votes_read on votes for select to authenticated
  using (is_partner() or exists (select 1 from requests r
                                 where r.id = request_id and r.raised_by = (current_member()).id));

create policy ledger_read     on ledger                 for select to authenticated using (is_partner());
create policy signatures_read on month_close_signatures for select to authenticated using (is_partner());
create policy audit_read      on audit_log              for select to authenticated using (is_partner());

-- No one writes to tables directly — only through the functions above.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;

-- Internal engine functions are never callable from outside.
revoke execute on function apply_request(bigint)    from public, anon, authenticated;
revoke execute on function evaluate_request(bigint) from public, anon, authenticated;
revoke execute on function link_member_on_signup()  from public, anon, authenticated;

-- What the app is allowed to call.
revoke execute on function raise_request(request_type, numeric, text, text, jsonb) from public, anon;
revoke execute on function cast_vote(bigint, vote_decision, text)                  from public, anon;
revoke execute on function cancel_request(bigint)                                  from public, anon;
revoke execute on function sign_month_close(date, numeric, text)                   from public, anon;
grant  execute on function raise_request(request_type, numeric, text, text, jsonb) to authenticated;
grant  execute on function cast_vote(bigint, vote_decision, text)                  to authenticated;
grant  execute on function cancel_request(bigint)                                  to authenticated;
grant  execute on function sign_month_close(date, numeric, text)                   to authenticated;
