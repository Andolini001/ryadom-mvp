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

const palette = ['#d36f52', '#2f7d74', '#6f7d5f', '#8c6a9e', '#bb7d43', '#4c8b85']

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

const formatTime = (value: unknown) => {
  const raw = text(value)
  if (!raw) return 'сейчас'

  return new Date(raw).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

const buildAlias = (userId: string) => `гость ${userId.slice(0, 4)}`

const currentUserProfile = async () => {
  const client = requireClient()
  const { data: sessionData, error: sessionError } = await client.auth.getSession()

  if (sessionError) throw sessionError

  if (sessionData.session?.user) {
    return {
      id: sessionData.session.user.id,
      alias: buildAlias(sessionData.session.user.id),
      hue: palette[sessionData.session.user.id.charCodeAt(0) % palette.length],
    }
  }

  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw error
  if (!data.user) throw new Error('Anonymous sign-in did not return a user')

  return {
    id: data.user.id,
    alias: buildAlias(data.user.id),
    hue: palette[data.user.id.charCodeAt(0) % palette.length],
  }
}

export const ensureProductionSession = currentUserProfile

const mapMember = (raw: RawRecord): User => ({
  id: text(raw.id),
  alias: text(raw.alias, 'гость'),
  hue: text(raw.hue, '#457b74'),
  lastSeen: 'сейчас',
  trustScore: numberValue(raw.trust_score, 80),
})

const mapMessage = (raw: RawRecord): Message => ({
  id: text(raw.id, `m-${Date.now()}`),
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

  const { data, error } = await client.rpc('create_room_for_checkin', {
    p_state: signal.state,
    p_thought: signal.thought,
    p_intent: signal.intent,
    p_topics: signal.topics,
    p_safety_level: signal.safetyLevel,
    p_alias: profile.alias,
    p_hue: profile.hue,
  })

  if (error) throw error

  const result = data as BackendRoomResponse
  if (result.status === 'safety_blocked') {
    return { room: null, candidates: [], safetyBlocked: true }
  }

  const rawRoom = result.room ?? {}
  const room: Room = {
    id: text(rawRoom.id, `room-${Date.now()}`),
    title: text(rawRoom.title, 'Комната: рядом по мысли'),
    timerMinutes: numberValue(rawRoom.timer_minutes, 25),
    members: (result.members ?? []).map(mapMember),
    messages: (result.messages ?? []).map(mapMessage),
  }

  return {
    room,
    candidates: (result.candidates ?? []).map(mapCandidate),
    safetyBlocked: false,
  }
}

export const sendProductionMessage = async (roomId: string, body: string) => {
  const client = requireClient()
  const profile = await currentUserProfile()

  const { data, error } = await client
    .from('messages')
    .insert({
      room_id: roomId,
      user_id: profile.id,
      author_snapshot: 'вы',
      body,
      tone: 'warm',
    })
    .select('id, author_snapshot, body, tone, created_at')
    .single()

  if (error) throw error
  return mapMessage(data as RawRecord)
}

export const subscribeToRoomMessages = (
  roomId: string,
  onMessage: (message: Message) => void,
) => {
  const client = requireClient()
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
  const { error } = await client.from('waitlist_entries').insert({
    user_id: profile.id,
    telegram_handle: telegramHandle,
    source: 'web',
  })
  if (error) throw error
}

export const loadProductionSafetyEvents = async (): Promise<SafetyEvent[]> => {
  const client = requireClient()
  await currentUserProfile()

  const { data, error } = await client
    .from('safety_events')
    .select('id, label, source, status, severity, detail')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw error

  return (data ?? []).map((item) => ({
    id: text(item.id),
    label: text(item.label),
    source: text(item.source),
    status:
      item.status === 'watching' || item.status === 'resolved' ? item.status : 'new',
    severity:
      item.severity === 'high' || item.severity === 'medium' ? item.severity : 'low',
    detail: text(item.detail),
  }))
}
