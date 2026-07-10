import type { CheckIn, Intent, Room } from './types'

export const intentLabels: Record<Intent, string> = {
  vent: 'выговориться',
  similar: 'найти похожего',
  support: 'получить поддержку',
  distract: 'отвлечься',
}

export const intentDescriptions: Record<Intent, string> = {
  vent: 'Комната слушает без советов и оценок.',
  similar: 'Алгоритм ищет похожие темы и состояние.',
  support: 'В чате больше теплых ответов и вопросов.',
  distract: 'Подбор людей, которые мягко переводят фокус.',
}

export const seedCheckIns: CheckIn[] = [
  {
    id: 'ci-01',
    user: {
      id: 'u-01',
      alias: 'июль 24',
      hue: '#d36f52',
      lastSeen: 'онлайн',
      trustScore: 94,
    },
    state: 'тихая усталость',
    thought:
      'Вроде все нормально, но нет сил объяснять людям, почему я сегодня выключен.',
    intent: 'similar',
    topics: ['усталость', 'работа', 'одиночество', 'тишина'],
    minutesAgo: 3,
  },
  {
    id: 'ci-02',
    user: {
      id: 'u-02',
      alias: 'март 27',
      hue: '#2f7d74',
      lastSeen: '2 мин назад',
      trustScore: 88,
    },
    state: 'непонятная тревога',
    thought:
      'Хочется поговорить с кем-то, кто не будет сразу чинить меня советами.',
    intent: 'vent',
    topics: ['тревога', 'отношения', 'ночь', 'поддержка'],
    minutesAgo: 6,
  },
  {
    id: 'ci-03',
    user: {
      id: 'u-03',
      alias: 'север 22',
      hue: '#6f7d5f',
      lastSeen: 'онлайн',
      trustScore: 91,
    },
    state: 'мысли шумят',
    thought:
      'Слишком много дел и переписок. Хочу просто пять минут быть не один в этом шуме.',
    intent: 'support',
    topics: ['перегруз', 'учеба', 'работа', 'тревога'],
    minutesAgo: 9,
  },
  {
    id: 'ci-04',
    user: {
      id: 'u-04',
      alias: 'соня 25',
      hue: '#8c6a9e',
      lastSeen: '5 мин назад',
      trustScore: 84,
    },
    state: 'нужно выдохнуть',
    thought:
      'День был странный. Было бы классно поговорить ни о чем и немного отпустить голову.',
    intent: 'distract',
    topics: ['отвлечение', 'вечер', 'усталость', 'голова'],
    minutesAgo: 11,
  },
  {
    id: 'ci-05',
    user: {
      id: 'u-05',
      alias: 'ноябрь 29',
      hue: '#bb7d43',
      lastSeen: 'онлайн',
      trustScore: 89,
    },
    state: 'одиноко дома',
    thought:
      'У всех своя жизнь, а я опять завис в телефоне и не знаю, кому написать.',
    intent: 'similar',
    topics: ['одиночество', 'дом', 'вечер', 'переписка'],
    minutesAgo: 14,
  },
  {
    id: 'ci-06',
    user: {
      id: 'u-06',
      alias: 'мята 21',
      hue: '#4c8b85',
      lastSeen: '8 мин назад',
      trustScore: 92,
    },
    state: 'хочу тишины',
    thought:
      'Меня дергают весь день. Нужен спокойный разговор без давления отвечать идеально.',
    intent: 'support',
    topics: ['тишина', 'границы', 'работа', 'усталость'],
    minutesAgo: 18,
  },
  {
    id: 'ci-07',
    user: {
      id: 'u-07',
      alias: 'август 26',
      hue: '#7b7fc8',
      lastSeen: 'онлайн',
      trustScore: 93,
    },
    state: 'ищу смысл в шуме',
    thought:
      'Тоже ловлю ощущение, что вокруг много движения, а хочется понять, что из этого правда мое.',
    intent: 'similar',
    topics: ['смысл', 'перегруз', 'одиночество'],
    minutesAgo: 4,
  },
  {
    id: 'ci-08',
    user: {
      id: 'u-08',
      alias: 'июнь 23',
      hue: '#c28f55',
      lastSeen: '3 мин назад',
      trustScore: 90,
    },
    state: 'думаю о будущем',
    thought:
      'Меня тоже цепляет, что будущее складывается из маленьких выборов, которые сначала кажутся случайными.',
    intent: 'support',
    topics: ['будущее', 'смысл', 'поддержка'],
    minutesAgo: 7,
  },
  {
    id: 'ci-09',
    user: {
      id: 'u-09',
      alias: 'океан 28',
      hue: '#5f9f92',
      lastSeen: 'онлайн',
      trustScore: 95,
    },
    state: 'хочу глубины',
    thought:
      'Не хватает разговора, где можно не играть бодрость и спокойно подумать вслух вместе с кем-то.',
    intent: 'vent',
    topics: ['глубина', 'тишина', 'поддержка'],
    minutesAgo: 10,
  },
]

export const initialRoom: Room = {
  id: 'room-quiet-204',
  title: 'Комната: тихая усталость',
  timerMinutes: 23,
  members: seedCheckIns.slice(0, 4).map((entry) => entry.user),
  messages: [
    {
      id: 'm-01',
      author: 'рядом',
      body: 'Комната открыта на 25 минут. Без диагнозов, давления и советов без запроса.',
      time: '20:41',
      tone: 'system',
    },
    {
      id: 'm-02',
      author: 'июль 24',
      body: 'У меня сегодня тоже состояние “я есть, но меня как будто нет”.',
      time: '20:42',
      tone: 'plain',
    },
    {
      id: 'm-03',
      author: 'март 27',
      body: 'Похоже. Я зашел просто посидеть с кем-то рядом, без большого разговора.',
      time: '20:43',
      tone: 'warm',
    },
  ],
}
