-- Audit trail for every user-affecting action.
-- Read by /audit page; written by server actions.

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid references users(id),
  subject_id uuid references users(id),
  game_id uuid references games(id) on delete set null,
  assignment_id uuid references assignments(id) on delete set null,
  swap_request_id uuid references swap_requests(id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_at_idx on audit_log(created_at desc);
create index if not exists audit_log_subject_idx on audit_log(subject_id);
create index if not exists audit_log_actor_idx on audit_log(actor_id);
create index if not exists audit_log_game_idx on audit_log(game_id);

alter table audit_log enable row level security;
