-- Private proposal history; model output can never publish an application.
create table public.studio_authoring_proposals (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 kind text not null check(kind in ('prompt','migration')), prompt text not null default '', provider_name text,
 manifest jsonb not null, warnings jsonb not null default '[]', allow_code boolean not null default false,
 base_item_id uuid, base_revision integer, base_definition jsonb, source_hash text,
 status text not null default 'review' check(status in ('review','applied','discarded')),
 applied_manifest jsonb, result jsonb, created_by uuid not null references auth.users(id),
 applied_by uuid references auth.users(id), created_at timestamptz not null default now(), applied_at timestamptz,
 foreign key(organization_id,base_item_id) references studio_items(organization_id,id)
);
create index studio_authoring_org on studio_authoring_proposals(organization_id,created_at desc);
alter table studio_authoring_proposals enable row level security;
revoke all on studio_authoring_proposals from anon,authenticated;
grant all on studio_authoring_proposals to service_role;
create table public.studio_gateway_rollout (
 organization_id uuid primary key references organizations(id), application_id uuid,
 revision integer not null default 1, updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 foreign key(organization_id,application_id) references studio_items(organization_id,id)
);
create table public.studio_gateway_rollout_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id),
 application_id uuid, previous_application_id uuid, revision integer not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table studio_gateway_rollout enable row level security;
alter table studio_gateway_rollout_events enable row level security;
revoke all on studio_gateway_rollout,studio_gateway_rollout_events from anon,authenticated;
grant all on studio_gateway_rollout,studio_gateway_rollout_events to service_role;

create function public.studio_apply_proposal(p_org uuid,p_actor uuid,p_id uuid,p_manifest jsonb,p_discard boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare proposal studio_authoring_proposals; app studio_items; page studio_items; entry jsonb; element jsonb; pages jsonb:='[]';
begin
 if not exists(select 1 from organization_members m join user_roles r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and r.role in ('admin','super_admin')) then raise exception 'Organization administrator required' using errcode='42501'; end if;
 select * into proposal from studio_authoring_proposals where id=p_id and organization_id=p_org for update;
 if not found then raise exception 'Proposal not found'; end if;
 if proposal.status='applied' and not p_discard then return proposal.result; end if;
 if proposal.status<>'review' then raise exception 'Proposal is no longer in review'; end if;
 if p_discard then update studio_authoring_proposals set status='discarded',applied_by=p_actor,applied_at=now() where id=p_id; return jsonb_build_object('discarded',true); end if;
 if jsonb_array_length(p_manifest->'pages') not between 1 and 16 then raise exception 'Invalid page count'; end if;
 if proposal.base_item_id is not null then
  select * into page from studio_items where organization_id=p_org and id=proposal.base_item_id and kind='page' and deleted_at is null for update;
  if not found or page.revision<>proposal.base_revision then raise exception 'Target draft changed. Generate a new proposal.' using errcode='40001'; end if;
  if jsonb_array_length(p_manifest->'pages')<>1 or p_manifest->'pages'->0->>'slug'<>page.slug then raise exception 'Refinement must retain the target page slug'; end if;
  select * into app from studio_items where id=page.parent_id and organization_id=p_org and deleted_at is null for update;
  if not found then raise exception 'Parent application unavailable'; end if;
 else
  insert into studio_items(organization_id,kind,slug,draft,updated_by) values(p_org,'application',p_manifest->'application'->>'slug',p_manifest->'application'->'definition',p_actor) returning * into app;
 end if;
 for entry in select value from jsonb_array_elements(p_manifest->'pages') loop
  if proposal.base_item_id is null then
   insert into studio_items(organization_id,kind,parent_id,slug,draft,updated_by) values(p_org,'page',app.id,entry->>'slug',entry->'definition',p_actor) returning * into page;
  else
   update studio_items set draft=entry->'definition',revision=revision+1,updated_by=p_actor,updated_at=now() where id=page.id returning * into page;
  end if;
  pages:=pages||jsonb_build_array(page.id);
  for element in select value from jsonb_array_elements(entry->'definition'->'elements') where value->>'type'='knowledge' loop
   update knowledge_stores set settings=jsonb_set(settings,'{pageIds}',coalesce(settings->'pageIds','[]')||jsonb_build_array(page.id)),revision=revision+1,updated_at=now()
    where organization_id=p_org and id=(element->>'knowledgeId')::uuid and active and deleted_at is null and not coalesce(settings->'pageIds','[]') ? page.id::text;
   if not exists(select 1 from knowledge_stores where organization_id=p_org and id=(element->>'knowledgeId')::uuid and active and deleted_at is null) then raise exception 'Knowledge store unavailable'; end if;
  end loop;
 end loop;
 update studio_authoring_proposals set status='applied',applied_manifest=p_manifest,applied_by=p_actor,applied_at=now(),result=jsonb_build_object('applicationId',app.id,'pageIds',pages) where id=p_id returning * into proposal;
 return proposal.result;
end $$;
revoke all on function studio_apply_proposal(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function studio_apply_proposal(uuid,uuid,uuid,jsonb,boolean) to service_role;

create function public.studio_set_rollout(p_org uuid,p_actor uuid,p_application uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare current_row studio_gateway_rollout; previous uuid;
begin
 if not exists(select 1 from organization_members m join user_roles r on r.organization_id=m.organization_id and r.user_id=m.user_id where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and r.role in ('admin','super_admin')) then raise exception 'Organization administrator required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,7));
 select * into current_row from studio_gateway_rollout where organization_id=p_org for update;
 if coalesce(current_row.revision,0)<>p_expected then raise exception 'Rollout changed. Reload first.' using errcode='40001'; end if;
 previous:=current_row.application_id;
 if p_application is not null and not exists(select 1 from studio_items i join studio_releases r on r.id=i.published_release_id and r.item_id=i.id and r.organization_id=i.organization_id where i.id=p_application and i.organization_id=p_org and i.kind='application' and i.active and i.deleted_at is null and jsonb_array_length(coalesce(r.definition->'pageReleases','[]'))>0) then raise exception 'Select an active published application with published pages'; end if;
 insert into studio_gateway_rollout(organization_id,application_id,revision,updated_by) values(p_org,p_application,1,p_actor) on conflict(organization_id) do update set application_id=excluded.application_id,revision=studio_gateway_rollout.revision+1,updated_by=p_actor,updated_at=now() returning * into current_row;
 insert into studio_gateway_rollout_events(organization_id,application_id,previous_application_id,revision,actor_id) values(p_org,p_application,previous,current_row.revision,p_actor);
 return to_jsonb(current_row);
end $$;
revoke all on function studio_set_rollout(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function studio_set_rollout(uuid,uuid,uuid,integer) to service_role;
