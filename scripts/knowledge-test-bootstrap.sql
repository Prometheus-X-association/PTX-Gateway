-- Test-only schema in an empty disposable database, after studio-test-bootstrap.sql.
create table workflow_runs(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),status text,output jsonb);
