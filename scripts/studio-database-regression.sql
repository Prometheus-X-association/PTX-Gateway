\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into organizations(id,slug,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','studio-test-a','Test A'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','studio-test-b','Test B');
insert into organization_members values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','active'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','active');
insert into user_roles values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','admin');
do $$
declare
  v_org uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_app jsonb; v_page jsonb; v_saved jsonb; v_release uuid; v_denied boolean;
begin
  if has_table_privilege('authenticated','public.studio_items','SELECT') or has_table_privilege('anon','public.studio_releases','SELECT') then raise exception 'Studio tables are exposed'; end if;
  if has_function_privilege('authenticated','public.studio_mutate(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb,text,uuid,boolean)','EXECUTE') then raise exception 'Studio mutation RPC is exposed'; end if;
  v_denied := false;
  begin
    perform studio_mutate(v_org,'22222222-2222-4222-8222-222222222222','create',null,null,'application',null,'forbidden','{"title":"Forbidden"}');
  exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'Member created a draft'; end if;
  v_app := studio_mutate(v_org,v_actor,'create',null,null,'application',null,'skills','{"schemaVersion":1,"title":"Skills"}');
  v_denied := false;
  begin
    perform studio_mutate(v_org,v_actor,'activate',(v_app->>'id')::uuid,1,p_active:=true);
  exception when raise_exception then v_denied:=true; end;
  if not v_denied then raise exception 'Unpublished app activated'; end if;
  v_page := studio_mutate(v_org,v_actor,'create',null,null,'page',(v_app->>'id')::uuid,'extract','{"schemaVersion":1,"title":"Extract"}');
  v_saved := studio_mutate(v_org,v_actor,'save',(v_page->>'id')::uuid,1,p_definition:='{"schemaVersion":1,"title":"First version"}');
  v_denied:=false;
  begin
    perform studio_mutate(v_org,v_actor,'save',(v_page->>'id')::uuid,1,p_definition:='{"title":"Stale overwrite"}');
  exception when serialization_failure then v_denied:=true; end;
  if not v_denied then raise exception 'Stale draft overwrite succeeded'; end if;
  v_saved := studio_mutate(v_org,v_actor,'publish',(v_page->>'id')::uuid,2,p_definition:='{"schemaVersion":1,"title":"First version"}',p_runtime:='encrypted-snapshot');
  v_release := (v_saved->>'published_release_id')::uuid;
  if not (v_saved->>'active')::boolean then raise exception 'Publish did not activate atomically'; end if;
  v_saved := studio_mutate(v_org,v_actor,'save',(v_page->>'id')::uuid,3,p_definition:='{"schemaVersion":1,"title":"Second draft"}');
  if (select definition->>'title' from studio_releases where id=v_release) <> 'First version' then raise exception 'Draft edit changed published release'; end if;
  v_saved := studio_mutate(v_org,v_actor,'publish',(v_page->>'id')::uuid,4,p_definition:='{"schemaVersion":1,"title":"Second draft"}');
  v_saved := studio_mutate(v_org,v_actor,'rollback',(v_page->>'id')::uuid,5,p_release:=v_release);
  if v_saved->>'published_release_id' <> v_release::text or v_saved->'draft'->>'title' <> 'Second draft' then raise exception 'Rollback did not preserve draft'; end if;
  v_denied:=false;
  begin
    perform studio_mutate(v_org,v_actor,'rollback',(v_app->>'id')::uuid,1,p_release:=v_release);
  exception when no_data_found then v_denied:=true; end;
  if not v_denied then raise exception 'Cross-item rollback succeeded'; end if;
  v_denied:=false;
  begin
    perform studio_mutate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',v_actor,'save',(v_app->>'id')::uuid,1,p_definition:='{}');
  exception when insufficient_privilege then v_denied:=true; end;
  if not v_denied then raise exception 'Cross-organization mutation succeeded'; end if;
  v_saved := studio_mutate(v_org,v_actor,'delete',(v_page->>'id')::uuid,6);
  if v_saved->>'deleted_at' is null or (v_saved->>'active')::boolean then raise exception 'Archived page remains active'; end if;
  if (select count(*) from studio_releases where item_id=(v_page->>'id')::uuid) <> 2 then raise exception 'Archiving lost release history'; end if;
end $$;
rollback;
