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
- PWA-манифест и service worker для базового офлайн-кэша.

## Команды

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

## Следующий backend-слой

Локальные структуры уже разделены на доменные типы, seed-данные и matching-helper. Для production-версии их можно заменить на:

- `User`, `CheckIn`, `MoodSignal`, `Room`, `Message`, `SafetyEvent`, `Report`, `UserFeedback` в Supabase/Postgres.
- Realtime-каналы для комнат.
- Серверный safety-filter до матчинга.
- Queue worker для модерации и кризисных чек-инов.
- Telegram bot/Mini App для waitlist и concierge-MVP.
