-- Grading periods (Quarters 1–4, Semesters 1–2) — the School Calendar used
-- by SPEDsheet's Yearly Summary and SPEDsight's Analyze view.
-- Run in the Supabase SQL Editor (after 001–003; independent of them).
--
-- Additive only: creates one new table. Does not alter, drop, or add
-- policies to any existing table.
--
-- Access model: each account keeps its own calendar. A row is visible and
-- editable only by the account that owns it (owner_id = auth.uid()) — the
-- same rule students/subjects use. No student data lives here, just dates.

begin;

create table grading_periods (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The calendar year the school year starts in: 2026 = the 2026–2027
  -- school year (Jul 1 – Jun 30, the same window the Yearly Summary uses).
  school_year smallint not null check (school_year between 2000 and 2100),
  period      text not null check (period in ('Q1','Q2','Q3','Q4','S1','S2')),
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date),
  -- Keeps every period inside its school year's Jul 1 – Jun 30 window.
  check (start_date >= make_date(school_year, 7, 1) and end_date <= make_date(school_year + 1, 6, 30)),
  unique (owner_id, school_year, period)
);

create or replace function grading_periods_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger grading_periods_touch before update on grading_periods
  for each row execute function grading_periods_touch();

alter table grading_periods enable row level security;

-- Signed-out visitors (anon) get no table privileges at all.
revoke all on grading_periods from anon;

create policy "own grading_periods" on grading_periods
  for all to authenticated
  using      (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

commit;

-- ═══════════════════════════════════════════════════════════════
-- Verify (run separately after the script succeeds)
-- ═══════════════════════════════════════════════════════════════
-- Should show rowsecurity = true:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename = 'grading_periods';
-- One policy, roles {authenticated}:
--   select policyname, cmd, roles, qual, with_check from pg_policies
--   where tablename = 'grading_periods';
