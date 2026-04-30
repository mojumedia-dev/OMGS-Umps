-- Each umpire selects the divisions they're qualified to officiate.
-- Default: all divisions, so existing users keep their current behavior.
alter table users
  add column eligible_divisions text[]
    not null
    default '{8U,10U,12U,14U,16U,18U}';

-- Index for quick "which umps can do 8U?" lookups
create index users_eligible_divisions_gin on users using gin (eligible_divisions);
