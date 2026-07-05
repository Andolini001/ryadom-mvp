create index if not exists messages_user_idx on public.messages(user_id);
create index if not exists reports_reporter_idx on public.reports(reporter_id);
create index if not exists safety_events_user_idx on public.safety_events(user_id);
create index if not exists safety_events_room_idx on public.safety_events(room_id);
create index if not exists user_feedback_user_idx on public.user_feedback(user_id);
create index if not exists waitlist_entries_user_idx on public.waitlist_entries(user_id);

create index if not exists guest_feedback_guest_idx on public.guest_feedback(guest_id);
create index if not exists guest_messages_guest_idx on public.guest_messages(guest_id);
create index if not exists guest_reports_reporter_guest_idx on public.guest_reports(reporter_guest_id);
create index if not exists guest_safety_events_guest_idx on public.guest_safety_events(guest_id);
create index if not exists guest_safety_events_room_idx on public.guest_safety_events(room_id);
create index if not exists guest_waitlist_entries_guest_idx on public.guest_waitlist_entries(guest_id);

drop policy if exists "guest_profiles_no_direct_access" on public.guest_profiles;
create policy "guest_profiles_no_direct_access"
on public.guest_profiles
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_check_ins_no_direct_access" on public.guest_check_ins;
create policy "guest_check_ins_no_direct_access"
on public.guest_check_ins
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_rooms_no_direct_access" on public.guest_rooms;
create policy "guest_rooms_no_direct_access"
on public.guest_rooms
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_room_members_no_direct_access" on public.guest_room_members;
create policy "guest_room_members_no_direct_access"
on public.guest_room_members
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_messages_no_direct_access" on public.guest_messages;
create policy "guest_messages_no_direct_access"
on public.guest_messages
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_safety_events_no_direct_access" on public.guest_safety_events;
create policy "guest_safety_events_no_direct_access"
on public.guest_safety_events
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_reports_no_direct_access" on public.guest_reports;
create policy "guest_reports_no_direct_access"
on public.guest_reports
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_feedback_no_direct_access" on public.guest_feedback;
create policy "guest_feedback_no_direct_access"
on public.guest_feedback
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "guest_waitlist_entries_no_direct_access" on public.guest_waitlist_entries;
create policy "guest_waitlist_entries_no_direct_access"
on public.guest_waitlist_entries
for all
to anon, authenticated
using (false)
with check (false);

revoke execute on function public.create_guest_room_for_checkin(text, text, text, text, text[], text, text, text) from authenticated;
revoke execute on function public.send_guest_message(text, uuid, text) from authenticated;
revoke execute on function public.load_guest_messages(text, uuid) from authenticated;
revoke execute on function public.create_guest_report(text, uuid, text) from authenticated;
revoke execute on function public.save_guest_feedback(text, uuid, text, text) from authenticated;
revoke execute on function public.join_guest_waitlist(text, text) from authenticated;
revoke execute on function public.load_guest_safety_events(text) from authenticated;
