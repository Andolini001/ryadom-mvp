import { supabase } from './supabase'
import type {
  MatchCandidate,
  Message,
  MoodSignal,
  Room,
  SafetyEvent,
  User,
  UserFeedback,
} from '../types'

type RawRecord = Record<string, unknown>

type BackendRoomResponse = {
  status: 'room_created' | 'safety_blocked'
  room?: RawRecord
  members?: RawRecord[]
  messages?: RawRecord[]
  candidates?: RawRecord[]
}

type ProductionProfile = {
  id: string
  alias: string
  hue: string
  mode: 'authenticated' | 'guest'
  guestToken?: string
}

const palette = ['#d36f52', '#2f7d74', '#6f7d5f', '#8c6a9e', '#bb7d43', '#4c8b85']
const guestStorageKey = 'ryadom.guest-session.v1'
const preferAnonymousAuth = import.meta.env.VITE_SUPABASE_USE_AUTH === 'true'
let cachedProfile: ProductionProfile | null = null
let anonymousAuthUnavailable = !preferAnonymousAuth

const requireClient = () => {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  return supabase
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const numberValue = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const stringArray = (value: unknown) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
const rawArray = (value: unknown): RawRecord[] =>
  Array.isArray(value) ? value.filter((item): item is RawRecord => Boolean(item) && typeof item === 'object') : []
const newestCreatedAt = (items: RawRecord[], current: string | null) => {
  let next = current
  let nextTime = current ? Date.parse(current) : 0

  items.forEach((item) => {
    const createdAt = text(item.created_at)
    const createdTime = Date.parse(createdAt)

    if (Number.isFinite(createdTime) && createdTime > nextTime) {
      next = createdAt
      nextTime = createdTime
    }
  })

  return next
}

const formatTime = (value: unknown) => {
  const raw = text(value)
  if (!raw) return 'сейчас'

  return new Date(raw).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const buildAlias = (userId: string) => `гость ${userId.slice(0, 4)}`

const makeGuestId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`

const readGuestProfile = (): ProductionProfile => {
  if (cachedProfile?.mode === 'guest') return cachedProfile

  const fallbackId = makeGuestId()
  let id: string = fallbackId

  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(guestStorageKey)
      const parsed = stored ? (JSON.parse(stored) as { id?: unknown }) : null

      if (typeof parsed?.id === 'string') {
        id = parsed.id
      } else {
        window.localStorage.setItem(guestStorageKey, JSON.stringify({ id }))
      }
    } catch {
      id = fallbackId
    }
  }

  cachedProfile = {
    id,
    alias: buildAlias(id),
    hue: palette[id.charCodeAt(0) % palette.length],
    mode: 'guest',
    guestToken: id,
  }

  return cachedProfile
}

const currentUserProfile = async (): Promise<ProductionProfile> => {
  const client = requireClient()

  if (cachedProfile?.mode === 'authenticated') return cachedProfile

  if (!anonymousAuthUnavailable) {
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession()

      if (sessionError) throw sessionError

      if (sessionData.session?.user) {
        cachedProfile = {
          id: sessionData.session.user.id,
          alias: buildAlias(sessionData.session.user.id),
          hue: palette[sessionData.session.user.id.charCodeAt(0) % palette.length],
          mode: 'authenticated',
        }

        return cachedProfile
      }

      const { data, error } = await client.auth.signInAnonymously()
      if (error) throw error
      if (!data.user) throw new Error('Anonymous sign-in did not return a user')

      cachedProfile = {
        id: data.user.id,
        alias: buildAlias(data.user.id),
        hue: palette[data.user.id.charCodeAt(0) % palette.length],
        mode: 'authenticated',
      }

      return cachedProfile
    } catch {
      anonymousAuthUnavailable = true
    }
  }

  return readGuestProfile()
}

export const ensureProductionSession = currentUserProfile

const mapRoomResponse = (result: BackendRoomResponse): {
  room: Room | null
  candidates: MatchCandidate[]
  safetyBlocked: boolean
} => {
  if (result.status === 'safety_blocked') {
    return { room: null, candidates: [], safetyBlocked: true }
  }

  const rawRoom = result.room ?? {}
  const room: Room = {
    id: text(rawRoom.id, `room-${Date.now()}`),
    title: text(rawRoom.title, 'Комната: рядом по мысли'),
    timerMinutes: numberValue(rawRoom.timer_minutes, 25),
    members: rawArray(result.members).map(mapMember),
    messages: rawArray(result.messages).map(mapMessage),
  }

  return {
    room,
    candidates: rawArray(result.candidates).map(mapCandidate),
    safetyBlocked: false,
  }
}

const normalizeGuestRoomResponse = (
  result: ReturnType<typeof mapRoomResponse>,
  viewerId: string,
) => {
  if (!result.room) return result

  const otherMembers = result.room.members.filter((member) => member.id !== viewerId)
  const remoteAlias = otherMembers.length === 1 ? otherMembers[0].alias : 'кто-то рядом'

  return {
    ...result,
    room: {
      ...result.room,
      messages: result.room.messages.map((message) =>
        message.author === 'вы' && message.tone !== 'system'
          ? { ...message, author: remoteAlias, tone: 'plain' as const }
          : message,
      ),
    },
  }
}

const mapSafetyEvents = (items: RawRecord[]): SafetyEvent[] =>
  items.map((item) => ({
    id: text(item.id),
    label: text(item.label),
    source: text(item.source),
    status:
      item.status === 'watching' || item.status === 'resolved' ? item.status : 'new',
    severity:
      item.severity === 'high' || item.severity === 'medium' ? item.severity : 'low',
    detail: text(item.detail),
  }))

const guestToken = (profile: ProductionProfile) => {
  if (!profile.guestToken) {
    throw new Error('Guest token is missing')
  }

  return profile.guestToken
}

const authPayload = (profile: ProductionProfile) => ({
  id: profile.id,
  alias: profile.alias,
  hue: profile.hue,
})

const mapMember = (raw: RawRecord): User => ({
  id: text(raw.id),
  alias: text(raw.alias, 'гость'),
  hue: text(raw.hue, '#457b74'),
  lastSeen: 'сейчас',
  trustScore: numberValue(raw.trust_score, 80),
})

const mapMessage = (raw: RawRecord): Message => ({
  id: text(raw.id, `m-${Date.now()}`),
  authorId: text(raw.guest_id, text(raw.user_id)) || undefined,
  author: text(raw.author, text(raw.author_snapshot, 'рядом')),
  body: text(raw.body),
  time: formatTime(raw.created_at),
  tone: raw.tone === 'warm' || raw.tone === 'system' ? raw.tone : 'plain',
})

const mapCandidate = (raw: RawRecord): MatchCandidate => {
  const user = {
    id: text(raw.user_id),
    alias: text(raw.alias, 'гость'),
    hue: text(raw.hue, '#457b74'),
    lastSeen: `${numberValue(raw.minutes_ago, 0)} мин назад`,
    trustScore: numberValue(raw.trust_score, 80),
  }

  return {
    id: text(raw.check_in_id, `ci-${Date.now()}`),
    user,
    state: text(raw.state),
    thought: text(raw.thought),
    intent:
      raw.intent === 'vent' ||
      raw.intent === 'support' ||
      raw.intent === 'distract' ||
      raw.intent === 'similar'
        ? raw.intent
        : 'similar',
    topics: stringArray(raw.topics),
    minutesAgo: numberValue(raw.minutes_ago, 0),
    score: numberValue(raw.score, 50),
    reasons: stringArray(raw.reasons).slice(0, 3),
  }
}

export const createRoomFromSignal = async (
  signal: MoodSignal,
): Promise<{
  room: Room | null
  candidates: MatchCandidate[]
  safetyBlocked: boolean
}> => {
  const client = requireClient()
  const profile = await currentUserProfile()
  const payload = authPayload(profile)

  if (profile.mode === 'guest') {
    const { data, error } = await client.rpc('create_guest_room_for_checkin', {
      p_guest_token: guestToken(profile),
      p_state: signal.state,
      p_thought: signal.thought,
      p_intent: signal.intent,
      p_topics: signal.topics,
      p_safety_level: signal.safetyLevel,
      p_alias: payload.alias,
      p_hue: payload.hue,
    })

    if (error) throw error
    return normalizeGuestRoomResponse(mapRoomResponse(data as BackendRoomResponse), profile.id)
  }

  const { data, error } = await client.rpc('create_room_for_checkin', {
    p_state: signal.state,
    p_thought: signal.thought,
    p_intent: signal.intent,
    p_topics: signal.topics,
    p_safety_level: signal.safetyLevel,
    p_alias: payload.alias,
    p_hue: payload.hue,
  })

  if (error) throw error
  return mapRoomResponse(data as BackendRoomResponse)
}

export const sendProductionMessage = async (roomId: string, body: string) => {
  const client = requireClient()
  const profile = await currentUserProfile()

  if (profile.mode === 'guest') {
    const { data, error } = await client.rpc('send_guest_message', {
      p_guest_token: guestToken(profile),
      p_room_id: roomId,
      p_body: body,
    })

    if (error) throw error
    return { ...mapMessage(data as RawRecord), author: 'вы', tone: 'warm' as const }
  }

  const { data, error } = await client
    .from('messages')
    .insert({
      room_id: roomId,
      user_id: profile.id,
      author_snapshot: profile.alias,
      body,
      tone: 'warm',
    })
    .select('id, author_snapshot, body, tone, created_at')
    .single()

  if (error) throw error
  return { ...mapMessage(data as RawRecord), author: 'вы', tone: 'warm' as const }
}

export const subscribeToRoomMessages = (
  roomId: string,
  onMessage: (message: Message) => void,
) => {
  const client = requireClient()
  const profile = cachedProfile

  if (profile?.mode === 'guest') {
    let stopped = false
    let inFlight = false
    let lastSeenAt: string | null = null
    let timer: number | null = null

    const scheduleNextPoll = () => {
      if (stopped) return

      const delay = document.hidden ? 2400 : 950
      timer = window.setTimeout(() => void pollMessages(), delay)
    }

    const pollMessages = async () => {
      if (stopped || inFlight) return

      inFlight = true
      try {
        const { data, error } = await client.rpc('load_guest_messages_since', {
          p_guest_token: guestToken(profile),
          p_room_id: roomId,
          p_after: lastSeenAt,
        })

        if (stopped || error) return

        const records = rawArray(data)
        lastSeenAt = newestCreatedAt(records, lastSeenAt)
        records.map(mapMessage).forEach(onMessage)
      } finally {
        inFlight = false
        scheduleNextPoll()
      }
    }

    void pollMessages()
    const pollNowWhenVisible = () => {
      if (document.hidden) return
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      void pollMessages()
    }

    document.addEventListener('visibilitychange', pollNowWhenVisible)

    return () => {
      stopped = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', pollNowWhenVisible)
    }
  }

  const channel = client
    .channel(`room:${roomId}:messages`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => onMessage(mapMessage(payload.new as RawRecord)),
    )
    .subscribe()

  return () => {
    client.removeChannel(channel)
  }
}

export const createProductionReport = async (roomId: string, reason: string) => {
  const client = requireClient()
  const profile = await currentUserProfile()

  if (profile.mode === 'guest') {
    const { error } = await client.rpc('create_guest_report', {
      p_guest_token: guestToken(profile),
      p_room_id: roomId,
      p_reason: reason,
    })

    if (error) throw error
    return
  }

  const { error: reportError } = await client.from('reports').insert({
    room_id: roomId,
    reporter_id: profile.id,
    reason,
  })
  if (reportError) throw reportError

  const { error: eventError } = await client.from('safety_events').insert({
    user_id: profile.id,
    room_id: roomId,
    label: reason,
    source: 'room',
    status: 'new',
    severity: reason.includes('Заблокировать') ? 'medium' : 'low',
    detail: 'Репорт создан пользователем и отправлен в очередь модерации.',
  })
  if (eventError) throw eventError
}

export const saveProductionFeedback = async (
  roomId: string,
  feedback: UserFeedback,
) => {
  if (!feedback.moodAfter && !feedback.note.trim()) return

  const client = requireClient()
  const profile = await currentUserProfile()

  if (profile.mode === 'guest') {
    const { error } = await client.rpc('save_guest_feedback', {
      p_guest_token: guestToken(profile),
      p_room_id: roomId,
      p_mood_after: feedback.moodAfter,
      p_note: feedback.note.trim(),
    })

    if (error) throw error
    return
  }

  const { error } = await client.from('user_feedback').upsert(
    {
      room_id: roomId,
      user_id: profile.id,
      mood_after: feedback.moodAfter,
      note: feedback.note.trim(),
    },
    { onConflict: 'room_id,user_id' },
  )
  if (error) throw error
}

export const joinProductionWaitlist = async (telegramHandle: string) => {
  const client = requireClient()
  const profile = await currentUserProfile()

  if (profile.mode === 'guest') {
    const { error } = await client.rpc('join_guest_waitlist', {
      p_guest_token: guestToken(profile),
      p_telegram_handle: telegramHandle,
    })

    if (error) throw error
    return
  }

  const { error } = await client.from('waitlist_entries').insert({
    user_id: profile.id,
    telegram_handle: telegramHandle,
    source: 'web',
  })
  if (error) throw error
}

export const loadProductionSafetyEvents = async (): Promise<SafetyEvent[]> => {
  const client = requireClient()
  const profile = await currentUserProfile()

  if (profile.mode === 'guest') {
    const { data, error } = await client.rpc('load_guest_safety_events', {
      p_guest_token: guestToken(profile),
    })

    if (error) throw error
    return mapSafetyEvents(rawArray(data))
  }

  const { data, error } = await client
    .from('safety_events')
    .select('id, label, source, status, severity, detail')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw error

  return mapSafetyEvents(rawArray(data))
}
