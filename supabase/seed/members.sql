-- =====================================================================
-- Z-SHIRTS · Add the 4 partners and the employee
-- 1. Replace each e-mail below with that person's real e-mail.
-- 2. Run this once in Supabase → SQL Editor.
-- Each person then signs up in the app with THAT e-mail and is linked
-- automatically. Anyone signing up with another e-mail gets no access.
-- =====================================================================

select set_config('zs.internal', 'on', false);

insert into members (name, email, role) values
  ('Aaryak Patel',     'aaryak@example.com',   'partner'),
  ('Ayush Fotariya',   'ayush@example.com',    'partner'),
  ('Devanshi Panchal', 'devanshi@example.com', 'partner'),
  ('Jigar Panchal',    'jigar@example.com',    'partner'),
  ('Store Manager',    'store@example.com',    'employee');
