-- Partner-only rules stay hidden from employees.
-- Profit/loss split, each partner's share, income tax rate, the "all partners" limit,
-- the no-vote limit and the partner discount cap are read only by partners.
drop policy if exists settings_read on settings;
create policy settings_read on settings for select to authenticated using (
  (current_member()).id is not null
  and (is_partner() or key not in ('custom_split', 'profit_rule', 'loss_rule', 'income_tax_rate_pct',
                                   'all_partner_limit', 'no_vote_below', 'max_partner_discount_pct'))
);
