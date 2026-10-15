-- Isolated PostgreSQL fixture only; this creates mock Supabase roles and users.
\set ON_ERROR_STOP on
begin;
create role authenticated;
create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to authenticated,anon;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
\ir ../cloud/supabase.sql
insert into public.wordpop_baseline(user_id,state) values ('00000000-0000-0000-0000-000000000001','{"preserved":true}');
\ir ../cloud/supabase.sql
do $$ begin
 if (select count(*) from public.wordpop_baseline where state->>'preserved'='true')<>1 then raise exception 'migration lost baseline'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.wordpop_settings_changes(id,user_id,setting_key,value) values
 ('10000000-0000-0000-0000-000000000001',auth.uid(),'selectedWordlists','["cet6"]'),
 ('10000000-0000-0000-0000-000000000001',auth.uid(),'learningPlan','{"dailyNewWordsMode":"fixed","dailyNewWords":20,"targetDate":null}');
insert into public.wordpop_settings_changes(id,user_id,setting_key,value) values
 ('10000000-0000-0000-0000-000000000002',auth.uid(),'learningPlan','{"dailyNewWordsMode":"target","dailyNewWords":98,"targetDate":"2027-06-01"}');
-- Retrying an old successful write must not move it ahead of a later edit.
insert into public.wordpop_settings_changes(id,user_id,setting_key,value) values
 ('10000000-0000-0000-0000-000000000001',auth.uid(),'learningPlan','{"dailyNewWordsMode":"fixed","dailyNewWords":20,"targetDate":null}')
 on conflict(id,setting_key) do nothing;
do $$ begin
 if (select count(*) from public.wordpop_current_settings)<>2 then raise exception 'view not grouped'; end if;
 if (select value->>'dailyNewWordsMode' from public.wordpop_current_settings where setting_key='learningPlan')<>'target' then raise exception 'retry reordered settings'; end if;
 if (select value from public.wordpop_current_settings where setting_key='selectedWordlists')<>'["cet6"]'::jsonb then raise exception 'plan changed deck'; end if;
 begin
  insert into public.wordpop_settings_changes(id,user_id,setting_key,value) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000002','autoBalanceLoad','false');
  raise exception 'cross-user insert accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.wordpop_settings_changes(id,user_id,setting_key,value,created_at) values(gen_random_uuid(),auth.uid(),'autoBalanceLoad','false','2999-01-01');
  raise exception 'client server-time override accepted';
 exception when insufficient_privilege then null; end;
 begin
  update public.wordpop_settings_changes set value='false' where setting_key='autoBalanceLoad';
  raise exception 'history update accepted';
 exception when insufficient_privilege then null; end;
end $$;
do $$ declare item jsonb; begin
 foreach item in array array['null'::jsonb,'{"dailyNewWordsMode":"target","dailyNewWords":20,"targetDate":null}'::jsonb,'{"dailyNewWordsMode":"fixed","dailyNewWords":20}'::jsonb] loop
  begin
   insert into public.wordpop_settings_changes(id,user_id,setting_key,value) values(gen_random_uuid(),auth.uid(),'learningPlan',item);
   raise exception 'invalid plan accepted: %',item;
  exception when check_violation then null; end;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$ begin
 if (select count(*) from public.wordpop_current_settings)<>0 then raise exception 'view leaked another account'; end if;
end $$;
insert into public.wordpop_settings_changes(id,user_id,setting_key,value) values(gen_random_uuid(),auth.uid(),'selectedWordlists','["cet4"]');
do $$ begin
 if (select count(*) from public.wordpop_current_settings)<>1 then raise exception 'own settings not visible'; end if;
end $$;
reset role;
set role anon;
do $$ begin
 begin
  perform * from public.wordpop_current_settings;
  raise exception 'anonymous settings read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'Settings schema: idempotent migration, preserved baseline, RLS, grouped latest values and retry ordering passed.'
