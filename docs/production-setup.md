# Production setup

`Рядом` уже умеет работать в двух режимах:

- `Демо-режим`: Supabase env не задан, все работает локально для показа UX.
- `Живой backend`: Supabase env задан, чек-ины, комнаты, сообщения, репорты, оценки и waitlist пишутся в Postgres.

## Supabase

1. Создай новый Supabase project.
2. Открой `Authentication -> Sign In / Providers`.
3. Включи `Anonymous Sign-Ins`.
4. Открой `SQL Editor`.
5. Выполни `supabase/migrations/20260703143000_initial_real_mvp.sql`.

Миграция создает:

- `profiles`
- `check_ins`
- `rooms`
- `room_members`
- `messages`
- `safety_events`
- `reports`
- `user_feedback`
- `waitlist_entries`
- RPC `create_room_for_checkin`
- RLS policies для anonymous-auth пользователей
- Realtime publication для `messages`

## Env

Создай `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

Не добавляй service role key во frontend. Он нужен только для серверных админ-задач и модераторской панели.

## Local run

```bash
npm install
npm run dev
```

Если env корректный, верхняя строка в приложении покажет `Живой backend`. Если Supabase недоступен, приложение переключится в fallback и останется usable для демо.

## Что проверить перед первым публичным тестом

- Чек-ин создает запись в `check_ins`.
- Комната создается через RPC `create_room_for_checkin`.
- Сообщение появляется в `messages` и приходит через Realtime.
- Репорт создает запись в `reports` и `safety_events`.
- Оценка после комнаты сохраняется в `user_feedback`.
- Telegram handle записывается в `waitlist_entries`.

## Следующий production-шаг

Для реального запуска на 100-300 пользователей стоит добавить серверный moderation worker: кризисные и запрещенные чек-ины должны попадать в отдельную очередь, а не зависеть только от frontend-фильтра.
