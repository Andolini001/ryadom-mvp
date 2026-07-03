create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  alias text not null,
  hue text not null default '#457b74',
  age_zone text not null default '18-30',
  trust_score integer not null default 80 check (trust_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null check (char_length(state) between 1 and 64),
  thought text not null check (char_length(thought) between 1 and 600),
  intent text not null check (intent in ('vent', 'similar', 'support', 'distract')),
  topics text[] not null default '{}',
  safety_level text not null check (safety_level in ('clear', 'sensitive', 'blocked', 'crisis')),
  language text not null default 'ru',
  age_zone text not null default '18-30',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 minutes'
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  timer_minutes integer not null default 25 check (timer_minutes between 5 and 60),
  status text not null default 'open' check (status in ('open', 'closed', 'moderated')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_snapshot text not null,
  hue_snapshot text not null default '#457b74',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  author_snapshot text not null,
  body text not null check (char_length(body) between 1 and 1200),
  tone text not null default 'plain' check (tone in ('warm', 'plain', 'system')),
  created_at timestamptz not null default now()
);

create table if not exists public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  label text not null,
  source text not null,
  status text not null default 'new' check (status in ('new', 'watching', 'resolved')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mood_after text check (mood_after in ('lighter', 'same', 'worse')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  telegram_handle text not null,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

create index if not exists profiles_age_zone_idx on public.profiles(age_zone);
create index if not exists check_ins_live_idx on public.check_ins(safety_level, expires_at, created_at desc);
create index if not exists check_ins_user_created_idx on public.check_ins(user_id, created_at desc);
create index if not exists check_ins_topics_idx on public.check_ins using gin(topics);
create index if not exists rooms_created_by_idx on public.rooms(created_by, created_at desc);
create index if not exists room_members_user_idx on public.room_members(user_id, joined_at desc);
create index if not exists messages_room_created_idx on public.messages(room_id, created_at);
create index if not exists safety_events_status_idx on public.safety_events(status, severity, created_at desc);
create index if not exists reports_room_idx on public.reports(room_id, created_at desc);
create index if not exists waitlist_entries_handle_idx on public.waitlist_entries(lower(telegram_handle));

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.check_ins to authenticated;
grant select, insert, update on public.rooms to authenticated;
grant select, insert on public.room_members to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.safety_events to authenticated;
grant select, insert on public.reports to authenticated;
grant select, insert, update on public.user_feedback to authenticated;
grant insert on public.waitlist_entries to authenticated;
grant all on all tables in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.check_ins enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.safety_events enable row level security;
alter table public.reports enable row level security;
alter table public.user_feedback enable row level security;
alter table public.waitlist_entries enable row level security;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = p_room_id
      and user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "check_ins_select_own" on public.check_ins;
create policy "check_ins_select_own"
on public.check_ins for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "check_ins_insert_own" on public.check_ins;
create policy "check_ins_insert_own"
on public.check_ins for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "rooms_select_member" on public.rooms;
create policy "rooms_select_member"
on public.rooms for select
to authenticated
using (public.is_room_member(id));

drop policy if exists "rooms_insert_own" on public.rooms;
create policy "rooms_insert_own"
on public.rooms for insert
to authenticated
with check ((select auth.uid()) = created_by);

drop policy if exists "room_members_select_member" on public.room_members;
create policy "room_members_select_member"
on public.room_members for select
to authenticated
using (public.is_room_member(room_id));

drop policy if exists "room_members_insert_self" on public.room_members;
create policy "room_members_insert_self"
on public.room_members for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.rooms
    where rooms.id = room_members.room_id
      and rooms.created_by = (select auth.uid())
  )
);

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
on public.messages for select
to authenticated
using (public.is_room_member(room_id));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member"
on public.messages for insert
to authenticated
with check (public.is_room_member(room_id) and (select auth.uid()) = user_id);

drop policy if exists "safety_events_select_own" on public.safety_events;
create policy "safety_events_select_own"
on public.safety_events for select
to authenticated
using (user_id = (select auth.uid()) or public.is_room_member(room_id));

drop policy if exists "safety_events_insert_own" on public.safety_events;
create policy "safety_events_insert_own"
on public.safety_events for insert
to authenticated
with check (user_id = (select auth.uid()) or public.is_room_member(room_id));

drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
on public.reports for select
to authenticated
using (reporter_id = (select auth.uid()));

drop policy if exists "reports_insert_member" on public.reports;
create policy "reports_insert_member"
on public.reports for insert
to authenticated
with check (reporter_id = (select auth.uid()) and public.is_room_member(room_id));

drop policy if exists "feedback_select_own" on public.user_feedback;
create policy "feedback_select_own"
on public.user_feedback for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "feedback_insert_own" on public.user_feedback;
create policy "feedback_insert_own"
on public.user_feedback for insert
to authenticated
with check (user_id = (select auth.uid()) and public.is_room_member(room_id));

drop policy if exists "feedback_update_own" on public.user_feedback;
create policy "feedback_update_own"
on public.user_feedback for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and public.is_room_member(room_id));

drop policy if exists "waitlist_insert_own" on public.waitlist_entries;
create policy "waitlist_insert_own"
on public.waitlist_entries for insert
to authenticated
with check (user_id = (select auth.uid()));

create or replace function public.create_room_for_checkin(
  p_state text,
  p_thought text,
  p_intent text,
  p_topics text[],
  p_safety_level text,
  p_alias text,
  p_hue text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_check_in_id uuid;
  v_room_id uuid;
  v_candidates jsonb := '[]'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.profiles(id, alias, hue)
  values (v_user_id, coalesce(nullif(p_alias, ''), 'гость'), coalesce(nullif(p_hue, ''), '#457b74'))
  on conflict (id) do update
  set alias = excluded.alias,
      hue = excluded.hue,
      updated_at = now();

  insert into public.check_ins(user_id, state, thought, intent, topics, safety_level)
  values (
    v_user_id,
    left(trim(p_state), 64),
    left(trim(p_thought), 600),
    p_intent,
    coalesce(p_topics, '{}'),
    p_safety_level
  )
  returning id into v_check_in_id;

  if p_safety_level in ('blocked', 'crisis') then
    insert into public.safety_events(user_id, label, source, status, severity, detail)
    values (
      v_user_id,
      case when p_safety_level = 'crisis' then 'Кризисный чек-ин' else 'Запрещенный контекст' end,
      'check-in',
      'new',
      case when p_safety_level = 'crisis' then 'high' else 'medium' end,
      'Чек-ин не отправлен в обычный матчинг.'
    );

    return jsonb_build_object(
      'status', 'safety_blocked',
      'check_in_id', v_check_in_id
    );
  end if;

  with scored as (
    select
      ci.id as check_in_id,
      ci.user_id,
      ci.state,
      ci.thought,
      ci.intent,
      ci.topics,
      ci.created_at,
      p.alias,
      p.hue,
      p.trust_score,
      (
        select count(*)
        from unnest(ci.topics) candidate_topic
        where candidate_topic = any(coalesce(p_topics, '{}'))
      ) as topic_overlap,
      case
        when ci.intent = p_intent then 22
        when p_intent = 'support' and ci.intent = 'vent' then 16
        when p_intent = 'vent' and ci.intent = 'support' then 16
        when p_intent = 'similar' and ci.intent <> 'distract' then 12
        when p_intent = 'distract' and ci.intent = 'distract' then 18
        else 6
      end as intent_points
    from public.check_ins ci
    join public.profiles p on p.id = ci.user_id
    where ci.user_id <> v_user_id
      and ci.expires_at > now()
      and ci.safety_level in ('clear', 'sensitive')
    order by topic_overlap desc, intent_points desc, ci.created_at desc
    limit 4
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'check_in_id', check_in_id,
        'user_id', user_id,
        'alias', alias,
        'hue', hue,
        'state', state,
        'thought', thought,
        'intent', intent,
        'topics', topics,
        'minutes_ago', floor(extract(epoch from (now() - created_at)) / 60),
        'score', least(99, greatest(34, (topic_overlap * 24 + intent_points + trust_score / 10)::int)),
        'reasons', array[
          case when topic_overlap > 0 then 'похожие темы' else 'свежий чек-ин' end,
          case when intent = p_intent then 'совпало намерение' else 'совместимое намерение' end,
          'человек рядом по времени'
        ]
      )
    ),
    '[]'::jsonb
  )
  into v_candidates
  from scored;

  insert into public.rooms(title, created_by)
  values ('Комната: ' || coalesce(nullif(left(trim(p_state), 48), ''), 'рядом по мысли'), v_user_id)
  returning id into v_room_id;

  insert into public.room_members(room_id, user_id, alias_snapshot, hue_snapshot)
  select v_room_id, v_user_id, p.alias, p.hue
  from public.profiles p
  where p.id = v_user_id;

  insert into public.room_members(room_id, user_id, alias_snapshot, hue_snapshot)
  select v_room_id, (candidate->>'user_id')::uuid, candidate->>'alias', candidate->>'hue'
  from jsonb_array_elements(v_candidates) candidate
  on conflict do nothing;

  insert into public.messages(room_id, user_id, author_snapshot, body, tone)
  values (
    v_room_id,
    v_user_id,
    'рядом',
    'Комната открыта на 25 минут. Здесь слушают, не ставят диагнозы и не давят советами.',
    'system'
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rm.user_id,
    'alias', rm.alias_snapshot,
    'hue', rm.hue_snapshot,
    'trust_score', coalesce(p.trust_score, 80)
  ) order by rm.joined_at), '[]'::jsonb)
  into v_members
  from public.room_members rm
  left join public.profiles p on p.id = rm.user_id
  where rm.room_id = v_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'author', m.author_snapshot,
    'body', m.body,
    'tone', m.tone,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  into v_messages
  from public.messages m
  where m.room_id = v_room_id;

  return jsonb_build_object(
    'status', 'room_created',
    'check_in_id', v_check_in_id,
    'room', jsonb_build_object('id', v_room_id, 'title', 'Комната: ' || coalesce(nullif(left(trim(p_state), 48), ''), 'рядом по мысли'), 'timer_minutes', 25),
    'members', v_members,
    'messages', v_messages,
    'candidates', v_candidates
  );
end;
$$;

revoke all on function public.create_room_for_checkin(text, text, text, text[], text, text, text) from public, anon;
grant execute on function public.create_room_for_checkin(text, text, text, text[], text, text, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then
    create publication supabase_realtime for table public.messages;
end;
$$;
