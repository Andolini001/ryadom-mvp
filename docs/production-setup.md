# Production setup

`Рядом` уже умеет работать в двух режимах:

- `Демо-режим`: Supabase env не задан, все работает локально для показа UX.
- `Живой backend`: Supabase env задан, чек-ины, комнаты, сообщения, репорты, оценки и waitlist пишутся в Postgres.

## Supabase

1. Создай новый Supabase project.
2. Открой `SQL Editor`.
3. Выполни все файлы из `supabase/migrations` по имени, от старого к новому.
4. Для режима Supabase anonymous auth дополнительно включи `Authentication -> Sign In / Providers -> Anonymous Sign-Ins` и задай `VITE_SUPABASE_USE_AUTH=true`.

По умолчанию используется гостевой backend: браузер получает случайный UUID-токен, а все записи и чтение идут через ограниченные RPC с проверкой членства в комнате. Это позволяет показать друзьям приложение без регистрации и без включения anonymous auth.

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
- RPC для создания комнаты, сообщений, репортов, feedback и waitlist
- RLS policies для anonymous-auth пользователей
- закрытые RLS-таблицы и delta polling для гостевых комнат
- Realtime publication для authenticated-комнат

## Env

Создай `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
# Только если нужен режим Supabase anonymous auth:
VITE_SUPABASE_USE_AUTH=true
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
- Telegram handle записывается в `guest_waitlist_entries` или `waitlist_entries` в зависимости от режима сессии.

Автоматическая проверка двух независимых гостей:

```bash
npm run smoke:live -- https://your-public-url.example/
```

Тест создает два временных чек-ина, проверяет общий номер комнаты, обновление состава и доставку сообщения получателю.

## Следующий production-шаг

Для реального запуска на 100-300 пользователей стоит добавить серверный moderation worker: кризисные и запрещенные чек-ины должны попадать в отдельную очередь, а не зависеть только от frontend-фильтра.
