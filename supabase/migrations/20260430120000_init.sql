-- OMGS Umpire Scheduling — initial schema
-- Run via Supabase SQL editor or `supabase db push`

create extension if not exists pgcrypto;

-- =========================
-- Roles
-- =========================
create type user_role as enum ('umpire', 'uic', 'board', 'admin');

-- =========================
-- Users
-- Mirrors Clerk users; clerk_user_id is the source of truth.
-- =========================
create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  role user_role not null default 'umpire',
  full_name text not null,
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_role_idx on users(role) where is_active;
create unique index users_phone_unique on users(phone) where phone is not null;

-- =========================
-- Divisions (lookup, lets us tweak pay rates without code changes)
-- =========================
create table divisions (
  code text primary key,           -- '8U','10U','12U','14U','16U','18U'
  display_name text not null,
  default_ump_slots int not null,  -- 1 or 2
  default_pay_per_slot numeric(8,2) not null,
  tournament_pay_per_slot numeric(8,2) not null,
  tournament_ump_slots int not null default 2,
  display_order int not null default 0
);

insert into divisions (code, display_name, default_ump_slots, default_pay_per_slot, tournament_pay_per_slot, tournament_ump_slots, display_order) values
  ('8U',  '8U',  2, 20, 20, 2, 1),
  ('10U', '10U', 1, 50, 50, 2, 2),
  ('12U', '12U', 1, 50, 50, 2, 3),
  ('14U', '14U', 1, 50, 50, 2, 4),
  ('16U', '16U', 1, 50, 50, 2, 5),
  ('18U', '18U', 1, 50, 50, 2, 6);

-- =========================
-- Games
-- =========================
create type game_status as enum ('open', 'partial', 'filled', 'cancelled', 'completed');

create table games (
  id uuid primary key default gen_random_uuid(),
  division_code text not null references divisions(code),
  team_home text not null,
  team_away text not null,
  field text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ump_slots int not null,           -- copied from division at creation, can be overridden
  pay_per_slot numeric(8,2) not null,
  is_tournament boolean not null default false,
  status game_status not null default 'open',
  notes text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index games_starts_at_idx on games(starts_at);
create index games_status_idx on games(status);
create index games_division_idx on games(division_code);

-- =========================
-- Assignments — umpire requests + approved bookings
-- =========================
create type assignment_status as enum (
  'requested',  -- ump asked for the slot, awaiting UIC
  'approved',   -- UIC approved, ump should confirm
  'declined',   -- UIC declined the request
  'confirmed',  -- ump replied yes via SMS / web
  'cancelled',  -- approved/confirmed but later cancelled
  'completed',  -- game played
  'paid'        -- cash settled
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  umpire_id uuid not null references users(id) on delete restrict,
  status assignment_status not null default 'requested',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references users(id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  paid_at timestamptz,
  paid_amount numeric(8,2),
  paid_by uuid references users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ump can only have one active assignment per game (no duplicate requests)
create unique index assignments_game_ump_active_idx
  on assignments(game_id, umpire_id)
  where status not in ('declined', 'cancelled');

create index assignments_umpire_idx on assignments(umpire_id);
create index assignments_status_idx on assignments(status);

-- =========================
-- Swap requests
-- =========================
create type swap_status as enum ('pending', 'accepted', 'rejected', 'approved', 'cancelled');

create table swap_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  target_umpire_id uuid references users(id),  -- null = open swap (any ump)
  status swap_status not null default 'pending',
  message text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references users(id)
);

create index swap_assignment_idx on swap_requests(assignment_id);
create index swap_target_idx on swap_requests(target_umpire_id);
create index swap_status_idx on swap_requests(status);

-- =========================
-- Import batches (Excel uploads)
-- =========================
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  uploaded_by uuid references users(id),
  games_created int not null default 0,
  games_skipped int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

alter table games
  add constraint games_import_batch_fk
  foreign key (import_batch_id) references import_batches(id) on delete set null;

-- =========================
-- SMS log (audit trail)
-- =========================
create table sms_log (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  body text not null,
  twilio_sid text,
  related_assignment_id uuid references assignments(id) on delete set null,
  related_user_id uuid references users(id) on delete set null,
  status text,            -- 'queued','sent','delivered','failed'
  error text,
  created_at timestamptz not null default now()
);

create index sms_log_assignment_idx on sms_log(related_assignment_id);
create index sms_log_user_idx on sms_log(related_user_id);

-- =========================
-- Updated-at trigger
-- =========================
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger users_updated_at before update on users for each row execute function set_updated_at();
create trigger games_updated_at before update on games for each row execute function set_updated_at();
create trigger assignments_updated_at before update on assignments for each row execute function set_updated_at();

-- =========================
-- RLS — enable, policies added in next migration once Clerk JWT integration is wired
-- =========================
alter table users enable row level security;
alter table games enable row level security;
alter table assignments enable row level security;
alter table swap_requests enable row level security;
alter table import_batches enable row level security;
alter table sms_log enable row level security;

-- For now, service role bypasses RLS. Anon/authenticated have no policies = no access.
-- Real policies land in 20260430130000_rls_policies.sql once we know Clerk → Supabase JWT shape.
