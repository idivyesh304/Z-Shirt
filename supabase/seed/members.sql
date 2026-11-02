-- =====================================================================
-- Z-SHIRTS · Add the 4 partners and the employee
-- 1. Replace each e-mail below with that person's real e-mail.
-- 2. Run this once in Supabase → SQL Editor.
-- Then create each login in Supabase → Authentication → Users → Add user
-- (tick "Auto confirm user"). The login is linked
-- automatically. Anyone signing up with another e-mail gets no access.
-- =====================================================================

select set_config('zs.internal', 'on', false);

insert into members (name, email, role) values
  ('Aaryak Patel',     'aaryakpatel@gmail.com',   'partner'),
  ('Ayush Fotariya',   'ayushfotariya@gmail.com',    'partner'),
  ('Devanshi Panchal', 'kansaradevanshi28@gmail.com', 'partner'),
  ('Jigar Panchal',    'gj112panchal@gmail.com',    'partner'),
  ('Mahendra Sisodiya', 'mahendrasisodiya937@gmail.com', 'employee');
