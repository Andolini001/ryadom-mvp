-- These are intentional anon RPC endpoints. Identity is derived from the guest token,
-- and every room read/write is guarded by an explicit membership check.
create or replace function public.send_guest_message(
  p_guest_token text,
  p_room_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest_id uuid := public.guest_token_uuid(p_guest_token);
  v_alias text;
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

  select alias
  into v_alias
  from public.guest_profiles
  where id = v_guest_id;

  if v_alias is null then
    raise exception 'Guest profile unavailable';
  end if;

  insert into public.guest_messages(room_id, guest_id, author_snapshot, body, tone)
  values (p_room_id, v_guest_id, v_alias, left(trim(p_body), 1200), 'warm')
  returning jsonb_build_object(
    'id', id,
    'guest_id', guest_id,
    'author', author_snapshot,
    'body', body,
    'tone', tone,
    'created_at', created_at
  )
  into v_message;

  return v_message;
end;
$$;

create or replace function public.load_guest_messages_since(
  p_guest_token text,
  p_room_id uuid,
  p_after timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
    'guest_id', m.guest_id,
    'author', m.author_snapshot,
    'body', m.body,
    'tone', m.tone,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  into v_messages
  from (
    select id, guest_id, author_snapshot, body, tone, created_at
    from public.guest_messages
    where room_id = p_room_id
      and (p_after is null or created_at > p_after)
    order by created_at
    limit 50
  ) m;

  return v_messages;
end;
$$;

revoke all on function public.send_guest_message(text, uuid, text) from public, anon, authenticated;
grant execute on function public.send_guest_message(text, uuid, text) to anon;

revoke all on function public.load_guest_messages_since(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.load_guest_messages_since(text, uuid, timestamptz) to anon;
