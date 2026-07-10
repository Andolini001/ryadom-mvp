import {
  AlertTriangle,
  Ban,
  BookOpen,
  CheckCircle2,
  Clock3,
  Flame,
  GitFork,
  HeartHandshake,
  Home,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Radio,
  Rocket,
  Send,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  initialRoom,
  intentLabels,
} from './data'
import {
  createProductionReport,
  createRoomFromSignal,
  ensureProductionSession,
  saveProductionFeedback,
  sendProductionMessage,
  subscribeToRoomMessages,
} from './lib/productionBackend'
import { isSupabaseConfigured } from './lib/supabase'
import { buildMoodSignal, findMatches } from './matching'
import type { FormEvent } from 'react'
import type {
  Intent,
  MatchCandidate,
  Message,
  Report,
  Room,
  UserFeedback,
} from './types'

const intentIcons: Record<Intent, typeof MessageCircle> = {
  vent: MessageCircle,
  similar: UserRoundCheck,
  support: HeartHandshake,
  distract: Sparkles,
}

const anonymousSelf = {
  id: 'u-self',
  alias: 'вы',
  hue: '#68e0c2',
  lastSeen: 'сейчас',
  trustScore: 100,
}

const liveMemberPalette = ['#d36f52', '#2f7d74', '#6f7d5f', '#8c6a9e', '#bb7d43', '#4c8b85']

const memberFromJoinMessage = (message: Message) => {
  if (message.tone !== 'system') return null

  const match = message.body.match(/^(.+?) присоединился к комнате по похожей мысли\.$/)
  const alias = match?.[1]?.trim()
  if (!alias) return null

  const hueIndex = [...alias].reduce((sum, character) => sum + character.charCodeAt(0), 0)

  return {
    id: `joined-${message.id}`,
    alias,
    hue: liveMemberPalette[hueIndex % liveMemberPalette.length],
    lastSeen: 'сейчас',
    trustScore: 80,
  }
}

const defaultThought =
  'Вроде все нормально, но я устал держаться бодро. Хочу поговорить с теми, кто сейчас примерно там же.'

type TabId = 'home' | 'room' | 'signals' | 'missions' | 'safety'
type BackendMode = 'demo' | 'connecting' | 'live' | 'error'

type SavedTrace = {
  id: string
  roomId: string
  roomCode: string
  topic: string
  text: string
  createdAt: string
}

const traceStorageKey = 'ryadom-private-atlas-v1'

const readSavedTraces = (): SavedTrace[] => {
  try {
    const saved = window.localStorage.getItem(traceStorageKey)
    if (!saved) return []

    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) ? (parsed as SavedTrace[]).slice(0, 24) : []
  } catch {
    return []
  }
}

const shortenThought = (value: string, maxLength = 86) => {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}…` : normalized
}

const backendModeLabels: Record<BackendMode, string> = {
  demo: 'Демо-режим',
  connecting: 'Подключение',
  live: 'Люди онлайн',
  error: 'Fallback',
}

const stateWordLimit = 8

const sparkDeck = [
  {
    id: 'meaning',
    rarity: 'редкая',
    xp: 35,
    state: 'ищу смысл в шуме',
    thought:
      'Иногда кажется, что вокруг много движения, но мало настоящего смысла. Хочу поговорить с тем, кто тоже это замечает.',
    intent: 'similar',
  },
  {
    id: 'future',
    rarity: 'искрящаяся',
    xp: 50,
    state: 'думаю о будущем',
    thought:
      'Меня цепляет мысль, что мы строим жизнь из случайных решений. Интересно, можно ли выбирать себя осознаннее.',
    intent: 'support',
  },
  {
    id: 'quiet',
    rarity: 'тихая',
    xp: 25,
    state: 'хочу глубины',
    thought:
      'Не хочется обычного small talk. Хочется разговора, после которого в голове становится чуть просторнее.',
    intent: 'vent',
  },
] satisfies Array<{
  id: string
  rarity: string
  xp: number
  state: string
  thought: string
  intent: Intent
}>

const conversationCards = [
  {
    id: 'hypothesis',
    title: 'собрать гипотезу',
    tone: 'мысль',
    xp: 20,
    body: 'Превращает ощущение в идею для обсуждения.',
    message:
      'Моя гипотеза такая: за этой мыслью прячется не проблема, а важный вопрос. Какой вопрос ты здесь слышишь?',
  },
  {
    id: 'reverse',
    title: 'проверить наоборот',
    tone: 'парадокс',
    xp: 18,
    body: 'Добавляет азарт: а вдруг правда с другой стороны.',
    message:
      'А что если все наоборот: не я застрял в этой мысли, а она показывает, куда мне давно пора посмотреть?',
  },
  {
    id: 'image',
    title: 'найти образ',
    tone: 'метафора',
    xp: 16,
    body: 'Помогает говорить глубоко, но без тяжести.',
    message:
      'Если бы эта мысль была местом, это было бы какое место? Мне кажется, через образ ее легче понять.',
  },
] satisfies Array<{
  id: string
  title: string
  tone: string
  xp: number
  body: string
  message: string
}>

const roomRounds = [
  {
    id: 'spark',
    title: 'Искра',
    xp: 18,
    completeAt: 2,
    cue: 'Поймайте главную мысль без длинного объяснения. Один честный штрих лучше идеального текста.',
    prompt: 'Если коротко, главная мысль у меня сейчас такая: ',
  },
  {
    id: 'mirror',
    title: 'Зеркало',
    xp: 28,
    completeAt: 4,
    cue: 'Найдите, где вы похожи, а где неожиданно отличаетесь. Там обычно начинается настоящий разговор.',
    prompt: 'Я заметил одну похожесть и одно отличие: ',
  },
  {
    id: 'trace',
    title: 'След',
    xp: 42,
    completeAt: 6,
    cue: 'Соберите одну мысль, которую хочется унести из комнаты после разговора.',
    prompt: 'После этого разговора я, кажется, заберу с собой такую мысль: ',
  },
] satisfies Array<{
  id: string
  title: string
  xp: number
  completeAt: number
  cue: string
  prompt: string
}>

const waveInviteTemplates: Record<
  string,
  {
    state: string
    thought: string
    intent: Intent
  }
> = {
  смысл: {
    state: 'ищу смысл в шуме',
    thought:
      'Иногда кажется, что вокруг много движения, но мало настоящего смысла. Хочу найти человека, который тоже это замечает.',
    intent: 'similar',
  },
  будущее: {
    state: 'думаю о будущем',
    thought:
      'Меня цепляет мысль, что будущее собирается из маленьких выборов. Хочу спокойно разложить это с кем-то похожим.',
    intent: 'support',
  },
  глубина: {
    state: 'хочу глубины',
    thought:
      'Не хочется обычного small talk. Хочется разговора, после которого в голове становится чуть просторнее.',
    intent: 'similar',
  },
  выбор: {
    state: 'стою перед выбором',
    thought:
      'Есть ощущение, что решение уже рядом, но его нужно увидеть с другой стороны. Хочу поговорить без давления.',
    intent: 'support',
  },
  парадокс: {
    state: 'вижу противоречие',
    thought:
      'Внутри одновременно две правды, и обе почему-то важные. Интересно разобрать это с человеком, который любит думать глубже.',
    intent: 'similar',
  },
  границы: {
    state: 'ищу свои границы',
    thought:
      'Хочется понять, где я действительно выбираю себя, а где просто подстраиваюсь. Нужен честный разговор без оценок.',
    intent: 'support',
  },
  наблюдение: {
    state: 'есть странная мысль',
    thought:
      'В голове крутится наблюдение, которое сложно объяснить в обычном чате. Хочу найти того, кто тоже умеет замечать такие вещи.',
    intent: 'similar',
  },
}

const buildDemoReply = (body: string, topics: string[]) => {
  const normalized = body.toLocaleLowerCase('ru-RU')

  if (normalized.includes('гипотез') || normalized.includes('вопрос')) {
    return 'Я бы сформулировал вопрос так: что во мне просит внимания, но пока говорит через усталость или шум? Интересно, у тебя похоже или совсем иначе?'
  }

  if (normalized.includes('наоборот') || normalized.includes('другой стороны')) {
    return 'Классный поворот. Если смотреть наоборот, то это не тупик, а сигнал: какая-то часть тебя уже не хочет старого способа жить или думать.'
  }

  if (normalized.includes('местом') || normalized.includes('образ')) {
    return 'Для меня это было бы место поздно вечером, где свет еще горит, но людей почти нет. Не страшно, скорее честно и чуть пусто.'
  }

  if (normalized.includes('настоя') || topics.includes('смысл')) {
    return 'Для меня настоящее там, где после фразы внутри становится чуть тише. Похоже, мы оба сейчас ищем не ответ, а точку опоры.'
  }

  if (normalized.includes('совпад') || normalized.includes('похож')) {
    return 'У меня совпадает не сама ситуация, а ощущение: хочется, чтобы тебя поняли без долгого объяснения контекста.'
  }

  if (normalized.includes('честн') || topics.includes('глубина')) {
    return 'Мой честный факт: я часто понимаю, что чувствую, только когда кто-то рядом не торопит с выводами.'
  }

  if (topics.includes('будущее')) {
    return 'Я тоже думаю, что будущее собирается из маленьких выборов. Иногда легче выбирать, когда кто-то просто держит рядом тишину.'
  }

  return 'Я рядом с этой мыслью. Могу не советовать, а просто попробовать понять, что в ней для тебя самое тяжелое или самое живое.'
}

const navItems = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'room', label: 'Комната', icon: MessageCircle },
  { id: 'signals', label: 'Совпадения', icon: Users },
  { id: 'missions', label: 'Атлас', icon: BookOpen },
  { id: 'safety', label: 'Защита', icon: Shield },
] satisfies Array<{ id: TabId; label: string; icon: typeof Home }>

const buildRoom = (
  state: string,
  matches: ReturnType<typeof findMatches>,
): Room => {
  const members = [anonymousSelf, ...matches.map((match) => match.user)].slice(0, 5)
  const leadMatch = matches[0]

  return {
    id: `room-${Date.now()}`,
    title: `Комната: ${state || 'рядом по мысли'}`,
    timerMinutes: 25,
    members,
    messages: [
      {
        id: 'system-join',
        author: 'рядом',
        body: 'Комната открыта на 25 минут. Здесь слушают, не ставят диагнозы и не давят советами.',
        time: 'сейчас',
        tone: 'system',
      },
      ...(leadMatch
        ? [
            {
              id: 'lead-match',
              author: leadMatch.user.alias,
              body: leadMatch.thought,
              time: `${leadMatch.minutesAgo} мин назад`,
              tone: 'plain' as const,
            },
          ]
        : []),
    ],
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [stateText, setStateText] = useState('тихая усталость')
  const [thought, setThought] = useState(defaultThought)
  const [intent, setIntent] = useState<Intent>('similar')
  const [hasMatched, setHasMatched] = useState(false)
  const [room, setRoom] = useState<Room>(initialRoom)
  const [message, setMessage] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [feedback, setFeedback] = useState<UserFeedback>({ moodAfter: null, note: '' })
  const [inviteStatus, setInviteStatus] = useState('')
  const [waveNotice, setWaveNotice] = useState('')
  const [backendMode, setBackendMode] = useState<BackendMode>(
    isSupabaseConfigured ? 'connecting' : 'demo',
  )
  const [backendNotice, setBackendNotice] = useState(
    isSupabaseConfigured
      ? 'Подключаем анонимную Supabase-сессию.'
      : 'Demo mode: добавь Supabase env, чтобы включить живые комнаты.',
  )
  const [liveMatches, setLiveMatches] = useState<ReturnType<typeof findMatches> | null>(null)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [selfProfileId, setSelfProfileId] = useState<string | null>(null)
  const [isMatching, setIsMatching] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [selectedConversationCardId, setSelectedConversationCardId] = useState<string | null>(null)
  const [selectedTraceIndex, setSelectedTraceIndex] = useState(0)
  const [savedTraces, setSavedTraces] = useState<SavedTrace[]>(readSavedTraces)
  const [typingMember, setTypingMember] = useState<string | null>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const demoReplyTimerRef = useRef<number | null>(null)

  const signal = useMemo(
    () => buildMoodSignal(stateText, thought, intent),
    [stateText, thought, intent],
  )
  const localMatches = useMemo(() => findMatches(signal), [signal])
  const matches = liveMatches ?? localMatches
  const wordCount = stateText.trim().split(/\s+/).filter(Boolean).length
  const canMatch =
    wordCount >= 1 &&
    wordCount <= stateWordLimit &&
    thought.trim().length >= 18 &&
    signal.safetyLevel !== 'blocked' &&
    signal.safetyLevel !== 'crisis'
  const roomCode = room.id.match(/\d+/g)?.join('').slice(-3) || '348'
  const roomMessages = room.messages.slice(-10)
  const meaningfulMessageCount = room.messages.filter((item) => item.tone !== 'system').length
  const roomRoundMessageCount = hasMatched ? meaningfulMessageCount : 0
  const signalNodes = matches.slice(0, 5)
  const radarMatches = matches.slice(0, 3)
  const topMatchScore = radarMatches[0]?.score ?? 34
  const resonanceScore = Math.min(99, Math.max(28, topMatchScore + signal.topics.length * 3))
  const rewardXp = 40 + radarMatches.length * 8 + signal.topics.length * 9
  const radarTopic = signal.topics[0] ?? 'новая мысль'
  const thoughtLenses = signal.lenses.length > 0 ? signal.lenses.slice(0, 3) : ['наблюдение']
  const nextRoundIndex = roomRounds.findIndex((round) => roomRoundMessageCount < round.completeAt)
  const activeRoundIndex = nextRoundIndex === -1 ? roomRounds.length - 1 : nextRoundIndex
  const activeRound = roomRounds[activeRoundIndex]
  const completedRoundCount = roomRounds.filter((round) => roomRoundMessageCount >= round.completeAt).length
  const roundProgress = Math.min(
    100,
    Math.round((roomRoundMessageCount / roomRounds[roomRounds.length - 1].completeAt) * 100),
  )
  const roundMovesLeft = Math.max(0, activeRound.completeAt - roomRoundMessageCount)
  const roundMoveWord =
    roundMovesLeft === 1 ? 'ход' : roundMovesLeft > 1 && roundMovesLeft < 5 ? 'хода' : 'ходов'
  const roundStatusText = hasMatched
    ? completedRoundCount === roomRounds.length
      ? 'цепочка закрыта'
      : `${roundMovesLeft} ${roundMoveWord} до награды`
    : 'откроется после матча'
  const conversationAuthors = new Set(
    room.messages
      .filter((item) => item.tone !== 'system')
      .map((item) => item.authorId ?? item.author),
  )
  const peerMessage = room.messages.find(
    (item) => item.tone !== 'system' && item.author !== 'вы' && item.authorId !== selfProfileId,
  )
  const mirrorUnlocked = hasMatched && meaningfulMessageCount >= 2 && conversationAuthors.size >= 2
  const traceUnlocked = mirrorUnlocked && meaningfulMessageCount >= 4
  const roomComplete = traceUnlocked
  const roomPulse = hasMatched
    ? Math.min(
        100,
        38 + roomRoundMessageCount * 8 + completedRoundCount * 7 + (selectedConversationCardId ? 6 : 0),
      )
    : 12
  const roomCombo = hasMatched
    ? Math.max(1, completedRoundCount + (selectedConversationCardId ? 1 : 0))
    : 0
  const roomPulseLabel = roomComplete
    ? 'мысль собрана'
    : roomPulse >= 76
      ? 'глубокий резонанс'
      : roomPulse >= 56
        ? 'контакт найден'
        : 'разговор набирает ход'
  const roomNextGoal = roomComplete
    ? 'Сохраните след разговора или найдите новую волну.'
    : hasMatched
      ? activeRound.prompt.trim()
      : 'Выберите сигнал, чтобы открыть первую общую мысль.'
  const mirrorCommonality = `Вас объединяет тема «${radarTopic}» и желание ${intentLabels[intent]}.`
  const mirrorDifference = peerMessage
    ? `Ты начал с «${shortenThought(thought)}», а собеседник — с «${shortenThought(peerMessage.body)}». Это одна тема, увиденная с разных сторон.`
    : 'Совпадение уже видно по теме, но для второй стороны Зеркала нужен ответ другого участника.'
  const mirrorQuestion = {
    vent: 'Что тебе хотелось бы наконец сказать без необходимости выглядеть сильнее?',
    similar: 'В какой точке ваши мысли совпадают, даже если обстоятельства разные?',
    support: 'Какая поддержка сейчас действительно поможет, а какая будет лишней?',
    distract: 'Какой неожиданный поворот мог бы сделать эту тему немного легче?',
  }[intent]
  const traceOptions = [
    `Мы вошли с разными историями, но оба искали честный разговор вокруг темы «${radarTopic}».`,
    'Иногда важнее не получить быстрый ответ, а встретить человека, который останется рядом с мыслью.',
    `Разговор показал: тема «${radarTopic}» становится яснее, когда ее не нужно защищать или объяснять идеально.`,
  ]
  const roomInsight = traceOptions[selectedTraceIndex] ?? traceOptions[0]
  const traceIsSaved = savedTraces.some(
    (item) => item.roomId === room.id && item.text === roomInsight,
  )
  const inviteWaveKey = thoughtLenses.find((lens) => lens in waveInviteTemplates) ?? 'наблюдение'
  const inviteWaveLabel = inviteWaveKey === 'наблюдение' ? 'редкая мысль' : inviteWaveKey
  const inviteUrl = useMemo(() => {
    const url = new URL(window.location.href)
    url.hash = ''
    url.search = ''
    url.searchParams.set('wave', inviteWaveKey)
    url.searchParams.set('intent', intent)

    return url.toString()
  }, [intent, inviteWaveKey])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wave = params.get('wave')
    const incomingIntent = params.get('intent')
    const template = wave ? waveInviteTemplates[wave] : null

    if (!template) return

    setStateText(template.state)
    setThought(template.thought)
    setIntent(
      incomingIntent && Object.keys(intentLabels).includes(incomingIntent)
        ? (incomingIntent as Intent)
        : template.intent,
    )
    setWaveNotice(`Ты вошел в волну “${wave}”. Нажми “Найти собеседника”, чтобы попасть к похожим людям.`)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    ensureProductionSession()
      .then((profile) => {
        if (cancelled) return
        setSelfProfileId(profile.id)
        setBackendMode('live')
        setBackendNotice(
          profile.mode === 'guest'
            ? 'Живой backend подключен: гостевой вход без регистрации, комнаты и сообщения сохраняются в Supabase.'
            : 'Живой backend подключен: анонимная сессия, RLS и realtime готовы.',
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBackendMode('error')
        setBackendNotice(
          error instanceof Error
            ? `Supabase недоступен: ${error.message}. Работаем в demo mode.`
            : 'Supabase недоступен. Работаем в demo mode.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (backendMode !== 'live' || !activeRoomId) return

    return subscribeToRoomMessages(activeRoomId, (nextMessage) => {
      setRoom((current) => {
        if (current.id !== activeRoomId) return current
        if (current.messages.some((item) => item.id === nextMessage.id)) return current

        const joinedMember = memberFromJoinMessage(nextMessage)
        const members =
          joinedMember && !current.members.some((member) => member.alias === joinedMember.alias)
            ? [...current.members, joinedMember]
            : current.members
        const otherMembers = members.filter((member) => member.id !== selfProfileId)
        const senderMember = nextMessage.authorId
          ? members.find((member) => member.id === nextMessage.authorId)
          : null
        const visibleMessage =
          nextMessage.author === 'вы' &&
          nextMessage.tone !== 'system' &&
          nextMessage.authorId !== selfProfileId
            ? {
                ...nextMessage,
                author: senderMember?.alias ?? (otherMembers.length === 1 ? otherMembers[0].alias : 'кто-то рядом'),
                tone: 'plain' as const,
              }
            : nextMessage

        return {
          ...current,
          members,
          messages: [...current.messages, visibleMessage],
        }
      })
    })
  }, [activeRoomId, backendMode, selfProfileId])

  useEffect(
    () => () => {
      if (demoReplyTimerRef.current !== null) {
        window.clearTimeout(demoReplyTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(traceStorageKey, JSON.stringify(savedTraces.slice(0, 24)))
    } catch {
      // The room remains usable when private storage is unavailable.
    }
  }, [savedTraces])

  const clearDemoReply = () => {
    if (demoReplyTimerRef.current !== null) {
      window.clearTimeout(demoReplyTimerRef.current)
      demoReplyTimerRef.current = null
    }
    setTypingMember(null)
  }

  const safetyCopy = {
    clear: 'Можно матчить: язык RU, 18-30, риск низкий, исходный текст хранится минимально.',
    sensitive: 'Чек-ин длинный или чувствительный. MVP просит сократить мысль до сути перед матчингом.',
    blocked: 'Рядом не для дейтинга, сексуального поиска или контакта с несовершеннолетними.',
    crisis:
      'Этот чек-ин не отправляется в обычный чат. Если есть риск прямо сейчас, обратись в местную экстренную службу или к человеку рядом.',
  }[signal.safetyLevel]

  const applySpark = (spark: (typeof sparkDeck)[number]) => {
    setStateText(spark.state)
    setThought(spark.thought)
    setIntent(spark.intent)
    setHasMatched(false)
    setIsMatching(false)
    clearDemoReply()
  }

  const handleMatch = async () => {
    if (isMatching) return
    clearDemoReply()

    if (signal.safetyLevel === 'crisis' || signal.safetyLevel === 'blocked') {
      setHasMatched(false)
      setBackendNotice(safetyCopy)
      setActiveTab('safety')
      return
    }

    setIsMatching(true)
    const radarStartedAt = window.performance.now()
    const keepRadarVisible = async () => {
      const remainingMs = 680 - (window.performance.now() - radarStartedAt)

      if (remainingMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingMs))
      }
    }

    if (backendMode === 'live') {
      try {
        const result = await createRoomFromSignal(signal)
        await keepRadarVisible()

        if (result.safetyBlocked) {
          setHasMatched(false)
          setActiveTab('safety')
          setBackendNotice('Чек-ин отправлен в очередь защиты и не попал в обычный матчинг.')
          return
        }

        if (result.room) {
          setRoom(result.room)
          setActiveRoomId(result.room.id)
          setLiveMatches(result.candidates)
          setSelectedConversationCardId(null)
          setSelectedTraceIndex(0)
          setHasMatched(true)
          setActiveTab('room')
          setBackendNotice('Комната создана в Supabase. Сообщения идут через живой backend.')
          return
        }
      } catch (error: unknown) {
        setBackendMode('error')
        setBackendNotice(
          error instanceof Error
            ? `Supabase ошибка: ${error.message}. Переключились на demo mode.`
            : 'Supabase ошибка. Переключились на demo mode.',
        )
      } finally {
        setIsMatching(false)
      }
    }

    const fallbackMatches = localMatches
    await keepRadarVisible()
    setRoom(buildRoom(signal.state, fallbackMatches))
    setActiveRoomId(null)
    setLiveMatches(null)
    setSelectedConversationCardId(null)
    setSelectedTraceIndex(0)
    setHasMatched(true)
    setActiveTab('room')
    setIsMatching(false)
  }

  const openDemoRoom = (match: MatchCandidate) => {
    const focusedMatches = [match, ...matches.filter((item) => item.id !== match.id)].slice(0, 4)
    setRoom(buildRoom(match.state, focusedMatches))
    setActiveRoomId(null)
    setLiveMatches(null)
    setIsMatching(false)
    clearDemoReply()
    setSelectedConversationCardId(null)
    setSelectedTraceIndex(0)
    setHasMatched(true)
    setActiveTab('room')
  }

  const applyConversationCard = (card: (typeof conversationCards)[number]) => {
    setMessage(card.message)
    setSelectedConversationCardId(card.id)
    window.requestAnimationFrame(() => messageInputRef.current?.focus())
  }

  const applyRoundPrompt = () => {
    if (!hasMatched) return

    setMessage(activeRound.prompt)
    setSelectedConversationCardId(null)
    window.requestAnimationFrame(() => messageInputRef.current?.focus())
  }

  const scheduleDemoReply = (body: string) => {
    if (backendMode === 'live' && activeRoomId) return

    const peer = room.members.find((member) => member.id !== anonymousSelf.id)
    if (!peer) return

    clearDemoReply()
    const targetRoomId = room.id
    setTypingMember(peer.alias)

    demoReplyTimerRef.current = window.setTimeout(() => {
      const reply: Message = {
        id: `m-demo-${Date.now()}`,
        author: peer.alias,
        body: buildDemoReply(body, signal.topics),
        time: 'сейчас',
        tone: 'plain',
      }

      setRoom((current) => {
        if (current.id !== targetRoomId) return current

        return {
          ...current,
          messages: [...current.messages, reply],
        }
      })
      setTypingMember(null)
      demoReplyTimerRef.current = null
    }, 900)
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!message.trim() || isSending) return

    const body = message.trim()

    if (backendMode === 'live' && activeRoomId) {
      setIsSending(true)
      try {
        const savedMessage = await sendProductionMessage(activeRoomId, body)
        setRoom((current) => {
          if (current.messages.some((item) => item.id === savedMessage.id)) return current

          return {
            ...current,
            messages: [...current.messages, savedMessage],
          }
        })
        setMessage('')
        setSelectedConversationCardId(null)
        return
      } catch (error: unknown) {
        setBackendNotice(
          error instanceof Error
            ? `Не удалось отправить в Supabase: ${error.message}. Сообщение оставлено локально.`
            : 'Не удалось отправить в Supabase. Сообщение оставлено локально.',
        )
      } finally {
        setIsSending(false)
      }
    }

    const nextMessage: Message = {
      id: `m-${Date.now()}`,
      author: 'вы',
      body,
      time: 'сейчас',
      tone: 'warm',
    }

    setRoom((current) => ({
      ...current,
      messages: [...current.messages, nextMessage],
    }))
    setMessage('')
    setSelectedConversationCardId(null)
    scheduleDemoReply(body)
  }

  const addReport = async (reason: string) => {
    const report: Report = {
      id: `r-${Date.now()}`,
      roomId: room.id,
      reason,
      createdAt: new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }

    setReports((items) => [report, ...items])

    if (backendMode === 'live' && activeRoomId) {
      createProductionReport(activeRoomId, reason)
        .then(() => {
          setBackendNotice('Репорт сохранен в Supabase и отправлен в очередь модерации.')
        })
        .catch((error: unknown) => {
          setBackendNotice(
            error instanceof Error
              ? `Репорт сохранен локально, но Supabase вернул ошибку: ${error.message}`
              : 'Репорт сохранен локально, но Supabase вернул ошибку.',
          )
        })
    }

  }

  const updateFeedback = (nextFeedback: UserFeedback) => {
    setFeedback(nextFeedback)

    if (backendMode !== 'live' || !activeRoomId) return

    saveProductionFeedback(activeRoomId, nextFeedback)
      .then(() => setBackendNotice('Оценка после комнаты сохранена в Supabase.'))
      .catch((error: unknown) => {
        setBackendNotice(
          error instanceof Error
            ? `Оценка осталась локально: ${error.message}`
            : 'Оценка осталась локально из-за ошибки Supabase.',
        )
      })
  }

  const saveRoomTrace = () => {
    if (!traceUnlocked) return

    const trace: SavedTrace = {
      id: `${room.id}-${Date.now()}`,
      roomId: room.id,
      roomCode,
      topic: stateText.trim() || radarTopic,
      text: roomInsight,
      createdAt: new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date()),
    }

    setSavedTraces((items) => [trace, ...items.filter((item) => item.roomId !== room.id)].slice(0, 24))
    setBackendNotice(
      'След сохранен в приватном Атласе на этом устройстве.',
    )
  }

  const shareInvite = async () => {
    const shareText = `Я нашел волну мыслей “${inviteWaveLabel}” в Рядом. Зайди и нажми “Найти собеседника” - возможно, попадем в похожую комнату.`

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Рядом',
          text: shareText,
          url: inviteUrl,
        })
        setInviteStatus('Приглашение отправлено.')
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${shareText}\n${inviteUrl}`)
        setInviteStatus('Ссылка скопирована. Отправь ее другу, чтобы зайти в одну волну.')
        return
      }

      setInviteStatus(`Скопируй вручную: ${inviteUrl}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return

      setInviteStatus(`Скопируй вручную: ${inviteUrl}`)
    }
  }

  return (
    <main className={`app-shell tab-${activeTab}`}>
      <div className="world-backdrop" aria-hidden="true" />

      <aside className="game-rail" aria-label="Игровая навигация">
        <button className="brand" type="button" onClick={() => setActiveTab('home')} aria-label="Рядом">
          <span className="brand-mark">Р</span>
          <span>Рядом</span>
        </button>

        <nav className="side-nav">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <button
                className={activeTab === item.id ? 'active' : ''}
                type="button"
                key={item.id}
                onClick={() => setActiveTab(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <button className="rail-help" type="button" onClick={() => setActiveTab('safety')}>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>Безопасность</strong>
            Анонимно и без давления
          </span>
        </button>
      </aside>

      <section className="game-board">
        <header className="game-topbar">
          <div className={`backend-strip ${backendMode}`} role="status" aria-live="polite">
            <i aria-hidden="true" />
            <strong>{backendMode === 'live' ? 'Люди онлайн' : backendModeLabels[backendMode]}</strong>
            <span>{backendNotice}</span>
          </div>

          <div className="resource-strip" aria-label="Действия">
            <button type="button" onClick={shareInvite} aria-label="Поделиться Рядом" title="Поделиться Рядом">
              <Share2 size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="hero-grid" id="check-in">
          <div className="signal-stage">
            {activeTab === 'home' && (
              <>
            <div className="first-journey" aria-label="Как это работает">
              <span className="active"><b>1</b> Мысль</span>
              <i />
              <span><b>2</b> Совпадение</span>
              <i />
              <span><b>3</b> Разговор</span>
            </div>

            <div className="stage-copy">
              <p className="quest-label">Разговор без профилей и свайпов</p>
              <h1>Найди человека, который думает похоже</h1>
              <p className="stage-subcopy">
                Опиши мысль своими словами. Мы найдем человека с близкой темой и сразу откроем
                анонимный разговор.
              </p>
            </div>

            <div className="checkin-panel">
              {waveNotice && (
                <div className="wave-notice" role="status" aria-live="polite">
                  <Share2 size={18} aria-hidden="true" />
                  <div>
                    <strong>Приглашение принято</strong>
                    <span>{waveNotice}</span>
                  </div>
                </div>
              )}

              <label className="field">
                <span>О чем эта мысль?</span>
                <input
                  value={stateText}
                  maxLength={72}
                  onChange={(event) => setStateText(event.target.value)}
                  placeholder="Например: выбор будущего"
                />
                <small className={wordCount > stateWordLimit ? 'field-error' : ''}>
                  Короткая тема, до {stateWordLimit} слов
                </small>
              </label>

              <label className="field">
                <span>Что именно тебя зацепило?</span>
                <textarea
                  value={thought}
                  maxLength={420}
                  onChange={(event) => setThought(event.target.value)}
                  placeholder="Раскрой мысль так, как рассказал бы близкому человеку..."
                />
                <small>{thought.length}/420</small>
              </label>

              <div className="intent-block">
                <span>Какого разговора ты хочешь?</span>
              <div className="intent-grid" aria-label="Выбор типа разговора">
                {(Object.keys(intentLabels) as Intent[]).map((item) => {
                  const Icon = intentIcons[item]

                  return (
                    <button
                      className={intent === item ? 'intent active' : 'intent'}
                      key={item}
                      type="button"
                      onClick={() => setIntent(item)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{intentLabels[item]}</span>
                    </button>
                  )
                })}
              </div>
              </div>

              <div className="trust-line" aria-label="Принципы сервиса">
                <span><Lock size={14} aria-hidden="true" /> Анонимно</span>
                <span>Без фото</span>
                <span>18+</span>
              </div>

              <button
                className="primary-cta"
                type="button"
                onClick={handleMatch}
                disabled={!canMatch || isMatching}
              >
                <Radio size={19} aria-hidden="true" />
                {isMatching ? 'Ищем совпадение...' : 'Найти собеседника'}
              </button>

              {isMatching && (
                <div className="mobile-search-toast" aria-live="polite">
                  <i />
                  <div>
                    <strong>{resonanceScore} резонанс</strong>
                    <span>{radarTopic} · {radarMatches.length} рядом · +{rewardXp} XP</span>
                  </div>
                  <Sparkles size={17} aria-hidden="true" />
                </div>
              )}

              <details className="spark-deck">
                <summary className="spark-deck-head">
                  <span>
                    <Sparkles size={15} aria-hidden="true" />
                    Не знаешь, с чего начать?
                  </span>
                  <small>Выбери готовую мысль</small>
                </summary>

                <div className="spark-grid">
                  {sparkDeck.map((spark) => (
                    <button
                      className={stateText === spark.state ? 'spark-card selected' : 'spark-card'}
                      key={spark.id}
                      type="button"
                      onClick={() => applySpark(spark)}
                    >
                      <strong>{spark.state}</strong>
                      <small>{intentLabels[spark.intent]}</small>
                    </button>
                  ))}
                </div>
              </details>

              {signal.safetyLevel !== 'clear' && <div className={`safety-note ${signal.safetyLevel}`}>
                <AlertTriangle size={18} aria-hidden="true" />
                <span>{safetyCopy}</span>
              </div>}
            </div>
              </>
            )}

            {activeTab === 'signals' && (
            <div className="signal-world" id="signals" aria-label="Сигналы рядом">
              <div className="signal-world-head">
                <span>
                  <i />
                  {backendMode === 'live'
                    ? liveMatches === null
                      ? 'Совпадения'
                      : `Подходящих людей: ${signalNodes.length}`
                    : `Демо-совпадения: ${signalNodes.length}`}
                </span>
                <small>
                  {backendMode === 'live'
                    ? liveMatches === null
                      ? 'здесь появятся люди с близкой мыслью'
                      : activeRoomId
                        ? 'твоя живая комната уже открыта'
                        : 'совпадения из последнего поиска'
                    : 'тренировочный режим без реальных пользователей'}
                </small>
              </div>

              {backendMode === 'live' && liveMatches === null ? (
                <div className="live-signal-state ready">
                  <span className="live-signal-orb">
                    <Radio size={25} aria-hidden="true" />
                  </span>
                  <div>
                    <span>Только реальные люди</span>
                    <strong>Сначала расскажи, о чем думаешь</strong>
                    <p>Мы покажем только свежие совпадения по теме и намерению. Никаких вымышленных профилей.</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab('home')}>
                    <Rocket size={16} aria-hidden="true" />
                    Создать сигнал
                  </button>
                </div>
              ) : signalNodes.length === 0 ? (
                <div className="live-signal-state waiting">
                  <span className="live-signal-orb">
                    <Users size={25} aria-hidden="true" />
                  </span>
                  <div>
                    <span>Редкая волна</span>
                    <strong>Похожих сигналов пока нет</strong>
                    <p>Твоя комната уже открыта. Можно подождать собеседника или попробовать новую формулировку мысли.</p>
                  </div>
                  <button type="button" onClick={() => setActiveTab(activeRoomId ? 'room' : 'home')}>
                    <Target size={16} aria-hidden="true" />
                    {activeRoomId ? 'Вернуться в комнату' : 'Изменить сигнал'}
                  </button>
                </div>
              ) : (
                <div className="signal-map-art" aria-label="Подходящие сигналы">
                  {signalNodes.map((match, index) => (
                    <button
                      className={`signal-node node-${index}`}
                      key={match.id}
                      type="button"
                      onClick={() => activeRoomId ? setActiveTab('room') : openDemoRoom(match)}
                      style={{
                        borderColor: match.user.hue,
                        boxShadow: `0 0 42px ${match.user.hue}66`,
                      }}
                    >
                      <b style={{ background: match.user.hue }}>
                        {match.user.alias.slice(0, 1).toLocaleUpperCase('ru-RU')}
                      </b>
                      <em>{match.state}</em>
                      <small>{match.score}</small>
                      <span className="signal-node-detail">
                        {match.reasons[0] ?? `${match.minutesAgo} мин назад`}
                      </span>
                      <span className="signal-node-action">
                        {activeRoomId ? 'К своей комнате' : 'Открыть демо'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>

          <aside
            className={`room-console ${hasMatched ? 'active-room' : 'empty-room'}`}
            id="room"
            aria-label="Активная комната"
          >
            <div className="panel-heading">
              <div>
                <p className="overline">Комната #{roomCode}</p>
                <h2>{hasMatched ? room.title.replace(/^Комната:\s*/, '') : 'Комната пока пуста'}</h2>
              </div>
              <span className={`live-pill ${backendMode === 'live' && activeRoomId ? '' : 'demo'}`}>
                {backendMode === 'live' && activeRoomId ? 'Live' : 'Demo'}
              </span>
            </div>

            <div className="room-meta">
              <span>
                <Users size={16} aria-hidden="true" />
                {room.members.length} / 5
              </span>
              <span>
                <Clock3 size={16} aria-hidden="true" />
                {room.timerMinutes}:00
              </span>
            </div>

            <div className="room-board">
              <section className="room-quest-column" aria-label="Маршрут комнаты">

            <div className="room-state">
              <Star size={18} aria-hidden="true" />
              <div>
                <strong>{room.title}</strong>
                <span>{hasMatched ? `${room.members.length} рядом · ${activeRound.title}` : 'сначала создай сигнал'}</span>
              </div>
            </div>

            {!hasMatched && (
              <div className="room-empty-callout">
                <MessageCircle size={28} aria-hidden="true" />
                <div>
                  <strong>Здесь появится твой разговор</strong>
                  <p>Сначала опиши мысль. Когда найдется совпадение, комната откроется автоматически.</p>
                </div>
                <button type="button" onClick={() => setActiveTab('home')}>Создать мысль</button>
              </div>
            )}

            <div className={`round-strip ${hasMatched ? 'active' : 'locked'}`} aria-label="Раунды комнаты">
              <div className="round-strip-head">
                <span>
                  <Flame size={15} aria-hidden="true" />
                  Текущий ход
                </span>
                <strong>{hasMatched ? activeRound.title : 'Раунды откроются после матча'}</strong>
                <em>{roundProgress}%</em>
              </div>

              <p>{hasMatched ? activeRound.cue : 'Найди своих, чтобы открыть короткую цепочку из трех ходов.'}</p>

              <div className="round-progress" aria-hidden="true">
                <i style={{ width: `${roundProgress}%` }} />
              </div>

              <div className="round-track">
                {roomRounds.map((round, index) => {
                  const state =
                    roomRoundMessageCount >= round.completeAt
                      ? 'done'
                      : index === activeRoundIndex
                        ? 'current'
                        : 'locked'

                  return (
                    <span className={`round-step ${state}`} key={round.id}>
                      <i>{index + 1}</i>
                      <b>{round.title}</b>
                      <small>+{round.xp} XP</small>
                    </span>
                  )
                })}
              </div>

              <div className="round-action-row">
                <span>{roundStatusText}</span>
                <button type="button" onClick={applyRoundPrompt} disabled={!hasMatched}>
                  <Target size={15} aria-hidden="true" />
                  Подсказать вопрос
                </button>
              </div>
            </div>

              </section>

              <section className="room-dialogue-column" aria-label="Диалог комнаты">
                <div className={`room-pulse-card ${roomComplete ? 'complete' : ''}`} aria-live="polite">
                  <div
                    className="room-pulse-ring"
                    style={{
                      background: `conic-gradient(var(--mint) ${roomPulse}%, rgba(255, 255, 255, 0.08) ${roomPulse}% 100%)`,
                    }}
                    aria-label={`Пульс комнаты ${roomPulse} процентов`}
                  >
                    <span>{roomPulse}</span>
                    <small>%</small>
                  </div>
                  <div className="room-pulse-copy">
                    <span>
                      <Radio size={14} aria-hidden="true" />
                      Пульс комнаты
                    </span>
                    <strong>{roomPulseLabel}</strong>
                    <p>{roomNextGoal}</p>
                  </div>
                  <div className="room-pulse-stats">
                    <span>
                      серия <b>×{roomCombo}</b>
                    </span>
                    <span>
                      ход <b>{Math.min(roomRoundMessageCount + 1, roomRounds[roomRounds.length - 1].completeAt)}</b>
                    </span>
                  </div>
                </div>

            <div className="member-strip" aria-label="Участники комнаты">
              {room.members.map((member) => (
                <span className="member" key={member.id}>
                  <span className="avatar small" style={{ background: member.hue }}>
                    {member.alias.slice(0, 1).toLocaleUpperCase('ru-RU')}
                  </span>
                  {member.alias}
                </span>
              ))}
            </div>

            <div className="chat-window" aria-live="polite">
              {roomMessages.map((item) => (
                <article className={`chat-message ${item.tone}`} key={item.id}>
                  <div>
                    <strong>{item.author}</strong>
                    <span>{item.time}</span>
                  </div>
                  <p>{item.body}</p>
                </article>
              ))}
              {typingMember && (
                <article className="chat-message typing" aria-label={`${typingMember} печатает`}>
                  <div>
                    <strong>{typingMember}</strong>
                    <span>печатает</span>
                  </div>
                  <p>
                    <i />
                    <i />
                    <i />
                  </p>
                </article>
              )}
            </div>

            <div className="conversation-deck" aria-label="Карточки для начала разговора">
              <div className="conversation-deck-head">
                  <span>
                    <Sparkles size={15} aria-hidden="true" />
                  Не знаешь, что написать?
                  </span>
                <small>выбери мягкое начало</small>
              </div>

              <div className="conversation-card-grid">
                {conversationCards.map((card) => (
                  <button
                    className={selectedConversationCardId === card.id ? 'conversation-card selected' : 'conversation-card'}
                    key={card.id}
                    type="button"
                    onClick={() => applyConversationCard(card)}
                  >
                    <span>{card.tone} · +{card.xp} XP</span>
                    <strong>{card.title}</strong>
                    <small>{card.body}</small>
                  </button>
                ))}
              </div>
            </div>

            <form className="message-form" onSubmit={sendMessage}>
              <input
                ref={messageInputRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Напиши сообщение..."
                aria-label="Сообщение в комнату"
              />
              <button type="submit" disabled={isSending} aria-label="Отправить сообщение" title="Отправить сообщение">
                <Send size={17} aria-hidden="true" />
              </button>
            </form>

              </section>
            </div>

            <div className="room-footer-grid">

            <section
              className={`resonance-journey ${mirrorUnlocked ? 'mirror-ready' : ''} ${traceUnlocked ? 'trace-ready' : ''}`}
              aria-label="Путь разговора"
              aria-live="polite"
            >
              <div className="journey-head">
                <div>
                  <span>Совместное открытие</span>
                  <strong>{traceUnlocked ? 'След готов' : mirrorUnlocked ? 'Зеркало открылось' : 'Зеркало собирается'}</strong>
                </div>
                <div className="journey-steps" aria-label="Этапы разговора">
                  <span className="done"><CheckCircle2 size={14} aria-hidden="true" /> Искра</span>
                  <span className={mirrorUnlocked ? 'done' : ''}><GitFork size={14} aria-hidden="true" /> Зеркало</span>
                  <span className={traceUnlocked ? 'done' : ''}><BookOpen size={14} aria-hidden="true" /> След</span>
                </div>
              </div>

              {!mirrorUnlocked ? (
                <p className="journey-locked-copy">
                  Зеркало появится, когда в разговоре прозвучат мысли хотя бы двух участников.
                </p>
              ) : (
                <div className="mirror-card unlocked">
                  <div>
                    <span>Что совпало</span>
                    <p>{mirrorCommonality}</p>
                  </div>
                  <div>
                    <span>Где вы разные</span>
                    <p>{mirrorDifference}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(mirrorQuestion)
                      window.requestAnimationFrame(() => messageInputRef.current?.focus())
                    }}
                  >
                    <Sparkles size={15} aria-hidden="true" />
                    {mirrorQuestion}
                  </button>
                </div>
              )}

              {traceUnlocked && (
                <div className="trace-builder">
                  <div className="trace-builder-copy">
                    <span>Выбери мысль, которую хочется унести</span>
                    <small>Она сохранится только в твоём приватном Атласе.</small>
                  </div>
                  <div className="trace-options">
                    {traceOptions.map((option, index) => (
                      <button
                        className={selectedTraceIndex === index ? 'selected' : ''}
                        key={option}
                        type="button"
                        onClick={() => setSelectedTraceIndex(index)}
                      >
                        <i>{index + 1}</i>
                        <span>{option}</span>
                      </button>
                    ))}
                  </div>
                  <div className="trace-actions">
                    <button type="button" onClick={saveRoomTrace} disabled={traceIsSaved}>
                      <BookOpen size={16} aria-hidden="true" />
                      {traceIsSaved ? 'След сохранен' : 'Сохранить в Атлас'}
                    </button>
                    <button type="button" onClick={() => setActiveTab('missions')}>
                      Открыть Атлас
                    </button>
                  </div>
                </div>
              )}
            </section>

            <div className="room-actions">
              <button type="button" onClick={shareInvite}>
                <Share2 size={16} aria-hidden="true" />
                Пригласить
              </button>
              <details className="room-safety-menu">
                <summary>
                  <MoreHorizontal size={16} aria-hidden="true" />
                  Еще
                </summary>
                <div>
                  <button type="button" onClick={() => addReport('Пожаловаться на сообщение')}>
                    <AlertTriangle size={16} aria-hidden="true" />
                    Пожаловаться
                  </button>
                  <button type="button" onClick={() => addReport('Заблокировать участника')}>
                    <Ban size={16} aria-hidden="true" />
                    Заблокировать
                  </button>
                </div>
              </details>
            </div>
            {inviteStatus && <small className="invite-status">{inviteStatus}</small>}
            </div>
          </aside>
        </section>

        <section className="ops-grid" id="safety">
          <div className="ops-panel">
            <div className="panel-heading">
              <div>
                <p className="overline">Твоя безопасность</p>
                <h2>Общайся спокойно</h2>
              </div>
              <ShieldCheck size={22} aria-hidden="true" />
            </div>
            <div className="safety-guide">
              <article>
                <Lock size={18} aria-hidden="true" />
                <div>
                  <strong>Минимум личных данных</strong>
                  <p>Фото, настоящее имя и номер телефона не нужны для разговора.</p>
                </div>
              </article>
              <article>
                <Ban size={18} aria-hidden="true" />
                <div>
                  <strong>Контроль в один тап</strong>
                  <p>В комнате всегда доступны блокировка и жалоба на участника.</p>
                </div>
              </article>
              <article>
                <HeartHandshake size={18} aria-hidden="true" />
                <div>
                  <strong>Тяжелые состояния не матчим</strong>
                  <p>Кризисные фразы получают маршрут к срочной помощи, а не случайного собеседника.</p>
                </div>
              </article>
            </div>
            <div className="safety-boundary">
              <span>Рядом — социальный сервис, не терапия и не экстренная помощь.</span>
              <button type="button" onClick={() => setActiveTab('home')}>Вернуться к мысли</button>
            </div>
          </div>

          <div className="ops-panel" id="launch">
            <div className="panel-heading">
              <div>
                <p className="overline">Только для тебя</p>
                <h2>Атлас мыслей</h2>
              </div>
              <BookOpen size={22} aria-hidden="true" />
            </div>

            <p className="atlas-intro">
              Здесь остаются не переписки целиком, а мысли, которые родились между людьми и оказались важными для тебя.
            </p>

            {savedTraces.length === 0 ? (
              <div className="atlas-empty">
                <BookOpen size={24} aria-hidden="true" />
                <div>
                  <strong>Первый след появится после разговора</strong>
                  <p>Дойди до Зеркала, выбери итоговую мысль и сохрани её сюда.</p>
                </div>
                <button type="button" onClick={() => setActiveTab('home')}>Начать разговор</button>
              </div>
            ) : (
              <div className="atlas-grid" aria-label="Сохраненные следы">
                {savedTraces.map((trace) => (
                  <article className="atlas-trace" key={trace.id}>
                    <div>
                      <span>Комната #{trace.roomCode}</span>
                      <time>{trace.createdAt}</time>
                    </div>
                    <strong>{trace.topic}</strong>
                    <p>{trace.text}</p>
                    <button
                      type="button"
                      aria-label={`Удалить след ${trace.topic}`}
                      title="Удалить след"
                      onClick={() => setSavedTraces((items) => items.filter((item) => item.id !== trace.id))}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            )}

            <section className="atlas-feedback">
            <p className="feedback-prompt">Как тебе последний разговор?</p>
            <div className="feedback-row" aria-label="Оценка разговора">
              {[
                ['lighter', 'легче'],
                ['same', 'так же'],
                ['worse', 'хуже'],
              ].map(([value, label]) => (
                <button
                  className={feedback.moodAfter === value ? 'selected' : ''}
                  key={value}
                  type="button"
                  onClick={() =>
                    updateFeedback({
                      ...feedback,
                      moodAfter: value as UserFeedback['moodAfter'],
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            <textarea
              value={feedback.note}
              onChange={(event) =>
                setFeedback((current) => ({ ...current, note: event.target.value }))
              }
              onBlur={() => updateFeedback(feedback)}
              placeholder="Что было полезно или что стоит изменить?"
            />
            </section>
          </div>
        </section>

        {reports.length > 0 && (
          <section className="report-log" aria-label="Журнал репортов">
            <strong>Журнал безопасности:</strong>
            {reports.map((report) => (
              <span key={report.id}>
                {report.createdAt} · {report.reason}
              </span>
            ))}
          </section>
        )}
      </section>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon

          return (
            <button
              className={activeTab === item.id ? 'active' : ''}
              type="button"
              key={item.id}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </main>
  )
}

export default App
