-- =====================================================================
-- SINDIICAT · 020 · Small changes go through without a vote
-- A price change of up to ₹X (selling price and MRP each move by ₹X or less)
-- applies straight away. Bigger changes still need every partner.
-- Changing X itself needs every partner (protected setting).
-- =====================================================================

do $$ begin
  perform set_config('zs.internal', 'on', true);
  insert into settings (key, value, label, kind, grp, protected) values
    ('no_vote_below', '100', 'Price changes up to this much (₹) apply without a partner vote', 'number', 'Money & approvals', true)
  on conflict (key) do nothing;
end $$;

-- rebuild raise_request from the live definition with two small edits
do $$
declare def text; n0 text;
begin
  def := pg_get_functiondef('public.raise_request(request_type, numeric, text, text, jsonb)'::regprocedure);
  n0 := def;
  def := replace(def,
$a$        raise exception 'A price change for this product is already waiting for approval.';
      end if;
      v_req := v_n;$a$,
$b$        raise exception 'A price change for this product is already waiting for approval.';
      end if;
      -- small tweaks need no vote
      v_req := case when abs((p_payload->>'price')::numeric - pr.price) <= coalesce(setting_num('no_vote_below'), 0)
                     and abs((p_payload->>'mrp')::numeric - pr.mrp) <= coalesce(setting_num('no_vote_below'), 0)
                    then 0 else v_n end;$b$);
  if def = n0 then raise exception 'raise_request: price block not found'; end if;
  n0 := def;
  def := replace(def, $a$'discount_free_pct', 'discount_bulk_pcs', 'max_partner_discount_pct')$a$,
                      $b$'discount_free_pct', 'discount_bulk_pcs', 'max_partner_discount_pct', 'no_vote_below')$b$);
  if def = n0 then raise exception 'raise_request: settings list not found'; end if;
  execute def;
end $$;

notify pgrst, 'reload schema';
