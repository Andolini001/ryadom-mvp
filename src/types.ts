export type Intent = 'vent' | 'similar' | 'support' | 'distract'

export type SafetyLevel = 'clear' | 'sensitive' | 'blocked' | 'crisis'

export type MoodSignal = {
  state: string
  thought: string
  intent: Intent
  language: 'ru'
  ageZone: '18-30'
  topics: string[]
  lenses: string[]
  depthScore: number
  safetyLevel: SafetyLevel
}

export type User = {
  id: string
  alias: string
  hue: string
  lastSeen: string
  trustScore: number
}

export type CheckIn = {
  id: string
  user: User
  state: string
  thought: string
  intent: Intent
  topics: string[]
  minutesAgo: number
}

export type MatchCandidate = CheckIn & {
  score: number
  reasons: string[]
}

export type Message = {
  id: string
  author: string
  body: string
  time: string
  tone: 'warm' | 'plain' | 'system'
}

export type Room = {
  id: string
  title: string
  timerMinutes: number
  members: User[]
  messages: Message[]
}

export type SafetyEvent = {
  id: string
  label: string
  source: string
  status: 'new' | 'watching' | 'resolved'
  severity: 'low' | 'medium' | 'high'
  detail: string
}

export type Report = {
  id: string
  roomId: string
  reason: string
  createdAt: string
}

export type UserFeedback = {
  moodAfter: 'lighter' | 'same' | 'worse' | null
  note: string
}
