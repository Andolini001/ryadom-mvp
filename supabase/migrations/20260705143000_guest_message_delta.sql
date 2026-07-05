create or replace function public.load_guest_messages_since(
  p_guest_token text,
  p_room_id uuid,
  p_after timestamptz default null
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
  from (
    select id, author_snapshot, body, tone, created_at
    from public.guest_messages
    where room_id = p_room_id
      and (p_after is null or created_at > p_after)
    order by created_at
    limit 50
  ) m;

  return v_messages;
end;
$$;

revoke all on function public.load_guest_messages_since(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.load_guest_messages_since(text, uuid, timestamptz) to anon;
