# Live Backend Handoff

Публичный сайт уже доступен на GitHub Pages:

https://andolini001.github.io/ryadom-mvp/

Сейчас он работает в demo-mode, потому что production build не получает Supabase env. Чтобы друзья могли реально попадать в общие комнаты и видеть сообщения друг друга, нужно подключить активный Supabase project.

## Current State

- GitHub repo: `Andolini001/ryadom-mvp`
- Pages URL: `https://andolini001.github.io/ryadom-mvp/`
- Pages workflow: `.github/workflows/pages.yml`
- Existing Supabase project discovered through connector: `zfbgkhsigjlphdjamehf`
- Project status at last check: `INACTIVE`

## What Needs Approval

Before changing Supabase account state, get explicit approval to restore or use the inactive project `zfbgkhsigjlphdjamehf`.

Do not put a service role key into frontend or GitHub Pages secrets.

## Activation Steps

1. Restore or create an active Supabase project.
2. Enable anonymous sign-ins in Supabase Auth.
3. Run `supabase/migrations/20260703143000_initial_real_mvp.sql`.
4. Get the project API URL and a publishable key.
5. Add GitHub repository secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. Re-run the `Deploy GitHub Pages` workflow.
7. Open the public site and confirm the top status says `Живой backend`.

## Verification Checklist

- Public page returns 200.
- `npm run smoke:public -- https://andolini001.github.io/ryadom-mvp/` passes.
- Check-in creates a Supabase `check_ins` row.
- `Найти своих` creates or joins a room through `create_room_for_checkin`.
- Sent messages are written to `messages`.
- A second browser session receives the message through Realtime.
- Report creates `reports` and `safety_events` rows.
- Waitlist saves a row to `waitlist_entries`.
