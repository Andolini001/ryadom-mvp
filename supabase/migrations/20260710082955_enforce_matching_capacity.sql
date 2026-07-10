-- Production guest matching must be atomic: a room accepts at most five members,
-- and only signals with a real semantic overlap can share a room.
create or replace function public.ryadom_intents_compatible(
  p_source text,
  p_candidate text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_source = p_candidate
    or (p_source = 'support' and p_candidate = 'vent')
    or (p_source = 'vent' and p_candidate = 'support')
    or (p_source = 'similar' and p_candidate <> 'distract');
$$;

create or replace function public.ryadom_text_overlap(
  p_left text,
  p_right text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from (
    select unnest(
      pg_catalog.tsvector_to_array(
        pg_catalog.to_tsvector('pg_catalog.russian'::pg_catalog.regconfig, coalesce(p_left, ''))
      )
    )
    intersect
    select unnest(
      pg_catalog.tsvector_to_array(
        pg_catalog.to_tsvector('pg_catalog.russian'::pg_catalog.regconfig, coalesce(p_right, ''))
      )
    )
  ) shared_lexemes;
$$;

revoke all on function public.ryadom_intents_compatible(text, text) from public, anon, authenticated;
revoke all on function public.ryadom_text_overlap(text, text) from public, anon, authenticated;

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
set search_path = ''
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
  v_topics text[] := coalesce(p_topics, '{}');
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
  values (v_guest_id, v_state, v_thought, v_intent, v_topics, v_safety_level)
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
        select count(*)::integer
        from unnest(ci.topics) candidate_topic
        where candidate_topic = any(v_topics)
      ) as topic_overlap,
      public.ryadom_text_overlap(
        v_state || ' ' || v_thought,
        ci.state || ' ' || ci.thought
      ) as text_overlap,
      case
        when ci.intent = v_intent then 22
        when v_intent = 'support' and ci.intent = 'vent' then 16
        when v_intent = 'vent' and ci.intent = 'support' then 16
        when v_intent = 'similar' and ci.intent <> 'distract' then 12
        else 0
      end as intent_points
    from public.guest_check_ins ci
    join public.guest_profiles p on p.id = ci.guest_id
    where ci.guest_id <> v_guest_id
      and ci.expires_at > now()
      and ci.safety_level in ('clear', 'sensitive')
      and public.ryadom_intents_compatible(v_intent, ci.intent)
  ), eligible as (
    select *
    from scored
    where topic_overlap > 0 or text_overlap >= 2
    order by topic_overlap desc, text_overlap desc, intent_points desc, created_at desc
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
        'score', least(99, greatest(34, (topic_overlap * 24 + text_overlap * 7 + intent_points + trust_score / 10)::int)),
        'reasons', array[
          case when topic_overlap > 0 then 'похожие темы' else 'похожие слова и контекст' end,
          case when intent = v_intent then 'совпало намерение' else 'совместимое намерение' end,
          'человек недавно рядом'
        ]
      )
      order by topic_overlap desc, text_overlap desc, intent_points desc, created_at desc
    ),
    '[]'::jsonb
  )
  into v_candidates
  from eligible;

  -- The lock covers candidate selection, capacity check and membership insert.
  -- This prevents parallel requests from overfilling the same room.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ryadom-guest-matchmaking', 0)
  );

  select gr.id, gr.title
  into v_room_id, v_room_title
  from public.guest_check_ins ci
  join public.guest_room_members rm on rm.guest_id = ci.guest_id
  join public.guest_rooms gr on gr.id = rm.room_id
  where ci.guest_id <> v_guest_id
    and ci.expires_at > now()
    and ci.safety_level in ('clear', 'sensitive')
    and gr.status = 'open'
    and gr.created_at > now() - interval '30 minutes'
    and not public.is_guest_room_member(gr.id, v_guest_id)
    and public.ryadom_intents_compatible(v_intent, ci.intent)
    and (
      exists (
        select 1
        from unnest(ci.topics) candidate_topic
        where candidate_topic = any(v_topics)
      )
      or public.ryadom_text_overlap(
        v_state || ' ' || v_thought,
        ci.state || ' ' || ci.thought
      ) >= 2
    )
    and (
      select count(*)
      from public.guest_room_members capacity
      where capacity.room_id = gr.id
    ) < 5
  order by (
      select count(*)
      from unnest(ci.topics) candidate_topic
      where candidate_topic = any(v_topics)
    ) desc,
    public.ryadom_text_overlap(
      v_state || ' ' || v_thought,
      ci.state || ' ' || ci.thought
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

  update public.guest_rooms
  set status = 'closed'
  where id = v_room_id
    and (
      select count(*)
      from public.guest_room_members capacity
      where capacity.room_id = v_room_id
    ) >= 5;

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
    'guest_id', m.guest_id,
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
    'room', jsonb_build_object(
      'id', v_room_id,
      'title', coalesce(v_room_title, 'Комната: рядом по мысли'),
      'timer_minutes', 25
    ),
    'members', v_members,
    'messages', v_messages,
    'candidates', v_candidates
  );
end;
$$;

revoke all on function public.create_guest_room_for_checkin(text, text, text, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.create_guest_room_for_checkin(text, text, text, text, text[], text, text, text) to anon;

-- These endpoints disappeared from the product UI. Keep their data for now,
-- but remove anonymous execution so they are no longer part of the public API.
revoke execute on function public.join_guest_waitlist(text, text) from anon;
revoke execute on function public.load_guest_safety_events(text) from anon;
revoke execute on function public.load_guest_messages(text, uuid) from anon;
