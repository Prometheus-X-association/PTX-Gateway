\set ON_ERROR_STOP on
begin;
insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into organizations(id,slug,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','authoring','Authoring');
insert into organization_members values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','active'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','active');
insert into user_roles values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','admin');
do $$
declare org uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; actor uuid:='11111111-1111-4111-8111-111111111111'; proposal uuid; refine uuid; app uuid; page uuid; store uuid; output jsonb; manifest jsonb; denied boolean; snapshot jsonb; before_count integer;
begin
 if has_table_privilege('authenticated','studio_authoring_proposals','SELECT') or has_table_privilege('anon','studio_gateway_rollout','SELECT') or has_function_privilege('authenticated','studio_apply_proposal(uuid,uuid,uuid,jsonb,boolean)','EXECUTE') then raise exception 'Private authoring state exposed'; end if;
 insert into knowledge_stores(organization_id,name,kind,provider,active,settings,created_by) values(org,'Skills','knowledge_graph','managed',true,'{}',actor) returning id into store;
 manifest:=jsonb_build_object('application',jsonb_build_object('slug','generated','definition','{"schemaVersion":1,"title":"Generated","elements":[]}'::jsonb),'pages',jsonb_build_array(jsonb_build_object('slug','skills','definition',jsonb_build_object('schemaVersion',1,'title','Skills','elements',jsonb_build_array(jsonb_build_object('id','skills','type','knowledge','knowledgeId',store))))));
 insert into studio_authoring_proposals(organization_id,kind,manifest,created_by) values(org,'prompt',manifest,actor) returning id into proposal;
 denied:=false;begin perform studio_apply_proposal(org,'22222222-2222-4222-8222-222222222222',proposal,manifest);exception when insufficient_privilege then denied:=true;end;if not denied then raise exception 'Member applied proposal';end if;
 output:=studio_apply_proposal(org,actor,proposal,manifest);app:=(output->>'applicationId')::uuid;page:=(output->'pageIds'->>0)::uuid;
 if exists(select 1 from studio_items where active or published_release_id is not null) then raise exception 'Proposal published itself';end if;
 if not exists(select 1 from knowledge_stores where id=store and settings->'pageIds' ? page::text) then raise exception 'Missing page/store binding';end if;
 if studio_apply_proposal(org,actor,proposal,manifest)<>output or (select count(*) from studio_items)<>2 then raise exception 'Apply is not idempotent';end if;
 denied:=false;begin perform studio_set_rollout(org,actor,app,0);exception when raise_exception then denied:=true;end;if not denied then raise exception 'Unpublished rollout accepted';end if;
 -- Duplicate URL rolls back every draft and leaves the proposal reviewable.
 insert into studio_authoring_proposals(organization_id,kind,manifest,created_by) values(org,'migration',manifest,actor) returning id into proposal;
 denied:=false;begin perform studio_apply_proposal(org,actor,proposal,manifest);exception when unique_violation then denied:=true;end;
 if not denied or (select status from studio_authoring_proposals where id=proposal)<>'review' or (select count(*) from studio_items)<>2 then raise exception 'Nonatomic duplicate application';end if;
 -- A late page conflict must also roll back the already inserted application.
 manifest:=jsonb_set(manifest,'{application,slug}','"duplicate-pages"');manifest:=jsonb_set(manifest,'{pages}',(manifest->'pages')||(manifest->'pages'));
 denied:=false;begin perform studio_apply_proposal(org,actor,proposal,manifest);exception when unique_violation then denied:=true;end;
 if not denied or exists(select 1 from studio_items where slug='duplicate-pages') then raise exception 'Partial application survived failure';end if;
 perform studio_apply_proposal(org,actor,proposal,null,true);
 if (select status from studio_authoring_proposals where id=proposal)<>'discarded' then raise exception 'Discard failed';end if;
 manifest:=jsonb_set(manifest,'{pages}',jsonb_build_array(manifest->'pages'->0));
 insert into studio_authoring_proposals(organization_id,kind,manifest,base_item_id,base_revision,created_by) values(org,'prompt',manifest,page,1,actor) returning id into refine;
 perform studio_mutate(org,actor,'publish',page,1,p_definition:='{"schemaVersion":1,"title":"Live skills","elements":[]}');
 snapshot:=(select to_jsonb(i) from studio_items i where id=page);
 denied:=false;begin perform studio_apply_proposal(org,actor,refine,manifest);exception when serialization_failure then denied:=true;end;if not denied then raise exception 'Stale target overwritten';end if;
 update studio_authoring_proposals set base_revision=2 where id=refine;
 perform studio_apply_proposal(org,actor,refine,manifest);
 if (select published_release_id::text from studio_items where id=page)<>snapshot->>'published_release_id' then raise exception 'Refinement changed live release';end if;
 perform studio_mutate(org,actor,'publish',app,1,p_definition:=jsonb_build_object('schemaVersion',1,'title','Generated','pageReleases',jsonb_build_array(jsonb_build_object('id',page,'releaseId',snapshot->>'published_release_id'))));
 output:=studio_set_rollout(org,actor,app,0);if output->>'application_id'<>app::text then raise exception 'Rollout failed';end if;
 denied:=false;begin perform studio_set_rollout(org,actor,null,0);exception when serialization_failure then denied:=true;end;if not denied then raise exception 'Stale rollout accepted';end if;
 perform studio_set_rollout(org,actor,null,1);
 if (select application_id from studio_gateway_rollout where organization_id=org) is not null or (select count(*) from studio_gateway_rollout_events)<>2 then raise exception 'Rollback audit missing';end if;
 raise notice 'Authoring SQL checks passed: role isolation, draft-only apply, idempotence, atomic rollback, knowledge binding, optimistic refinement and reversible rollout';
end $$;
rollback;
