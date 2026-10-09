-- Studio data is accessed only through studio-api. User/anonymous clients cannot read drafts or execution snapshots.
create table public.studio_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('application','page','canvas','chat')),
  parent_id uuid,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  revision integer not null default 1,
  active boolean not null default false,
  published_release_id uuid,
  deleted_at timestamptz,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, parent_id) references public.studio_items(organization_id, id),
  check ((kind = 'page') = (parent_id is not null))
);
create unique index studio_root_slug on public.studio_items(organization_id, kind, slug) where parent_id is null and deleted_at is null;
create unique index studio_page_slug on public.studio_items(organization_id, parent_id, slug) where parent_id is not null and deleted_at is null;
create index studio_items_org on public.studio_items(organization_id);
create table public.studio_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  item_id uuid not null,
  revision integer not null,
  definition jsonb not null,
  runtime_ciphertext text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, item_id) references public.studio_items(organization_id, id) on delete cascade,
  unique (organization_id, item_id, id)
);
alter table public.studio_items add constraint studio_published_release_fk foreign key (organization_id, id, published_release_id) references public.studio_releases(organization_id, item_id, id);
alter table public.studio_items enable row level security;
alter table public.studio_releases enable row level security;
revoke all on public.studio_items, public.studio_releases from anon, authenticated;
grant all on public.studio_items, public.studio_releases to service_role;

-- Every operation locks the item and checks its draft revision. Release insertion and activation are atomic.
create or replace function public.studio_mutate(
  p_org uuid, p_actor uuid, p_action text, p_id uuid, p_expected integer,
  p_kind text default null, p_parent uuid default null, p_slug text default null,
  p_definition jsonb default null, p_runtime text default null, p_release uuid default null,
  p_active boolean default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item public.studio_items; v_release uuid;
begin
  if not exists (select 1 from public.organization_members m join public.user_roles r on r.organization_id=m.organization_id and r.user_id=m.user_id
    where m.organization_id=p_org and m.user_id=p_actor and m.status='active' and r.role in ('admin','super_admin')) then
    raise exception 'Organization administrator required' using errcode='42501';
  end if;
  if p_action='create' then
    if p_kind='page' and not exists(select 1 from public.studio_items where id=p_parent and organization_id=p_org and kind='application' and deleted_at is null) then
      raise exception 'Application parent not found' using errcode='23503';
    end if;
    insert into public.studio_items(organization_id,kind,parent_id,slug,draft,updated_by)
      values(p_org,p_kind,p_parent,p_slug,p_definition,p_actor) returning * into v_item;
    return to_jsonb(v_item);
  end if;
  select * into v_item from public.studio_items where id=p_id and organization_id=p_org and deleted_at is null for update;
  if not found then raise exception 'Studio item not found' using errcode='P0002'; end if;
  if p_expected is distinct from v_item.revision then raise exception 'Draft changed. Reload before saving.' using errcode='40001'; end if;
  if p_action='save' then
    -- Slugs remain stable after creation, so published URLs do not change during draft edits.
    update public.studio_items set draft=p_definition where id=p_id;
  elsif p_action='publish' then
    insert into public.studio_releases(organization_id,item_id,revision,definition,runtime_ciphertext,created_by)
      values(p_org,p_id,v_item.revision,coalesce(p_definition,v_item.draft),p_runtime,p_actor) returning id into v_release;
    update public.studio_items set published_release_id=v_release, active=true where id=p_id;
  elsif p_action='rollback' then
    if not exists(select 1 from public.studio_releases where id=p_release and item_id=p_id and organization_id=p_org) then
      raise exception 'Release not found' using errcode='P0002';
    end if;
    update public.studio_items set published_release_id=p_release where id=p_id;
  elsif p_action='activate' then
    if p_active and v_item.published_release_id is null then raise exception 'Publish before activating'; end if;
    update public.studio_items set active=coalesce(p_active,false) where id=p_id;
  elsif p_action='delete' then
    update public.studio_items set deleted_at=now(), active=false where id=p_id;
  else raise exception 'Unsupported Studio mutation';
  end if;
  update public.studio_items set revision=revision+1, updated_by=p_actor, updated_at=now() where id=p_id returning * into v_item;
  return to_jsonb(v_item);
end $$;
revoke all on function public.studio_mutate(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.studio_mutate(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb,text,uuid,boolean) to service_role;
