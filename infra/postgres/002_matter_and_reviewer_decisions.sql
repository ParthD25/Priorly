-- Priorly migration: client matter record + per-finding reviewer decisions.
-- Apply AFTER infra/postgres/001_priorly_schema.sql, to the dedicated Priorly
-- project only. Idempotent against a fresh 001 baseline (IF NOT EXISTS guards);
-- policies are created once, so do not re-run on an already-migrated database.
-- An empty client_name is the explicit "Confidential / unnamed" record: a
-- missing client name is never invented or inferred. matter_type is a plain
-- select with no inference. Reviewer decisions are always recorded by a named
-- human reviewer with a timestamp and are never pre-filled.

begin;

alter table public.priorly_projects
  add column if not exists client_name text not null default '' check (char_length(client_name) <= 200),
  add column if not exists matter_reference text not null default '' check (char_length(matter_reference) <= 120),
  add column if not exists matter_type text not null default ''
    check (matter_type in ('', 'ip', 'commercial', 'corporate', 'other')),
  add column if not exists jurisdiction text not null default '' check (char_length(jurisdiction) <= 120);

-- One decision per finding (evidence item or technical claim). The composite
-- foreign key ties every decision to a project owned by the deciding user, so
-- a decision can never attach to another account's matter. The finding_id is
-- validated against the same project by the application before writing.
create table if not exists public.priorly_reviewer_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  finding_type text not null check (finding_type in ('evidence', 'claim')),
  finding_id uuid not null,
  decision text not null check (decision in ('unreviewed','confirmed_overlap','not_overlap','needs_research')),
  note text not null default '' check (char_length(note) <= 1500),
  reviewer_id uuid not null,
  reviewer_email text not null default '' check (char_length(reviewer_email) <= 254),
  decided_at timestamptz not null default now(),
  unique (project_id, finding_type, finding_id),
  foreign key (project_id, owner_id) references public.priorly_projects(id, owner_id) on delete cascade
);
create index if not exists priorly_decisions_project on public.priorly_reviewer_decisions(project_id);

alter table public.priorly_reviewer_decisions enable row level security;

create policy priorly_decisions_select on public.priorly_reviewer_decisions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy priorly_decisions_insert on public.priorly_reviewer_decisions
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy priorly_decisions_update on public.priorly_reviewer_decisions
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

revoke all on public.priorly_reviewer_decisions from anon;
revoke all on public.priorly_reviewer_decisions from authenticated;
grant usage on schema public to authenticated;
grant select,insert,update on public.priorly_reviewer_decisions to authenticated;

commit;
