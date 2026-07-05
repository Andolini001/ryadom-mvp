# Live Backend Handoff

Публичный сайт уже доступен на GitHub Pages:

https://andolini001.github.io/ryadom-mvp/

Production build подключается к Supabase через GitHub Actions secrets. Сейчас приложение использует гостевой live-режим: браузер создает локальный гостевой токен, а база принимает только ограниченные RPC-вызовы для комнат, сообщений, репортов, feedback и waitlist.

## Current State

- GitHub repo: `Andolini001/ryadom-mvp`
- Pages URL: `https://andolini001.github.io/ryadom-mvp/`
- Pages workflow: `.github/workflows/pages.yml`
- Active Supabase project: `wolhpchxdkkblkyavyft`
- Project URL: `https://wolhpchxdkkblkyavyft.supabase.co`
- Backend mode: guest live fallback, because Supabase Anonymous Sign-In is disabled by default in the new project.

## Backend Notes

- Do not put a service role key into frontend or GitHub Pages secrets.
- Public frontend uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `VITE_SUPABASE_USE_AUTH=false` keeps the public app on the guest RPC path and avoids failed Anonymous Auth requests in the browser console.
- Guest live data is isolated behind security-definer RPC functions and RLS-enabled tables.
- If Anonymous Sign-In is enabled later in Supabase Auth settings, set `VITE_SUPABASE_USE_AUTH=true` to try the stricter authenticated path first and fall back to guest RPC if anonymous auth fails.

## Activation Steps

1. Active Supabase project exists: `wolhpchxdkkblkyavyft`.
2. Initial migration applied: `supabase/migrations/20260703143000_initial_real_mvp.sql`.
3. Guest live fallback migration applied: `supabase/migrations/20260705123000_guest_live_backend.sql`.
4. GitHub repository secrets must be present:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Optional: `VITE_SUPABASE_USE_AUTH=true` only after enabling Anonymous Sign-In in Supabase Auth.
5. Re-run the `Deploy GitHub Pages` workflow after code or secret changes.
6. Open the public site and confirm the top status says `Живой backend`.

## Verification Checklist

- Public page returns 200.
- `npm run smoke:public -- https://andolini001.github.io/ryadom-mvp/` passes.
- Guest check-in creates a `guest_check_ins` row.
- First guest creates a `guest_rooms` room.
- Second guest with similar topics joins the same room through `create_guest_room_for_checkin`.
- Sent messages are written to `guest_messages`.
- Another browser session reads room messages through `load_guest_messages` polling.
- Report creates `guest_reports` and `guest_safety_events` rows.
- Waitlist saves a row to `guest_waitlist_entries`.
