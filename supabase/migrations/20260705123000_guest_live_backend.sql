create table if not exists public.guest_profiles (
  id uuid primary key,
  alias text not null,
  hue text not null default '#457b74',
  age_zone text not null default '18-30',
  trust_score integer not null default 80 check (trust_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guest_check_ins (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guest_profiles(id) on delete cascade,
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

create table if not exists public.guest_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  timer_minutes integer not null default 25 check (timer_minutes between 5 and 60),
  status text not null default 'open' check (status in ('open', 'closed', 'moderated')),
  created_by_guest_id uuid not null references public.guest_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_room_members (
  room_id uuid not null references public.guest_rooms(id) on delete cascade,
  guest_id uuid not null references public.guest_profiles(id) on delete cascade,
  alias_snapshot text not null,
  hue_snapshot text not null default '#457b74',
  joined_at timestamptz not null default now(),
  primary key (room_id, guest_id)
);

create table if not exists public.guest_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.guest_rooms(id) on delete cascade,
  guest_id uuid references public.guest_profiles(id) on delete set null,
  author_snapshot text not null,
  body text not null check (char_length(body) between 1 and 1200),
  tone text not null default 'plain' check (tone in ('warm', 'plain', 'system')),
  created_at timestamptz not null default now()
);

create table if not exists public.guest_safety_events (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references public.guest_profiles(id) on delete set null,
  room_id uuid references public.guest_rooms(id) on delete set null,
  label text not null,
  source text not null,
  status text not null default 'new' check (status in ('new', 'watching', 'resolved')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.guest_rooms(id) on delete cascade,
  reporter_guest_id uuid not null references public.guest_profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_feedback (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.guest_rooms(id) on delete cascade,
  guest_id uuid not null references public.guest_profiles(id) on delete cascade,
  mood_after text check (mood_after in ('lighter', 'same', 'worse')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (room_id, guest_id)
);

create table if not exists public.guest_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid references public.guest_profiles(id) on delete set null,
  telegram_handle text not null,
  source text not null default 'web',
  created_at timestamptz not null default now()
);

create index if not exists guest_check_ins_live_idx on public.guest_check_ins(safety_level, expires_at, created_at desc);
create index if not exists guest_check_ins_guest_created_idx on public.guest_check_ins(guest_id, created_at desc);
create index if not exists guest_check_ins_topics_idx on public.guest_check_ins using gin(topics);
create index if not exists guest_rooms_created_by_idx on public.guest_rooms(created_by_guest_id, created_at desc);
create index if not exists guest_room_members_guest_idx on public.guest_room_members(guest_id, joined_at desc);
create index if not exists guest_messages_room_created_idx on public.guest_messages(room_id, created_at);
create index if not exists guest_safety_events_status_idx on public.guest_safety_events(status, severity, created_at desc);
create index if not exists guest_reports_room_idx on public.guest_reports(room_id, created_at desc);
create index if not exists guest_waitlist_entries_handle_idx on public.guest_waitlist_entries(lower(telegram_handle));

alter table public.guest_profiles enable row level security;
alter table public.guest_check_ins enable row level security;
alter table public.guest_rooms enable row level security;
alter table public.guest_room_members enable row level security;
alter table public.guest_messages enable row level security;
alter table public.guest_safety_events enable row level security;
alter table public.guest_reports enable row level security;
alter table public.guest_feedback enable row level security;
alter table public.guest_waitlist_entries enable row level security;

create or replace function public.guest_token_uuid(p_guest_token text)
returns uuid
language plpgsql
immutable
security definer
set search_path = public
as $$
begin
  if p_guest_token is null or p_guest_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid guest token';
  end if;

  return lower(p_guest_token)::uuid;
end;
$$;

create or replace function public.is_guest_room_member(p_room_id uuid, p_guest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.guest_room_members
    where room_id = p_room_id
      and guest_id = p_guest_id
  );
$$;

revoke all on function public.guest_token_uuid(text) from public, anon, authenticated;
revoke all on function public.is_guest_room_member(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_guest_room_for_checkin(
  p_guest_token text,
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
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
  v_check_in_id uuid;
  v_room_id uuid;
  v_room_title text;
  v_candidates jsonb := '[]'::jsonb;
  v_members jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
  v_state text := left(coalesce(nullif(trim(p_state), ''), 'новая мысль'), 64);
  v_thought text := left(coalesce(nullif(trim(p_thought), ''), 'хочу поговорить с похожим человеком'), 600);
  v_intent text := case when p_intent in ('vent', 'similar', 'support', 'distract') then p_intent else 'similar' end;
  v_safety_level text := case when p_safety_level in ('clear', 'sensitive', 'blocked', 'crisis') then p_safety_level else 'clear' end;
  v_joined boolean := false;
begin
  if (
    select count(*)
    from public.guest_check_ins
    where guest_id = v_guest_id
      and created_at > now() - interval '1 minute'
  ) >= 5 then
    raise exception 'Слишком много попыток. Подожди минуту.';
  end if;

  insert into public.guest_profiles(id, alias, hue)
  values (v_guest_id, coalesce(nullif(p_alias, ''), 'гость'), coalesce(nullif(p_hue, ''), '#457b74'))
  on conflict (id) do update
  set alias = excluded.alias,
      hue = excluded.hue,
      updated_at = now();

  insert into public.guest_check_ins(guest_id, state, thought, intent, topics, safety_level)
  values (v_guest_id, v_state, v_thought, v_intent, coalesce(p_topics, '{}'), v_safety_level)
  returning id into v_check_in_id;

  if v_safety_level in ('blocked', 'crisis') then
    insert into public.guest_safety_events(guest_id, label, source, status, severity, detail)
    values (
      v_guest_id,
      case when v_safety_level = 'crisis' then 'Кризисный чек-ин' else 'Запрещенный контекст' end,
      'check-in',
      'new',
      case when v_safety_level = 'crisis' then 'high' else 'medium' end,
      'Чек-ин не отправлен в обычный матчинг.'
    );

    return jsonb_build_object('status', 'safety_blocked', 'check_in_id', v_check_in_id);
  end if;

  with scored as (
    select
      ci.id as check_in_id,
      ci.guest_id as user_id,
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
        when ci.intent = v_intent then 22
        when v_intent = 'support' and ci.intent = 'vent' then 16
        when v_intent = 'vent' and ci.intent = 'support' then 16
        when v_intent = 'similar' and ci.intent <> 'distract' then 12
        when v_intent = 'distract' and ci.intent = 'distract' then 18
        else 6
      end as intent_points
    from public.guest_check_ins ci
    join public.guest_profiles p on p.id = ci.guest_id
    where ci.guest_id <> v_guest_id
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
          case when intent = v_intent then 'совпало намерение' else 'совместимое намерение' end,
          'человек рядом по времени'
        ]
      )
    ),
    '[]'::jsonb
  )
  into v_candidates
  from scored;

  select gr.id, gr.title
  into v_room_id, v_room_title
  from public.guest_check_ins ci
  join public.guest_room_members rm on rm.guest_id = ci.guest_id
  join public.guest_rooms gr on gr.id = rm.room_id
  where ci.guest_id <> v_guest_id
    and ci.expires_at > now()
    and ci.safety_level in ('clear', 'sensitive')
    and gr.status = 'open'
    and not public.is_guest_room_member(gr.id, v_guest_id)
  order by (
      select count(*)
      from unnest(ci.topics) candidate_topic
      where candidate_topic = any(coalesce(p_topics, '{}'))
    ) desc,
    ci.created_at desc
  limit 1;

  if v_room_id is null then
    v_room_title := 'Комната: ' || v_state;

    insert into public.guest_rooms(title, created_by_guest_id)
    values (v_room_title, v_guest_id)
    returning id into v_room_id;

    insert into public.guest_room_members(room_id, guest_id, alias_snapshot, hue_snapshot)
    select v_room_id, v_guest_id, p.alias, p.hue
    from public.guest_profiles p
    where p.id = v_guest_id;

    insert into public.guest_messages(room_id, guest_id, author_snapshot, body, tone)
    values (
      v_room_id,
      null,
      'рядом',
      'Комната открыта на 25 минут. Здесь слушают, не ставят диагнозы и не давят советами.',
      'system'
    );
  else
    with joined as (
      insert into public.guest_room_members(room_id, guest_id, alias_snapshot, hue_snapshot)
      select v_room_id, v_guest_id, p.alias, p.hue
      from public.guest_profiles p
      where p.id = v_guest_id
      on conflict do nothing
      returning room_id
    )
    select exists(select 1 from joined) into v_joined;

    if v_joined then
      insert into public.guest_messages(room_id, guest_id, author_snapshot, body, tone)
      values (
        v_room_id,
        null,
        'рядом',
        coalesce(nullif(p_alias, ''), 'гость') || ' присоединился к комнате по похожей мысли.',
        'system'
      );
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', rm.guest_id,
    'alias', rm.alias_snapshot,
    'hue', rm.hue_snapshot,
    'trust_score', coalesce(p.trust_score, 80)
  ) order by rm.joined_at), '[]'::jsonb)
  into v_members
  from public.guest_room_members rm
  left join public.guest_profiles p on p.id = rm.guest_id
  where rm.room_id = v_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'author', m.author_snapshot,
    'body', m.body,
    'tone', m.tone,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  into v_messages
  from public.guest_messages m
  where m.room_id = v_room_id;

  return jsonb_build_object(
    'status', 'room_created',
    'check_in_id', v_check_in_id,
    'room', jsonb_build_object('id', v_room_id, 'title', coalesce(v_room_title, 'Комната: рядом по мысли'), 'timer_minutes', 25),
    'members', v_members,
    'messages', v_messages,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.send_guest_message(
  p_guest_token text,
  p_room_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
  v_message jsonb;
begin
  if not public.is_guest_room_member(p_room_id, v_guest_id) then
    raise exception 'Room unavailable';
  end if;

  if (
    select count(*)
    from public.guest_messages
    where guest_id = v_guest_id
      and created_at > now() - interval '1 minute'
  ) >= 24 then
    raise exception 'Слишком много сообщений. Подожди минуту.';
  end if;

  insert into public.guest_messages(room_id, guest_id, author_snapshot, body, tone)
  values (p_room_id, v_guest_id, 'вы', left(trim(p_body), 1200), 'warm')
  returning jsonb_build_object(
    'id', id,
    'author', author_snapshot,
    'body', body,
    'tone', tone,
    'created_at', created_at
  )
  into v_message;

  return v_message;
end;
$$;

create or replace function public.load_guest_messages(
  p_guest_token text,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
  v_messages jsonb;
begin
  if not public.is_guest_room_member(p_room_id, v_guest_id) then
    raise exception 'Room unavailable';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'author', m.author_snapshot,
    'body', m.body,
    'tone', m.tone,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  into v_messages
  from public.guest_messages m
  where m.room_id = p_room_id;

  return v_messages;
end;
$$;

create or replace function public.create_guest_report(
  p_guest_token text,
  p_room_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
begin
  if not public.is_guest_room_member(p_room_id, v_guest_id) then
    raise exception 'Room unavailable';
  end if;

  insert into public.guest_reports(room_id, reporter_guest_id, reason)
  values (p_room_id, v_guest_id, left(trim(p_reason), 400));

  insert into public.guest_safety_events(guest_id, room_id, label, source, status, severity, detail)
  values (
    v_guest_id,
    p_room_id,
    left(trim(p_reason), 400),
    'room',
    'new',
    case when p_reason ilike '%Заблокировать%' then 'medium' else 'low' end,
    'Репорт создан пользователем и отправлен в очередь модерации.'
  );
end;
$$;

create or replace function public.save_guest_feedback(
  p_guest_token text,
  p_room_id uuid,
  p_mood_after text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
  v_mood text := case when p_mood_after in ('lighter', 'same', 'worse') then p_mood_after else null end;
begin
  if not public.is_guest_room_member(p_room_id, v_guest_id) then
    raise exception 'Room unavailable';
  end if;

  if v_mood is null and nullif(trim(coalesce(p_note, '')), '') is null then
    return;
  end if;

  insert into public.guest_feedback(room_id, guest_id, mood_after, note)
  values (p_room_id, v_guest_id, v_mood, left(trim(coalesce(p_note, '')), 1200))
  on conflict (room_id, guest_id) do update
  set mood_after = excluded.mood_after,
      note = excluded.note,
      created_at = now();
end;
$$;

create or replace function public.join_guest_waitlist(
  p_guest_token text,
  p_telegram_handle text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
begin
  insert into public.guest_profiles(id, alias, hue)
  values (v_guest_id, 'гость', '#457b74')
  on conflict (id) do nothing;

  insert into public.guest_waitlist_entries(guest_id, telegram_handle, source)
  values (v_guest_id, left(trim(p_telegram_handle), 120), 'web');
end;
$$;

create or replace function public.load_guest_safety_events(p_guest_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
  v_events jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'label', label,
    'source', source,
    'status', status,
    'severity', severity,
    'detail', detail
  ) order by created_at desc), '[]'::jsonb)
  into v_events
  from (
    select distinct e.*
    from public.guest_safety_events e
    where e.guest_id = v_guest_id
       or exists (
        select 1
        from public.guest_room_members rm
        where rm.room_id = e.room_id
          and rm.guest_id = v_guest_id
      )
    order by e.created_at desc
    limit 5
  ) e;

  return v_events;
end;
$$;

revoke all on function public.create_guest_room_for_checkin(text, text, text, text, text[], text, text, text) from public;
revoke all on function public.send_guest_message(text, uuid, text) from public;
revoke all on function public.load_guest_messages(text, uuid) from public;
revoke all on function public.create_guest_report(text, uuid, text) from public;
revoke all on function public.save_guest_feedback(text, uuid, text, text) from public;
revoke all on function public.join_guest_waitlist(text, text) from public;
revoke all on function public.load_guest_safety_events(text) from public;

grant execute on function public.create_guest_room_for_checkin(text, text, text, text, text[], text, text, text) to anon, authenticated;
grant execute on function public.send_guest_message(text, uuid, text) to anon, authenticated;
grant execute on function public.load_guest_messages(text, uuid) to anon, authenticated;
grant execute on function public.create_guest_report(text, uuid, text) to anon, authenticated;
grant execute on function public.save_guest_feedback(text, uuid, text, text) to anon, authenticated;
grant execute on function public.join_guest_waitlist(text, text) to anon, authenticated;
grant execute on function public.load_guest_safety_events(text) to anon, authenticated;
