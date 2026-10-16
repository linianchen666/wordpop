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

-- Independent append-only learning preferences. Retry the same ID safely;
-- the newest server-received edit wins within each group, not across groups.
create table if not exists public.wordpop_settings_changes (
 id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 setting_key text not null check (setting_key in ('selectedWordlists','learningPlan','autoBalanceLoad')),
 value jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key (id,setting_key),
 constraint wordpop_settings_value_check check ((
   (setting_key='selectedWordlists' and jsonb_typeof(value)='array' and jsonb_array_length(value)>0 and value <@ '["cet4","cet6","kaoyan"]'::jsonb)
   or (setting_key='autoBalanceLoad' and jsonb_typeof(value)='boolean')
   or (setting_key='learningPlan' and jsonb_typeof(value)='object'
     and value ?& array['dailyNewWordsMode','dailyNewWords','targetDate']
     and value->>'dailyNewWordsMode' in ('fixed','target')
     and jsonb_typeof(value->'dailyNewWords')='number'
     and (value->>'dailyNewWords')::numeric between 1 and 200
     and trunc((value->>'dailyNewWords')::numeric)=(value->>'dailyNewWords')::numeric
     and (value->'targetDate'='null'::jsonb or value->>'targetDate' ~ '^\d{4}-\d{2}-\d{2}$')
     and (value->>'dailyNewWordsMode'='fixed' or value->'targetDate'<>'null'::jsonb))
 ) is true)
);
create index if not exists wordpop_settings_latest on public.wordpop_settings_changes(user_id,setting_key,created_at desc,id desc);
alter table public.wordpop_settings_changes enable row level security;
drop policy if exists "Read own settings" on public.wordpop_settings_changes;
create policy "Read own settings" on public.wordpop_settings_changes for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Create own settings" on public.wordpop_settings_changes;
create policy "Create own settings" on public.wordpop_settings_changes for insert to authenticated with check ((select auth.uid())=user_id);
create or replace view public.wordpop_current_settings with (security_invoker=true) as
 select distinct on (user_id,setting_key) user_id,setting_key,value,id
 from public.wordpop_settings_changes
 order by user_id,setting_key,created_at desc,id desc;
revoke all on public.wordpop_settings_changes,public.wordpop_current_settings from anon,authenticated;
grant select on public.wordpop_settings_changes to authenticated;
grant insert (id,user_id,setting_key,value) on public.wordpop_settings_changes to authenticated;
grant select on public.wordpop_current_settings to authenticated;
notify pgrst, 'reload schema';

-- Queue dates are separate from ratings/FSRS. One operation may cover many words.
-- The memory key makes a stale/offline plan harmless after a newer rating.
create table if not exists public.wordpop_review_schedules (
 id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 word text not null check(length(word) between 1 and 200),
 base_key text not null check(length(base_key) between 1 and 2048),
 original_due_at bigint not null check(original_due_at between 0 and 8640000000000000),
 due_at bigint not null check(due_at between 1 and 8640000000000000),
 created_at timestamptz not null default clock_timestamp(),
 primary key (id,word)
);
create index if not exists wordpop_review_schedules_latest
 on public.wordpop_review_schedules(user_id,word,created_at desc,id desc);
alter table public.wordpop_review_schedules enable row level security;
drop policy if exists "Read own review schedules" on public.wordpop_review_schedules;
create policy "Read own review schedules" on public.wordpop_review_schedules
 for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Create own review schedules" on public.wordpop_review_schedules;
create policy "Create own review schedules" on public.wordpop_review_schedules
 for insert to authenticated with check ((select auth.uid())=user_id);
create or replace view public.wordpop_current_review_schedules with (security_invoker=true) as
 select distinct on (user_id,word) user_id,word,id,base_key,original_due_at,due_at
 from public.wordpop_review_schedules
 order by user_id,word,created_at desc,id desc;
revoke all on public.wordpop_review_schedules,public.wordpop_current_review_schedules from anon,authenticated;
grant select on public.wordpop_review_schedules to authenticated;
grant insert(id,user_id,word,base_key,original_due_at,due_at) on public.wordpop_review_schedules to authenticated;
grant select on public.wordpop_current_review_schedules to authenticated;
notify pgrst, 'reload schema';
