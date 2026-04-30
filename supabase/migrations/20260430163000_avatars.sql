-- Photo uploads for ump profiles.
alter table users add column avatar_url text;

-- Public storage bucket for avatars.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do update set public = excluded.public;

-- Anyone can read avatars (they're shown on the public games view).
do $$ begin
  drop policy if exists "Public avatar read" on storage.objects;
  create policy "Public avatar read" on storage.objects
    for select using (bucket_id = 'avatars');
end $$;

-- Writes go through the service role from server actions, so no insert/update
-- policies are needed for anon/authenticated.
