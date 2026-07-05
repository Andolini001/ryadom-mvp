import { seedCheckIns } from './data'
import type { CheckIn, Intent, MatchCandidate, MoodSignal, SafetyLevel } from './types'

const topicLexicon: Array<[string, string[]]> = [
  ['усталость', ['устал', 'нет сил', 'выгор', 'сил', 'обессилен', 'разбит']],
  ['тревога', ['тревог', 'паник', 'страш', 'нерв', 'беспокой']],
  ['одиночество', ['один', 'одинок', 'никому', 'некому', 'пусто']],
  ['работа', ['работ', 'дедлайн', 'офис', 'коллег', 'дела']],
  ['учеба', ['учеб', 'экзамен', 'пара', 'универ', 'сесс']],
  ['отношения', ['отнош', 'любов', 'расстал', 'переписк', 'друг']],
  ['тишина', ['тишин', 'молч', 'спокой', 'выдох', 'пауза']],
  ['ночь', ['ноч', 'вечер', 'уснуть', 'сон']],
  ['перегруз', ['много', 'шум', 'перегруз', 'хаос', 'мысли']],
  ['отвлечение', ['отвлеч', 'сериал', 'прогул', 'разговор ни о чем']],
  ['поддержка', ['поддерж', 'обнять', 'услыш', 'рядом', 'тепл']],
  ['смысл', ['смысл', 'осознан', 'настоящ', 'ритм']],
  ['будущее', ['будущ', 'решен', 'выбор', 'строим', 'жизнь']],
  ['глубина', ['глубин', 'small talk', 'простор', 'разговор']],
]

const thoughtLensLexicon: Array<[string, string[]]> = [
  ['смысл', ['смысл', 'зачем', 'почему', 'настоящ', 'ценност', 'жизнь']],
  ['выбор', ['выбор', 'решен', 'можно ли', 'если', 'осознан', 'путь']],
  ['парадокс', ['вроде', 'одновременно', 'странно', 'как будто', 'с одной стороны']],
  ['будущее', ['будущ', 'время', 'потом', 'строим', 'мечт', 'кем стану']],
  ['глубина', ['глубин', 'по-настоящ', 'думать вслух', 'простор', 'вопрос']],
  ['границы', ['границ', 'давлен', 'не хочу', 'дергают', 'объяснять']],
]

const crisisPhrases = [
  'хочу умереть',
  'суицид',
  'самоубий',
  'убить себя',
  'не хочу жить',
  'покончить с собой',
]

const blockedPhrases = [
  'секс',
  'интим',
  'нюд',
  '18-',
  'несовершеннолет',
  'свидание',
  'знакомства для',
]

const tokenize = (value: string) =>
  value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

const includesAny = (value: string, phrases: string[]) => {
  const normalized = value.toLocaleLowerCase('ru-RU')
  return phrases.some((phrase) => normalized.includes(phrase))
}

export const inferTopics = (state: string, thought: string) => {
  const text = `${state} ${thought}`.toLocaleLowerCase('ru-RU')
  const topics = topicLexicon
    .filter(([, stems]) => stems.some((stem) => text.includes(stem)))
    .map(([topic]) => topic)

  return [...new Set(topics)].slice(0, 5)
}

export const inferThoughtLenses = (state: string, thought: string) => {
  const text = `${state} ${thought}`.toLocaleLowerCase('ru-RU')
  const lenses = thoughtLensLexicon
    .filter(([, stems]) => stems.some((stem) => text.includes(stem)))
    .map(([lens]) => lens)

  return [...new Set(lenses)].slice(0, 4)
}

export const calculateDepthScore = (state: string, thought: string) => {
  const text = `${state} ${thought}`
  const words = tokenize(text)
  const lenses = inferThoughtLenses(state, thought)
  const hasQuestion = /[?？]/u.test(text) || text.toLocaleLowerCase('ru-RU').includes('можно ли')
  const hasTension = [' но ', 'вроде', 'одновременно', 'как будто'].some((item) =>
    ` ${text.toLocaleLowerCase('ru-RU')} `.includes(item),
  )

  return Math.min(
    99,
    24 +
      Math.min(words.length, 42) +
      lenses.length * 9 +
      (hasQuestion ? 12 : 0) +
      (hasTension ? 10 : 0),
  )
}

export const assessSafety = (state: string, thought: string): SafetyLevel => {
  const text = `${state} ${thought}`

  if (includesAny(text, crisisPhrases)) {
    return 'crisis'
  }

  if (includesAny(text, blockedPhrases)) {
    return 'blocked'
  }

  if (thought.length > 420 || tokenize(thought).length > 80) {
    return 'sensitive'
  }

  return 'clear'
}

export const buildMoodSignal = (
  state: string,
  thought: string,
  intent: Intent,
): MoodSignal => {
  const cleanState = state.trim()
  const cleanThought = thought.trim()

  return {
    state: cleanState,
    thought: cleanThought,
    intent,
    language: 'ru',
    ageZone: '18-30',
    topics: inferTopics(cleanState, cleanThought),
    lenses: inferThoughtLenses(cleanState, cleanThought),
    depthScore: calculateDepthScore(cleanState, cleanThought),
    safetyLevel: assessSafety(cleanState, cleanThought),
  }
}

const intentCompatibility = (source: Intent, candidate: Intent) => {
  if (source === candidate) return 22
  if (source === 'support' && candidate === 'vent') return 16
  if (source === 'vent' && candidate === 'support') return 16
  if (source === 'similar' && candidate !== 'distract') return 12
  if (source === 'distract' && candidate === 'distract') return 18
  return 6
}

const scoreCandidate = (signal: MoodSignal, candidate: CheckIn): MatchCandidate => {
  const tokenOverlap = tokenize(signal.thought).filter((token) =>
    candidate.thought.toLocaleLowerCase('ru-RU').includes(token),
  ).length
  const topicOverlap = signal.topics.filter((topic) => candidate.topics.includes(topic))
  const candidateLenses = inferThoughtLenses(candidate.state, candidate.thought)
  const lensOverlap = signal.lenses.filter((lens) => candidateLenses.includes(lens))
  const depthAffinity = Math.max(
    0,
    10 - Math.abs(signal.depthScore - calculateDepthScore(candidate.state, candidate.thought)) / 10,
  )
  const freshness = Math.max(0, 16 - candidate.minutesAgo)
  const score =
    topicOverlap.length * 24 +
    lensOverlap.length * 18 +
    tokenOverlap * 3 +
    intentCompatibility(signal.intent, candidate.intent) +
    depthAffinity +
    freshness +
    candidate.user.trustScore / 10

  const reasons = [
    ...lensOverlap.map((lens) => `похожий стиль мысли: ${lens}`),
    ...topicOverlap.map((topic) => `похоже по теме: ${topic}`),
    candidate.intent === signal.intent ? 'совпало намерение' : 'совместимое намерение',
    candidate.minutesAgo <= 10 ? 'человек недавно рядом' : 'подходит по контексту',
  ]

  return {
    ...candidate,
    score: Math.round(score),
    reasons: [...new Set(reasons)].slice(0, 3),
  }
}

export const findMatches = (signal: MoodSignal): MatchCandidate[] => {
  if (signal.safetyLevel === 'blocked' || signal.safetyLevel === 'crisis') {
    return []
  }

  return seedCheckIns
    .map((candidate) => scoreCandidate(signal, candidate))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
}
