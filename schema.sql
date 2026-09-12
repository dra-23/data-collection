-- Data Collection — Supabase schema
-- Run this once in your new Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste this whole file → Run).

-- Shared reference list (same 15 IDEA categories for both accounts, not
-- owner-scoped) — used by the Eligibility dropdown on the student form.
create table sped_eligibilities (
  id uuid primary key default gen_random_uuid(),
  eligibility text not null,
  eligibility_code text not null,
  display_order int not null
);

insert into sped_eligibilities (id, eligibility, eligibility_code, display_order) values
  ('05966062-8bcd-442c-b290-a0dfe63f8314', 'Hearing Impairment', '02', 2),
  ('08bb129c-4e46-40de-b554-70aee476216f', 'Intellectual Disability', '01', 1),
  ('21445628-f2c3-4bba-8681-b5b4fd6ce93a', 'Other Health Impairment', '07', 7),
  ('2928f281-47f9-440e-b2aa-8a90f3d1c0f8', 'Traumatic Brain Injury', '12', 12),
  ('49982f3f-b38c-4886-a6d2-e7c65b849be5', 'Diagnostic', '00', 15),
  ('4da9571f-1baf-437e-b322-3f9a73db1db9', 'Autism', '11', 11),
  ('7e6cf2a5-a643-46ae-8f12-a0f4228862d8', 'Developmental Delay', '13', 13),
  ('946d92c2-0594-4420-b472-eca5bc5edc57', 'Deaf-Blindness', '09', 9),
  ('a20c4e2b-427f-44b0-9b8e-ad82e337d53b', 'Multiple Disabilities', '10', 10),
  ('a955264f-eee4-4245-bc55-ddc5ccbc065e', 'Emotional Disability', '05', 5),
  ('badaeb62-aa8c-4851-8e27-bbb518abc6bc', 'Specific Learning Disability', '08', 8),
  ('c13956a8-7a16-4815-9199-196927746198', 'Orthopedic Impairments', '06', 6),
  ('da611755-70ef-47fe-bc9d-cd50c78a23c2', 'Visual Impairments', '04', 4),
  ('dcd81232-f7c7-431f-abc6-9cc08c3a3bef', 'Speech or Language Impairment', '03', 3),
  ('f833b719-b74f-4ce1-a1ab-ed6c01b75a1c', 'Deafness', '14', 14);

create table students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  first_name text not null default '',
  last_name text not null default '',
  grade text default '',
  status text default '',            -- 'Full-Time' | 'Part-Time Transition' | 'Starting' | 'Exiting'
  date_of_placement date,
  campus text default '',
  classroom text default '',
  teacher text default '',
  goals jsonb not null default '[]',
  pn jsonb not null default '{}',    -- position -> subject_id (references subjects.id; not free text)
  pt jsonb not null default '{}',    -- period time ranges, e.g. "8:00am - 8:40am"
  period_count int not null default 9,  -- how many of the 9 periods this student uses
  track_location boolean not null default true,      -- show Push-In/Pull-Out on each period
  track_participation boolean not null default true, -- show the 1-4 star Participation rating
  track_support boolean not null default true,       -- show the Support level buttons
  track_notes boolean not null default true,         -- show the per-period Notes field
  track_goals boolean not null default true,         -- show the Goals section
  eligibility_id uuid references sped_eligibilities(id),
  related_service_minutes int,
  related_service_frequency text,    -- 'week' | 'month' | 'quarter' | 'trimester' | 'semester' | 'year'
  iep_meeting_date date,
  iep_start_date date,
  iep_end_date date,
  active boolean not null default true,  -- deactivated students are hidden from the roster, not deleted
  created_at timestamptz not null default now()
);

create table daily_points (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  date date not null,
  scores jsonb default '{}',
  goal_scores jsonb default '{}',
  participation_scores jsonb default '{}',  -- 1-4 star rating per period
  period_names jsonb default '{}',          -- snapshot of that day's students.pn (position -> subject_id), frozen once set
  support_scores jsonb default '{}',        -- 'Independent' | 'Mostly Independent' | 'Partial Support' | 'Max Support' per period
  period_notes jsonb default '{}',          -- free-text note per period
  location_type jsonb default '{}',         -- 'Push-In' | 'Pull-Out' per period
  coupons int default 0,
  comments text default '',
  unique(student_id, date)
);

-- Autocomplete helper — grows automatically as teacher names are typed
-- into the student modal (see rememberTeacher() in index.html).
create table teachers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

-- The reference bank a period's subject is picked from (students.pn stores
-- subject_id, not free text) — see getOrCreateSubjectId()/subjectSelectHTML()
-- in index.html.
create table subjects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

-- Contacts for a student (parent/guardian, etc.) — managed inline on the
-- Add/Edit Student form (see loadContactsForModal()/saveContactsForStudent()
-- in index.html).
create table student_contacts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  first_name text default '',
  last_name text default '',
  relationship text default '',
  email text default '',
  phone text default '',
  created_at timestamptz not null default now()
);

alter table sped_eligibilities enable row level security;
alter table students enable row level security;
alter table daily_points enable row level security;
alter table teachers enable row level security;
alter table subjects enable row level security;
alter table student_contacts enable row level security;

-- Shared reference data — any signed-in user can read it, nobody can write.
create policy "read eligibilities" on sped_eligibilities
  for select
  using (true);

-- Each account can only see/edit the students it created itself.
create policy "own students" on students
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Daily point-sheet rows inherit the same scoping through their student.
create policy "own daily_points" on daily_points
  for all
  using (exists (select 1 from students s where s.id = daily_points.student_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from students s where s.id = daily_points.student_id and s.owner_id = auth.uid()));

create policy "own teachers" on teachers
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "own subjects" on subjects
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Contacts inherit scoping through their student, same as daily_points.
create policy "own student_contacts" on student_contacts
  for all
  using (exists (select 1 from students s where s.id = student_contacts.student_id and s.owner_id = auth.uid()))
  with check (exists (select 1 from students s where s.id = student_contacts.student_id and s.owner_id = auth.uid()));

-- Live updates (the app subscribes to changes on the currently-open student).
alter publication supabase_realtime add table daily_points;
