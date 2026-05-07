-- Add venmo_handle to users for one-tap Venmo payouts.
-- Stored without leading '@' and lowercased; a check trims accidental whitespace.

alter table users
  add column venmo_handle text;

-- Soft format check: 5-30 chars, letters/digits/underscore/dash/dot.
-- Venmo's actual rules are tighter, but this catches obvious paste mistakes
-- without rejecting legacy handles.
alter table users
  add constraint users_venmo_handle_format
  check (
    venmo_handle is null
    or venmo_handle ~ '^[A-Za-z0-9_.-]{4,30}$'
  );
