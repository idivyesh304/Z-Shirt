-- Sample members used only by the automatic tests (the real list is supabase/seed/members.sql)
select set_config('zs.internal', 'on', false);
insert into members (name, email, role) values
  ('Aaryak Patel',      'aaryak@example.com',   'partner'),
  ('Ayush Fotariya',    'ayush@example.com',    'partner'),
  ('Devanshi Panchal',  'devanshi@example.com', 'partner'),
  ('Jigar Panchal',     'jigar@example.com',    'partner'),
  ('Mahendra Sisodiya', 'mahendra@example.com', 'employee');
