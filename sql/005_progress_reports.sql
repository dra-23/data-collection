-- SPEDreport — saved progress reports (one per student per grading period).
-- Run in the Supabase SQL Editor (after 004_grading_periods.sql).
--
-- Additive only: creates one new table. Does not alter, drop, or add
-- policies to any existing table.
--
-- Access model: same as the abc_* tables — a report is reachable only
-- through a student the signed-in account owns (students.owner_id =
-- auth.uid()).
--
-- Each report stores the teacher's chosen rating and edited narrative for
-- every goal (and SPEDsight behavior), plus a frozen snapshot of the
-- numbers they were based on — so a report already sent home doesn't
-- change if an old point sheet is edited later.

begin;

create table progress_reports (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  -- Grading period, from the School Calendar (grading_periods): 2026 =
  -- the 2026–2027 school year.
  school_year  smallint not null check (school_year between 2000 and 2100),
  period       text not null check (period in ('Q1','Q2','Q3','Q4','S1','S2')),
  range_start  date not null,
  range_end    date not null,
  status       text not null default 'draft' check (status in ('draft','final')),
  -- [{ goalId, goalName, rating, narrative, snapshot: {...} }]
  goals        jsonb not null default '[]'::jsonb check (jsonb_typeof(goals) = 'array'),
  -- [{ behaviorId, behaviorName, include, narrative, snapshot: {...} }]
  behaviors    jsonb not null default '[]'::jsonb check (jsonb_typeof(behaviors) = 'array'),
  finalized_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (range_end >= range_start),
  unique (student_id, school_year, period)
);

create or replace function progress_reports_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger progress_reports_touch before update on progress_reports
  for each row execute function progress_reports_touch();

alter table progress_reports enable row level security;

-- Signed-out visitors (anon) get no table privileges at all.
revoke all on progress_reports from anon;

create policy "own progress_reports" on progress_reports
  for all to authenticated
  using      (exists (select 1 from students s where s.id = progress_reports.student_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from students s where s.id = progress_reports.student_id and s.owner_id = (select auth.uid())));

commit;

-- ═══════════════════════════════════════════════════════════════
-- Verify (run separately after the script succeeds)
-- ═══════════════════════════════════════════════════════════════
-- Should show rowsecurity = true:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename = 'progress_reports';
-- One policy, roles {authenticated}:
--   select policyname, cmd, roles from pg_policies
--   where tablename = 'progress_reports';
