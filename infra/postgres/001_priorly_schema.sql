-- Priorly: dedicated Supabase/Postgres schema baseline.
-- Apply only to a NEW Priorly project after reviewing data access and costs.
-- This migration does not run against BlueCore or Prysm Style.
-- Designed for Postgres 15+, with Supabase Auth's auth.uid()/auth.users.
-- User-editable auth.user_metadata must NEVER be used for authorization.

begin;

create table if not exists public.priorly_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 90),
  problem text not null default '' check (char_length(problem) <= 1800),
  solution text not null default '' check (char_length(solution) <= 2400),
  audience text not null default '' check (char_length(audience) <= 180),
  keywords text not null default '' check (char_length(keywords) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index if not exists priorly_projects_owner_updated on public.priorly_projects(owner_id, updated_at desc);

create table if not exists public.priorly_research_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (project_id, owner_id) references public.priorly_projects(id, owner_id) on delete cascade
);
create index if not exists priorly_runs_project_created on public.priorly_research_runs(project_id, created_at desc);

create table if not exists public.priorly_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  source text not null check (char_length(source) between 1 and 100),
  source_id text not null check (char_length(source_id) between 1 and 1500),
  title text not null check (char_length(title) between 1 and 400),
  url text not null check (left(url, 8) = 'https://' and char_length(url) <= 1600),
  classification text not null default 'unreviewed'
    check (classification in ('unreviewed','overlap','differentiated','irrelevant','needs-review')),
  note text not null default '' check (char_length(note) <= 1500),
  retrieved_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (project_id, source, source_id),
  unique (id, project_id, owner_id),
  foreign key (project_id, owner_id) references public.priorly_projects(id, owner_id) on delete cascade
);
create index if not exists priorly_evidence_project_updated on public.priorly_evidence(project_id, updated_at desc);

create table if not exists public.priorly_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  description text not null check (char_length(description) between 10 and 350),
  mechanism text not null default '' check (char_length(mechanism) <= 1800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id, owner_id),
  foreign key (project_id, owner_id) references public.priorly_projects(id, owner_id) on delete cascade
);
create index if not exists priorly_claims_project_created on public.priorly_claims(project_id, created_at);

create table if not exists public.priorly_claim_sources (
  claim_id uuid not null,
  evidence_id uuid not null,
  project_id uuid not null,
  owner_id uuid not null default auth.uid(),
  relation text not null check (relation in ('overlap','possible-difference','background','uncertain')),
  source_excerpt text not null default '' check (char_length(source_excerpt) <= 1000),
  rationale text not null default '' check (char_length(rationale) <= 1500),
  updated_at timestamptz not null default now(),
  primary key (claim_id,evidence_id),
  foreign key (claim_id,project_id,owner_id)
    references public.priorly_claims(id,project_id,owner_id) on delete cascade,
  foreign key (evidence_id,project_id,owner_id)
    references public.priorly_evidence(id,project_id,owner_id) on delete cascade
);
create index if not exists priorly_claim_sources_project on public.priorly_claim_sources(project_id);

-- Internal-only audit sink. No INSERT/SELECT grants to app users: only privileged backend
-- jobs may write audit events and they must validate a real actor and target themselves.
create table if not exists public.priorly_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid null,
  actor_id uuid null references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (project_id, owner_id) references public.priorly_projects(id,owner_id) on delete cascade
);
create index if not exists priorly_audit_events_owner_created on public.priorly_audit_events(owner_id,created_at desc);

alter table public.priorly_projects enable row level security;
alter table public.priorly_research_runs enable row level security;
alter table public.priorly_evidence enable row level security;
alter table public.priorly_claims enable row level security;
alter table public.priorly_claim_sources enable row level security;
alter table public.priorly_audit_events enable row level security;

-- All browser-facing tables are subject to independent owner checks.
-- We deliberately do not infer authorization from user-editable JWT metadata.
create policy priorly_projects_select on public.priorly_projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy priorly_projects_insert on public.priorly_projects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy priorly_projects_update on public.priorly_projects
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy priorly_projects_delete on public.priorly_projects
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy priorly_runs_select on public.priorly_research_runs
  for select to authenticated using (owner_id = (select auth.uid()));
create policy priorly_runs_insert on public.priorly_research_runs
  for insert to authenticated with check (owner_id = (select auth.uid()));
-- Research runs are append-only to authenticated users: no UPDATE or DELETE policy.

create policy priorly_evidence_select on public.priorly_evidence
  for select to authenticated using (owner_id = (select auth.uid()));
create policy priorly_evidence_insert on public.priorly_evidence
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy priorly_evidence_update on public.priorly_evidence
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
-- No evidence DELETE policy. Removing a project cascades rows.

create policy priorly_claims_select on public.priorly_claims
  for select to authenticated using (owner_id = (select auth.uid()));
create policy priorly_claims_insert on public.priorly_claims
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy priorly_claims_update on public.priorly_claims
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy priorly_claims_delete on public.priorly_claims
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy priorly_links_select on public.priorly_claim_sources
  for select to authenticated using (owner_id = (select auth.uid()));
create policy priorly_links_insert on public.priorly_claim_sources
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy priorly_links_update on public.priorly_claim_sources
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy priorly_links_delete on public.priorly_claim_sources
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Explicit grants avoid depending on project-wide default grants.
-- Row security determines *which* rows authorized clients may use.
revoke all on public.priorly_projects,public.priorly_research_runs,public.priorly_evidence,
  public.priorly_claims,public.priorly_claim_sources,public.priorly_audit_events from anon;
revoke all on public.priorly_projects,public.priorly_research_runs,public.priorly_evidence,
  public.priorly_claims,public.priorly_claim_sources,public.priorly_audit_events from authenticated;
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.priorly_projects to authenticated;
grant select,insert on public.priorly_research_runs to authenticated;
grant select,insert,update on public.priorly_evidence to authenticated;
grant select,insert,update,delete on public.priorly_claims,public.priorly_claim_sources to authenticated;
-- No grants and no policies for audit_events: default-deny.

commit;
