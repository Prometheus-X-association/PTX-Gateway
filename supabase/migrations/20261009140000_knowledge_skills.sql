-- All access goes through the authenticated knowledge API and service workers.
create table public.knowledge_stores (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 name text not null, kind text not null check(kind in ('rag','knowledge_graph','vector')),
 provider text not null check(provider in ('managed','rest')), endpoint text not null default '', secret_ciphertext text,
 active boolean not null default false, settings jsonb not null default '{}', revision integer not null default 1,
 deleted_at timestamptz, created_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), unique(organization_id,id)
);
create table public.knowledge_records (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 kind text not null check(kind in ('document','skill','mapping','job')), name text not null, body jsonb not null,
 revision integer not null default 1, deleted_at timestamptz, updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 foreign key(organization_id,store_id) references knowledge_stores(organization_id,id), unique(organization_id,store_id,id)
);
create table public.knowledge_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null, record_id uuid not null,
 revision integer not null, name text not null, body jsonb not null, deleted boolean not null default false,
 actor_id uuid not null references auth.users(id), workflow_run_id uuid, workflow_context jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(organization_id,store_id,record_id) references knowledge_records(organization_id,store_id,id), unique(record_id,revision)
);
create table public.knowledge_edges (
 organization_id uuid not null, store_id uuid not null, source_id uuid not null, target_id uuid not null,
 relation text not null check(relation in ('evidenced_by','maps_skill','requires_skill')), target_revision integer not null, detail jsonb not null default '{}',
 foreign key(organization_id,store_id,source_id) references knowledge_records(organization_id,store_id,id),
 foreign key(organization_id,store_id,target_id) references knowledge_records(organization_id,store_id,id), primary key(source_id,target_id,relation,target_revision)
);
create table public.knowledge_chunks (
 organization_id uuid not null, store_id uuid not null, record_id uuid not null, revision integer not null, ordinal integer not null, content text not null,
 search tsvector generated always as (to_tsvector('simple',content)) stored,
 foreign key(organization_id,store_id,record_id) references knowledge_records(organization_id,store_id,id), primary key(record_id,ordinal)
);
create index knowledge_chunks_search on knowledge_chunks using gin(search);
create table public.knowledge_jobs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null,
 actor_id uuid not null references auth.users(id), workflow_id text not null, input jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','review','succeeded','failed','cancelled')),
 run_id uuid references workflow_runs(id) on delete set null, error text, lease_token uuid, lease_until timestamptz, available_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), foreign key(organization_id,store_id) references knowledge_stores(organization_id,id)
);
create index knowledge_jobs_pending on knowledge_jobs(available_at) where status in ('queued','running');
create table public.knowledge_audit (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, store_id uuid not null, actor_id uuid not null references auth.users(id),
 action text not null, detail jsonb not null, created_at timestamptz not null default now(), foreign key(organization_id,store_id) references knowledge_stores(organization_id,id)
);
do $$ declare t text; begin foreach t in array array['knowledge_stores','knowledge_records','knowledge_versions','knowledge_edges','knowledge_chunks','knowledge_jobs','knowledge_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop; end $$;

create function public.knowledge_mutate(p_org uuid,p_actor uuid,p_action text,p_store uuid,p_id uuid default null,p_expected integer default null,p_data jsonb default '{}',p_secret text default null,p_run uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s knowledge_stores; r knowledge_records; v_admin boolean; v_link jsonb; v_target uuid; v_revision integer; v_text text; v_job uuid; v_count integer; v_chunks jsonb; v_jobrow knowledge_jobs;
begin
 if not exists(select 1 from organizations where id=p_org and is_active) or not exists(select 1 from organization_members where organization_id=p_org and user_id=p_actor and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
 select exists(select 1 from user_roles where organization_id=p_org and user_id=p_actor and role in ('admin','super_admin')) into v_admin;
 if p_action='create_store' then
  if not v_admin then raise exception 'Administrator required' using errcode='42501'; end if;
  insert into knowledge_stores(organization_id,name,kind,provider,endpoint,active,settings,secret_ciphertext,created_by) values(p_org,p_data->>'name',p_data->>'kind',p_data->>'provider',p_data->>'endpoint',(p_data->>'active')::boolean,p_data->'settings',p_secret,p_actor) returning * into s;
 else
  select * into s from knowledge_stores where organization_id=p_org and id=p_store and deleted_at is null for update;
  if not found then raise exception 'Knowledge store not found' using errcode='P0002'; end if;
  if p_action in ('save_store','delete_store') then
   if not v_admin then raise exception 'Administrator required' using errcode='42501'; end if;
   if p_expected is distinct from s.revision then raise exception 'Store changed; reload' using errcode='40001'; end if;
   update knowledge_stores set name=coalesce(p_data->>'name',name),kind=coalesce(p_data->>'kind',kind),provider=coalesce(p_data->>'provider',provider),endpoint=coalesce(p_data->>'endpoint',endpoint),settings=coalesce(p_data->'settings',settings),active=case when p_action='delete_store' then false else (p_data->>'active')::boolean end,secret_ciphertext=case when p_data->>'provider'='managed' or p_data->>'clearSecret'='true' then null else coalesce(p_secret,secret_ciphertext) end,deleted_at=case when p_action='delete_store' then now() else null end,revision=revision+1,updated_at=now() where id=s.id returning * into s;
  else
   if not s.active then raise exception 'Knowledge store is inactive' using errcode='42501'; end if;
   if not v_admin and not coalesce((s.settings->>'memberWrites')::boolean,false) then raise exception 'Store editing is restricted to administrators' using errcode='42501'; end if;
   if p_action='queue' then
    if not coalesce(s.settings->'workflowIds','[]') ? (p_data->>'workflowId') then raise exception 'Workflow is not assigned' using errcode='42501'; end if;
    insert into knowledge_jobs(organization_id,store_id,actor_id,workflow_id,input) values(p_org,s.id,p_actor,p_data->>'workflowId',coalesce(p_data->'input','{}')) returning id into v_job;
    insert into knowledge_audit(organization_id,store_id,actor_id,action,detail) values(p_org,s.id,p_actor,p_action,jsonb_build_object('jobId',v_job));
    return jsonb_build_object('jobId',v_job);
   elsif p_action='apply_job' then
    select * into v_jobrow from knowledge_jobs where id=p_id and organization_id=p_org and store_id=s.id for update;
    if not found then raise exception 'Job not found'; end if;
    if v_jobrow.status='succeeded' then return jsonb_build_object('jobId',v_jobrow.id,'alreadyApplied',true); end if;
    if v_jobrow.status<>'review' or v_jobrow.run_id is null then raise exception 'Job is not ready for review'; end if;
    if not exists(select 1 from workflow_runs where id=v_jobrow.run_id and organization_id=p_org and status='succeeded') then raise exception 'Workflow has not succeeded'; end if;
    v_count:=0;
    for v_link in select value from jsonb_array_elements(p_data->'records') loop
     perform knowledge_mutate(p_org,p_actor,'save_record',s.id,null,null,v_link,null,v_jobrow.run_id); v_count:=v_count+1;
    end loop;
    update knowledge_jobs set status='succeeded',updated_at=now() where id=v_jobrow.id;
    return jsonb_build_object('jobId',v_jobrow.id,'applied',v_count);
   elsif p_action in ('save_record','delete_record') then
    if p_run is not null and not exists(select 1 from workflow_runs where id=p_run and organization_id=p_org and status='succeeded') then raise exception 'Invalid provenance workflow'; end if;
    if p_id is not null then
     select * into r from knowledge_records where id=p_id and organization_id=p_org and store_id=s.id and deleted_at is null for update;
     if not found then raise exception 'Record not found' using errcode='P0002'; end if;
     if r.revision is distinct from p_expected then raise exception 'Record changed; reload' using errcode='40001'; end if;
     if p_action='save_record' and r.kind<>p_data->>'kind' then raise exception 'Record kind cannot change'; end if;
     update knowledge_records set name=coalesce(p_data->>'name',name),body=coalesce(p_data->'body',body),revision=revision+1,deleted_at=case when p_action='delete_record' then now() else null end,updated_by=p_actor,updated_at=now() where id=r.id returning * into r;
    else
     if p_action='delete_record' then raise exception 'Record ID required'; end if;
     insert into knowledge_records(organization_id,store_id,kind,name,body,updated_by) values(p_org,s.id,p_data->>'kind',p_data->>'name',p_data->'body',p_actor) returning * into r;
    end if;
    if p_action='save_record' then
     delete from knowledge_edges where source_id=r.id;
     if r.kind='skill' then
      for v_link in select value from jsonb_array_elements(r.body->'evidence') loop
       v_target:=(v_link->>'documentId')::uuid; v_revision:=(v_link->>'version')::integer;
       select v.body->>'text' into v_text from knowledge_versions v join knowledge_records d on d.id=v.record_id where v.record_id=v_target and v.revision=v_revision and v.organization_id=p_org and v.store_id=s.id and d.kind='document' and not v.deleted;
       if v_text is null or length(coalesce(v_link->>'quote',''))=0 or position(v_link->>'quote' in v_text)=0 then raise exception 'Evidence must quote an existing source revision in this store'; end if;
       insert into knowledge_edges values(p_org,s.id,r.id,v_target,'evidenced_by',v_revision,v_link) on conflict(source_id,target_id,relation,target_revision) do update set detail=excluded.detail,target_revision=excluded.target_revision;
      end loop;
     elsif r.kind in ('mapping','job') then
      for v_link in select value from jsonb_array_elements(case when r.kind='mapping' then jsonb_build_array(r.body) else r.body->'requirements' end) loop
       v_target:=(v_link->>'skillId')::uuid;
       select revision into v_revision from knowledge_records where id=v_target and organization_id=p_org and store_id=s.id and kind='skill' and deleted_at is null;
       if not found then raise exception 'Skill reference is unavailable in this store'; end if;
       insert into knowledge_edges values(p_org,s.id,r.id,v_target,case when r.kind='mapping' then 'maps_skill' else 'requires_skill' end,v_revision,v_link) on conflict(source_id,target_id,relation,target_revision) do update set detail=excluded.detail,target_revision=excluded.target_revision;
      end loop;
     end if;
    end if;
    insert into knowledge_versions(organization_id,store_id,record_id,revision,name,body,deleted,actor_id,workflow_run_id,workflow_context) values(p_org,s.id,r.id,r.revision,r.name,r.body,p_action='delete_record',p_actor,p_run,coalesce((select jsonb_build_object('workflowId',to_jsonb(w)->>'workflow_id','workflowName',to_jsonb(w)->>'workflow_name') from workflow_runs w where id=p_run),'{}'));
    delete from knowledge_chunks where record_id=r.id;
    if r.kind='document' and p_action='save_record' then
     v_text:=r.body->>'text';
     insert into knowledge_chunks(organization_id,store_id,record_id,revision,ordinal,content) select p_org,s.id,r.id,r.revision,offset_no/1600,substring(v_text from offset_no+1 for 1800) from generate_series(0,greatest(0,length(v_text)-1),1600) offset_no;
     if coalesce(s.settings->>'changeWorkflowId','')<>'' and p_run is null then
      insert into knowledge_jobs(organization_id,store_id,actor_id,workflow_id,input) values(p_org,s.id,p_actor,s.settings->>'changeWorkflowId',jsonb_build_object('documentId',r.id,'documentRevision',r.revision,'document',r.body,'name',r.name));
     end if;
    end if;
    return to_jsonb(r);
   else raise exception 'Unknown knowledge operation'; end if;
  end if;
 end if;
 insert into knowledge_audit(organization_id,store_id,actor_id,action,detail) values(p_org,s.id,p_actor,p_action,(to_jsonb(s)-'secret_ciphertext')||jsonb_build_object('credentialChanged',p_secret is not null));
 return to_jsonb(s)-'secret_ciphertext';
end $$;
revoke all on function knowledge_mutate(uuid,uuid,text,uuid,uuid,integer,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function knowledge_mutate(uuid,uuid,text,uuid,uuid,integer,jsonb,text,uuid) to service_role;

create function knowledge_search(p_org uuid,p_store uuid,p_query text,p_limit integer default 8) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(row_to_json(matches)), '[]') from (
  select c.record_id as "documentId",r.name,c.revision,c.ordinal,c.content,ts_rank_cd(c.search,websearch_to_tsquery('simple',p_query)) as score
  from knowledge_chunks c join knowledge_records r on r.id=c.record_id join knowledge_stores s on s.id=c.store_id
  where c.organization_id=p_org and c.store_id=p_store and r.deleted_at is null and s.active and s.deleted_at is null and c.search @@ websearch_to_tsquery('simple',p_query)
  order by score desc,c.record_id,c.ordinal limit greatest(1,least(p_limit,20))
 ) matches;
$$;
revoke all on function knowledge_search(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function knowledge_search(uuid,uuid,text,integer) to service_role;
create function claim_knowledge_job() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j knowledge_jobs;
begin
 select * into j from knowledge_jobs where status in ('queued','running') and available_at<=now() and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update knowledge_jobs set lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function claim_knowledge_job() from public,anon,authenticated;
grant execute on function claim_knowledge_job() to service_role;

create function knowledge_create_skill_app(p_org uuid,p_actor uuid,p_store uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s knowledge_stores; a studio_items; p studio_items; v_slug text; v_kind text; v_name text; v_def jsonb; v_release uuid; pins jsonb:='[]'; pages jsonb:='[]';
begin
 if not exists(select 1 from organization_members m join user_roles r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and r.role in ('admin','super_admin')) then raise exception 'Administrator required' using errcode='42501'; end if;
 select * into s from knowledge_stores where organization_id=p_org and id=p_store and deleted_at is null for update;
 if not found or not s.active then raise exception 'Activate the store first'; end if;
 v_slug:='skills-'||replace(s.id::text,'-','');
 select * into a from studio_items where organization_id=p_org and kind='application' and slug=v_slug and deleted_at is null;
 if found then return jsonb_build_object('applicationId',a.id,'slug',a.slug,'existing',true); end if;
 v_def:=jsonb_build_object('schemaVersion',1,'title',s.name||' · Skills','description','Evidence-backed skill management','elements','[]'::jsonb);
 insert into studio_items(organization_id,kind,slug,draft,updated_by) values(p_org,'application',v_slug,v_def,p_actor) returning * into a;
 foreach v_kind in array array['document','skill','mapping','job'] loop
  v_name:=case v_kind when 'document' then 'Source documents' when 'skill' then 'Extracted skills' when 'mapping' then 'Framework mappings' else 'Job profiles' end;
  v_def:=jsonb_build_object('schemaVersion',1,'title',v_name,'description','','elements',jsonb_build_array(jsonb_build_object('id','knowledge','type','knowledge','label',v_name,'knowledgeId',s.id,'knowledgeView',v_kind)));
  insert into studio_items(organization_id,kind,parent_id,slug,draft,updated_by) values(p_org,'page',a.id,v_kind,v_def,p_actor) returning * into p;
  insert into studio_releases(organization_id,item_id,revision,definition,created_by) values(p_org,p.id,1,v_def,p_actor) returning id into v_release;
  update studio_items set published_release_id=v_release,active=true,revision=2 where id=p.id;
  pins:=pins||jsonb_build_array(jsonb_build_object('id',p.id,'releaseId',v_release));pages:=pages||to_jsonb(p.id);
 end loop;
 insert into studio_releases(organization_id,item_id,revision,definition,created_by) values(p_org,a.id,1,a.draft||jsonb_build_object('pageReleases',pins),p_actor) returning id into v_release;
 update studio_items set published_release_id=v_release,active=true,revision=2 where id=a.id;
 update knowledge_stores set settings=jsonb_set(settings,'{pageIds}',coalesce(settings->'pageIds','[]')||pages),revision=revision+1,updated_at=now() where id=s.id;
 insert into knowledge_audit(organization_id,store_id,actor_id,action,detail) values(p_org,s.id,p_actor,'create_skill_app',jsonb_build_object('applicationId',a.id));
 return jsonb_build_object('applicationId',a.id,'slug',a.slug);
end $$;
revoke all on function knowledge_create_skill_app(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function knowledge_create_skill_app(uuid,uuid,uuid) to service_role;
