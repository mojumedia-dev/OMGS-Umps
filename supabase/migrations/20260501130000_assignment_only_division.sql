-- 8U flow: board directly assigns umps; umps cannot self-request.

-- Add 'assigned' status to assignment_status enum (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'assigned'
      and enumtypid = 'assignment_status'::regtype
  ) then
    execute 'alter type assignment_status add value ''assigned'' before ''approved''';
  end if;
end $$;

-- Mark divisions as assignment-only (no umpire requests allowed).
alter table divisions add column if not exists assignment_only boolean not null default false;
update divisions set assignment_only = true where code = '8U';
