-- Test-only fixture for an EMPTY PostgreSQL database. Never run against an application database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key, slug text unique, name text, is_active boolean default true);
create table public.organization_members(organization_id uuid references organizations(id), user_id uuid references auth.users(id), status text);
create table public.user_roles(organization_id uuid references organizations(id), user_id uuid references auth.users(id), role text);
