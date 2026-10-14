-- Run in Supabase SQL Editor. Enable Email authentication in Authentication.
-- Initialise once from the existing Windows app, then sign in on Android.
create table if not exists public.wordpop_baseline (
 user_id uuid primary key references auth.users(id) on delete cascade,
 state jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists public.wordpop_events (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 word text not null check(length(word) between 1 and 200),
 action text not null check(action in ('unknown','fuzzy','known','easy','undo')),
 target_id uuid,
 reviewed_at bigint not null check(reviewed_at>0),
 created_at timestamptz not null default now()
);
alter table public.wordpop_events add column if not exists target_id uuid;
alter table public.wordpop_events drop constraint if exists wordpop_events_action_check;
alter table public.wordpop_events add constraint wordpop_events_action_check check(action in ('unknown','fuzzy','known','easy','undo'));
create index if not exists wordpop_events_user_time on public.wordpop_events(user_id,reviewed_at,id);
alter table public.wordpop_baseline enable row level security;
alter table public.wordpop_events enable row level security;
drop policy if exists "Read own baseline" on public.wordpop_baseline;
create policy "Read own baseline" on public.wordpop_baseline for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Create own baseline" on public.wordpop_baseline;
create policy "Create own baseline" on public.wordpop_baseline for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Read own events" on public.wordpop_events;
create policy "Read own events" on public.wordpop_events for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Create own events" on public.wordpop_events;
create policy "Create own events" on public.wordpop_events for insert to authenticated with check ((select auth.uid())=user_id);
grant select, insert on public.wordpop_baseline, public.wordpop_events to authenticated;
revoke all on public.wordpop_baseline, public.wordpop_events from anon;
