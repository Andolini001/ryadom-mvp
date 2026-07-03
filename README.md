# Рядом

MVP русскоязычной соцсети по состоянию: пользователь пишет короткое состояние и мысль, выбирает намерение, проходит safety-фильтр, получает подбор похожих людей и попадает в малую анонимную комнату.

## Что реализовано

- Mobile-first PWA на React + Vite + TypeScript.
- Чек-ин: состояние в 1-3 слова, короткая мысль, четыре намерения.
- Локальный алгоритм матчинга: темы, совместимость намерения, свежесть, trust-score.
- Safety-фильтр: кризисные и запрещенные контексты не отправляются в обычный матчинг.
- Демо-комната на 3-5 участников с таймером, сообщениями и отправкой ответа.
- Репорт и блокировка в один клик с записью в очередь модерации.
- After-chat feedback и Telegram waitlist-форма.
- Production-слой на Supabase: anonymous auth, Postgres-таблицы, RLS, RPC для создания комнаты, realtime-сообщения, waitlist, reports, feedback.
- Demo fallback: если Supabase env не задан, приложение остается кликабельным локальным MVP.
- PWA-манифест и service worker для базового офлайн-кэша.

## Команды

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

## Live backend через Supabase

1. Создай Supabase project.
2. Включи Anonymous Sign-Ins в Auth providers.
3. Выполни SQL из `supabase/migrations/20260703143000_initial_real_mvp.sql` в SQL editor.
4. Создай `.env.local` по примеру `.env.example`.
5. Запусти `npm run dev`.

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

Фронтенд не использует service role key. Все пользовательские операции идут через anonymous auth, RLS и RPC `create_room_for_checkin`.

Подробная инструкция: `docs/production-setup.md`.
