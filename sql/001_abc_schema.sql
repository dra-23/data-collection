-- ABC Data Collection — schema (tables, integrity, row-level security)
-- Run 1st in the Supabase SQL Editor, then 002 and 003.
--
-- Additive only: creates new abc_* tables and functions. Does not alter,
-- drop, or add policies to any existing table (students, subjects, etc.).
--
-- Access model: the same 2 accounts that use index.html are both observers
-- and analysts. Every student-linked abc_* row is reachable only through a
-- student the signed-in account owns (students.owner_id = auth.uid()) —
-- the same pattern daily_points/student_contacts already use. No policy
-- grants access merely for being signed in, except read access to the
-- non-student reference tables (option lists + function mapping).

begin;

-- ═══════════════════════════════════════════════════════════════
-- Reference data (shared, read-only to the app; edit via dashboard)
-- ═══════════════════════════════════════════════════════════════

-- Activity / antecedent / consequence choices. `code` is a stable,
-- globally unique slug (entries store codes, never labels), so a label can
-- be reworded in the dashboard without touching recorded data. Retire an
-- option with active = false rather than deleting it, so historical
-- entries that reference it still resolve.
create table abc_options (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('activity','antecedent','consequence')),
  code          text not null unique,
  label         text not null,
  hint          text not null default '',        -- e.g. "sound, light, quick movement"
  narrative     text not null default '',        -- clause for the draft FBA paragraphs
  has_text      boolean not null default false,  -- selecting it reveals a free-text box
  display_order int not null,
  active        boolean not null default true
);

-- The four behavior functions, with the phrase each contributes to the
-- draft FBA sentence ("... engages in X for attention (38%), to escape ...").
create table abc_functions (
  code          text primary key,                -- 'sensory' | 'escape' | 'attention' | 'tangible'
  label         text not null,
  fba_phrase    text not null,
  display_order int not null
);

-- Which antecedent/consequence codes count toward which function. An
-- option may appear under several functions (e.g. Peer(s) provoked →
-- Sensory and Escape), which is why percentages use the sum of function
-- scores as their denominator rather than the raw number of marks.
create table abc_function_mapping (
  function_code text not null references abc_functions(code) on update cascade on delete cascade,
  option_code   text not null references abc_options(code)   on update cascade on delete cascade,
  primary key (function_code, option_code)
);

-- ═══════════════════════════════════════════════════════════════
-- Student-linked data
-- ═══════════════════════════════════════════════════════════════

-- Per-student list of target behaviors ("Refusal", "Elopement", ...).
-- unique(id, student_id) exists only so the composite foreign keys below
-- can guarantee an entry's behavior belongs to that same student.
create table abc_behaviors (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, student_id)
);
-- Case/whitespace-insensitive, since each behavior is analyzed separately:
-- "Refusal" and "refusal " must not become two behaviors that split the data.
create unique index abc_behaviors_student_name_uq
  on abc_behaviors (student_id, lower(btrim(name)));

-- One observation sitting: student + class + date + observer, set once,
-- then any number of entries are logged against it.
create table abc_sessions (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  observer_id       uuid not null default auth.uid() references auth.users(id),
  class_subject_id  uuid references subjects(id) on delete set null,
  class_text        text not null default '',   -- free-text class when not picked from subjects
  session_date      date not null,              -- the observer's local date (sent by the client)
  created_at        timestamptz not null default now(),
  unique (id, student_id)
);

-- One behavior instance. student_id is repeated from the session so RLS
-- and analysis queries don't need a join; the composite foreign keys keep
-- it consistent with both the session and the behavior.
create table abc_observation_entries (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null,
  student_id         uuid not null references students(id) on delete cascade,
  behavior_id        uuid not null,
  observer_id        uuid not null default auth.uid() references auth.users(id),
  occurred_at        timestamptz not null default now(),
  duration_seconds   int check (duration_seconds is null or duration_seconds >= 0),
  activity_code      text,                       -- nullable: logging fast mid-class shouldn't be blocked
  activity_other     text not null default '',   -- text for "Special" / "Other"
  antecedent_codes   text[] not null default '{}',
  antecedent_other   text not null default '',
  consequence_codes  text[] not null default '{}',
  consequence_other  text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (session_id, student_id)  references abc_sessions(id, student_id)  on delete cascade,
  foreign key (behavior_id, student_id) references abc_behaviors(id, student_id)
);

-- Analyst's saved write-up for one student + behavior + date range.
create table abc_analysis_notes (
  id                           uuid primary key default gen_random_uuid(),
  student_id                   uuid not null references students(id) on delete cascade,
  behavior_id                  uuid not null,
  range_start                  date not null,
  range_end                    date not null check (range_end >= range_start),
  setting_notes                text not null default '',
  environmental_notes          text not null default '',
  indirect_assessment_notes    text not null default '',  -- FAST, QABF, MAS results
  draft_function_statement     text not null default '',
  draft_hypothesis             text not null default '',
  draft_antecedents_paragraph  text not null default '',
  draft_consequences_paragraph text not null default '',
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (student_id, behavior_id, range_start, range_end),
  foreign key (behavior_id, student_id) references abc_behaviors(id, student_id) on delete cascade
);

create index abc_behaviors_student_idx on abc_behaviors (student_id);
create index abc_sessions_student_date_idx on abc_sessions (student_id, session_date);
create index abc_entries_session_idx on abc_observation_entries (session_id);
create index abc_entries_student_behavior_idx on abc_observation_entries (student_id, behavior_id);

-- ═══════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════

create or replace function abc_touch_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger abc_entries_touch before update on abc_observation_entries
  for each row execute function abc_touch_updated_at();
create trigger abc_notes_touch before update on abc_analysis_notes
  for each row execute function abc_touch_updated_at();

-- Arrays can't carry foreign keys, so validate every stored code against
-- abc_options and its category here instead.
create or replace function abc_validate_entry_codes() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.activity_code is not null and not exists (
    select 1 from abc_options where code = new.activity_code and category = 'activity'
  ) then
    raise exception 'Unknown activity code: %', new.activity_code;
  end if;
  if exists (
    select 1 from unnest(new.antecedent_codes) c
    where not exists (select 1 from abc_options o where o.code = c and o.category = 'antecedent')
  ) then
    raise exception 'Unknown antecedent code in %', new.antecedent_codes;
  end if;
  if exists (
    select 1 from unnest(new.consequence_codes) c
    where not exists (select 1 from abc_options o where o.code = c and o.category = 'consequence')
  ) then
    raise exception 'Unknown consequence code in %', new.consequence_codes;
  end if;
  return new;
end $$;

create trigger abc_entries_validate before insert or update on abc_observation_entries
  for each row execute function abc_validate_entry_codes();

-- ═══════════════════════════════════════════════════════════════
-- Row-level security
-- ═══════════════════════════════════════════════════════════════
-- (select auth.uid()) is identical in meaning to auth.uid(); the subselect
-- just lets Postgres evaluate it once per query instead of once per row.

alter table abc_options             enable row level security;
alter table abc_functions           enable row level security;
alter table abc_function_mapping    enable row level security;
alter table abc_behaviors           enable row level security;
alter table abc_sessions            enable row level security;
alter table abc_observation_entries enable row level security;
alter table abc_analysis_notes      enable row level security;

-- Defense in depth: signed-out visitors (the anon role) get no table
-- privileges at all, on top of having no policies.
revoke all on abc_options, abc_functions, abc_function_mapping, abc_behaviors,
  abc_sessions, abc_observation_entries, abc_analysis_notes from anon;
-- Reference data is edited only in the dashboard (which uses a separate
-- privileged role, unaffected by this), never by the app.
revoke insert, update, delete, truncate on abc_options, abc_functions,
  abc_function_mapping from authenticated;

-- Reference data: readable when signed in, never writable from the app.
create policy "read abc_options" on abc_options
  for select to authenticated using (true);
create policy "read abc_functions" on abc_functions
  for select to authenticated using (true);
create policy "read abc_function_mapping" on abc_function_mapping
  for select to authenticated using (true);

-- Behaviors: full access for the student's owner.
create policy "own abc_behaviors" on abc_behaviors
  for all to authenticated
  using      (exists (select 1 from students s where s.id = abc_behaviors.student_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from students s where s.id = abc_behaviors.student_id and s.owner_id = (select auth.uid())));

-- Sessions: the owner sees all of their students' sessions; a session can
-- only be recorded as yourself, and its class (if picked from subjects)
-- must be one of your own subjects.
create policy "read abc_sessions" on abc_sessions
  for select to authenticated
  using (exists (select 1 from students s where s.id = abc_sessions.student_id and s.owner_id = (select auth.uid())));
create policy "insert abc_sessions" on abc_sessions
  for insert to authenticated
  with check (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_sessions.student_id and s.owner_id = (select auth.uid()))
    and (class_subject_id is null or exists (select 1 from subjects sub where sub.id = abc_sessions.class_subject_id and sub.owner_id = (select auth.uid())))
  );
create policy "update own abc_sessions" on abc_sessions
  for update to authenticated
  using (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_sessions.student_id and s.owner_id = (select auth.uid()))
  )
  with check (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_sessions.student_id and s.owner_id = (select auth.uid()))
    and (class_subject_id is null or exists (select 1 from subjects sub where sub.id = abc_sessions.class_subject_id and sub.owner_id = (select auth.uid())))
  );
create policy "delete own abc_sessions" on abc_sessions
  for delete to authenticated
  using (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_sessions.student_id and s.owner_id = (select auth.uid()))
  );

-- Entries: analysts (the owner) view all entries for their students;
-- observers create/edit/delete only entries recorded as themselves.
create policy "read abc_observation_entries" on abc_observation_entries
  for select to authenticated
  using (exists (select 1 from students s where s.id = abc_observation_entries.student_id and s.owner_id = (select auth.uid())));
create policy "insert own abc_observation_entries" on abc_observation_entries
  for insert to authenticated
  with check (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_observation_entries.student_id and s.owner_id = (select auth.uid()))
  );
create policy "update own abc_observation_entries" on abc_observation_entries
  for update to authenticated
  using (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_observation_entries.student_id and s.owner_id = (select auth.uid()))
  )
  with check (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_observation_entries.student_id and s.owner_id = (select auth.uid()))
  );
create policy "delete own abc_observation_entries" on abc_observation_entries
  for delete to authenticated
  using (
    observer_id = (select auth.uid())
    and exists (select 1 from students s where s.id = abc_observation_entries.student_id and s.owner_id = (select auth.uid()))
  );

-- Analysis notes: full access for the student's owner (the analyst).
create policy "own abc_analysis_notes" on abc_analysis_notes
  for all to authenticated
  using      (exists (select 1 from students s where s.id = abc_analysis_notes.student_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from students s where s.id = abc_analysis_notes.student_id and s.owner_id = (select auth.uid())));

commit;

-- ═══════════════════════════════════════════════════════════════
-- Verify (run separately after the script succeeds)
-- ═══════════════════════════════════════════════════════════════
-- Every row should show rowsecurity = true:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'abc\_%' order by tablename;
-- Policies and the roles they apply to (all should be {authenticated}):
--   select tablename, policyname, cmd, roles from pg_policies
--   where tablename like 'abc\_%' order by tablename, policyname;
