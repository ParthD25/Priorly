\set ON_ERROR_STOP on
-- All IDs are synthetic. Assertions are executed as the same unprivileged
-- authenticated role used by Supabase's exposed Data API.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

insert into public.priorly_projects(id,title,problem)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Project A','First founder project');
insert into public.priorly_projects(id,title)
  values ('abababab-abab-4aba-8aba-abababababab','Project A second');
insert into public.priorly_evidence(id,project_id,source,source_id,title,url,retrieved_at)
  values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'OpenAlex','W123','Example paper','https://openalex.org/W123',now());
insert into public.priorly_evidence(id,project_id,source,source_id,title,url,retrieved_at)
  values ('edededed-eded-4ded-8ded-edededededed','abababab-abab-4aba-8aba-abababababab',
    'GitHub','repo-2','Another example','https://github.com/sample/other',now());
insert into public.priorly_claims(id,project_id,description)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Claim with specific measurable method');
insert into public.priorly_claim_sources(claim_id,evidence_id,project_id,relation)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','uncertain');
insert into public.priorly_research_runs(project_id,result_json)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"papers":[],"repos":[]}'::jsonb);

-- Owner A records matter details and a reviewer decision on own findings.
update public.priorly_projects
  set client_name='Acme Corporation',matter_reference='2026-IP-014',matter_type='ip',jurisdiction='US (California)'
  where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.priorly_reviewer_decisions(project_id,finding_type,finding_id,decision,note,reviewer_id,reviewer_email)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','evidence','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'confirmed_overlap','Same mechanism disclosed in column 3.','11111111-1111-4111-8111-111111111111','attorney@firm.test');
insert into public.priorly_reviewer_decisions(project_id,finding_type,finding_id,decision,note,reviewer_id,reviewer_email)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','claim','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'needs_research','Publication does not address the qualification constraint.','11111111-1111-4111-8111-111111111111','attorney@firm.test');
do $$
begin
  if (select decision from public.priorly_reviewer_decisions
      where finding_type='evidence' and finding_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') <> 'confirmed_overlap' then
    raise exception 'owner cannot read back own reviewer decision';
  end if;
  if (select client_name from public.priorly_projects where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'Acme Corporation' then
    raise exception 'owner cannot read back own matter record';
  end if;
  begin
    insert into public.priorly_reviewer_decisions(project_id,finding_type,finding_id,decision,note,reviewer_id)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','evidence','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeff',
        'patentable','Never a legal conclusion.','11111111-1111-4111-8111-111111111111');
    raise exception 'invalid reviewer decision value accepted';
  exception when check_violation then null;
  end;
end $$;

-- Owner A may NOT attach source from A's *other* project to claim in this project.
do $$
begin
  begin
    insert into public.priorly_claim_sources(claim_id,evidence_id,project_id,relation)
    values('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'edededed-eded-4ded-8ded-edededededed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','overlap');
    raise exception 'cross-project link unexpectedly succeeded';
  exception when foreign_key_violation then null;
  end;
end $$;

set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
insert into public.priorly_projects(id,title)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Project B');

do $$
declare affected integer;
begin
  if (select count(*) from public.priorly_projects) <> 1 then
    raise exception 'user B can see user A projects';
  end if;
  if (select count(*) from public.priorly_evidence) <> 0 then
    raise exception 'user B can see user A evidence';
  end if;
  if (select count(*) from public.priorly_claims) <> 0 then
    raise exception 'user B can see user A claims';
  end if;
  if (select count(*) from public.priorly_claim_sources) <> 0 then
    raise exception 'user B can see user A links';
  end if;
  if (select count(*) from public.priorly_research_runs) <> 0 then
    raise exception 'user B can see user A research runs';
  end if;
  if (select count(*) from public.priorly_reviewer_decisions) <> 0 then
    raise exception 'user B can see user A reviewer decisions';
  end if;
  -- Cross-account denials: matter details and decisions of another owner.
  update public.priorly_projects set client_name='Spoofed client',matter_reference='stolen'
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'cross-owner matter update succeeded'; end if;
  begin
    insert into public.priorly_reviewer_decisions(project_id,finding_type,finding_id,decision,reviewer_id)
      values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','evidence','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'confirmed_overlap','22222222-2222-4222-8222-222222222222');
    raise exception 'cross-owner decision insert unexpectedly succeeded';
  exception when foreign_key_violation then null;
  when insufficient_privilege then null;
  end;
  update public.priorly_reviewer_decisions set decision='not_overlap',note='Tampered';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'cross-owner decision update succeeded'; end if;
end $$;

-- RLS blocks attempts to impersonate another owner even when a supplied
-- project UUID is known.
do $$
begin
  begin
    insert into public.priorly_projects(id,owner_id,title)
      values('cccccccc-cccc-4ccc-8ccc-dddddddddddd',
        '11111111-1111-4111-8111-111111111111','Spoofed project');
    raise exception 'owner impersonation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare affected integer;
begin
  update public.priorly_projects set title='Illicit update'
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'cross-owner update succeeded'; end if;
  delete from public.priorly_claims where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'cross-owner claim delete succeeded'; end if;
end $$;

-- No direct audit log access, even as an authenticated user.
do $$
begin
  begin
    perform count(*) from public.priorly_audit_events;
    raise exception 'audit table exposed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set role anon;
do $$
begin
  begin
    perform count(*) from public.priorly_projects;
    raise exception 'anon read unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'Postgres RLS / composite FK isolation tests passed' as result;
