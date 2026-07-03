import {
  AlertTriangle,
  Ban,
  Bell,
  Clock3,
  Flame,
  Gem,
  HeartHandshake,
  Home,
  Lock,
  Map,
  MessageCircle,
  Radio,
  Rocket,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  initialRoom,
  initialSafetyEvents,
  intentDescriptions,
  intentLabels,
} from './data'
import {
  createProductionReport,
  createRoomFromSignal,
  ensureProductionSession,
  joinProductionWaitlist,
  loadProductionSafetyEvents,
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
  SafetyEvent,
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

const defaultThought =
  'Вроде все нормально, но я устал держаться бодро. Хочу поговорить с теми, кто сейчас примерно там же.'

type TabId = 'home' | 'room' | 'signals' | 'missions' | 'safety'
type BackendMode = 'demo' | 'connecting' | 'live' | 'error'

const eventStatusLabels: Record<SafetyEvent['status'], string> = {
  new: 'новое',
  watching: 'в работе',
  resolved: 'решено',
}

const severityLabels: Record<SafetyEvent['severity'], string> = {
  low: 'низкий',
  medium: 'средний',
  high: 'высокий',
}

const backendModeLabels: Record<BackendMode, string> = {
  demo: 'Демо-режим',
  connecting: 'Подключение',
  live: 'Живой backend',
  error: 'Fallback',
}

const navItems = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'room', label: 'Комната', icon: MessageCircle, count: '3' },
  { id: 'signals', label: 'Карта сигналов', icon: Map },
  { id: 'missions', label: 'Миссии', icon: Target, count: '2' },
  { id: 'safety', label: 'Защита', icon: Shield },
] satisfies Array<{ id: TabId; label: string; icon: typeof Home; count?: string }>

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
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>(initialSafetyEvents)
  const [feedback, setFeedback] = useState<UserFeedback>({ moodAfter: null, note: '' })
  const [telegramHandle, setTelegramHandle] = useState('')
  const [waitlistStatus, setWaitlistStatus] = useState('')
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
  const [isMatching, setIsMatching] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const signal = useMemo(
    () => buildMoodSignal(stateText, thought, intent),
    [stateText, thought, intent],
  )
  const localMatches = useMemo(() => findMatches(signal), [signal])
  const matches = liveMatches ?? localMatches
  const wordCount = stateText.trim().split(/\s+/).filter(Boolean).length
  const canMatch =
    wordCount >= 1 &&
    wordCount <= 3 &&
    thought.trim().length >= 18 &&
    signal.safetyLevel !== 'blocked' &&
    signal.safetyLevel !== 'crisis'
  const roomCode = room.id.match(/\d+/g)?.join('').slice(-3) || '348'
  const onlineSignals = 118 + localMatches.length * 7 + reports.length
  const activeRooms = matches.slice(0, 4)
  const roomMessages = room.messages.slice(-4)
  const progressCount = Math.min(5, Math.max(1, room.messages.filter((item) => item.tone !== 'system').length))
  const activeNavLabel = navItems.find((item) => item.id === activeTab)?.label ?? 'Главная'
  const signalNodes = matches.slice(0, 5)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    ensureProductionSession()
      .then(() => loadProductionSafetyEvents())
      .then((events) => {
        if (cancelled) return
        setBackendMode('live')
        setBackendNotice('Живой backend подключен: анонимная сессия, RLS и realtime готовы.')
        if (events.length > 0) {
          setSafetyEvents(events)
        }
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

        return {
          ...current,
          messages: [...current.messages, nextMessage],
        }
      })
    })
  }, [activeRoomId, backendMode])

  const safetyCopy = {
    clear: 'Можно матчить: язык RU, 18-30, риск низкий, исходный текст хранится минимально.',
    sensitive: 'Чек-ин длинный или чувствительный. MVP просит сократить мысль до сути перед матчингом.',
    blocked: 'Рядом не для дейтинга, сексуального поиска или контакта с несовершеннолетними.',
    crisis:
      'Этот чек-ин не отправляется в обычный чат. Если есть риск прямо сейчас, обратись в местную экстренную службу или к человеку рядом.',
  }[signal.safetyLevel]

  const handleMatch = async () => {
    if (isMatching) return

    if (signal.safetyLevel === 'crisis' || signal.safetyLevel === 'blocked') {
      const event: SafetyEvent = {
        id: `s-${Date.now()}`,
        label: signal.safetyLevel === 'crisis' ? 'Кризисный чек-ин' : 'Запрещенный контекст',
        source: 'новый чек-ин',
        status: 'new',
        severity: signal.safetyLevel === 'crisis' ? 'high' : 'medium',
        detail: safetyCopy,
      }
      setSafetyEvents((items) => [event, ...items])
      setHasMatched(false)
      return
    }

    setIsMatching(true)

    if (backendMode === 'live') {
      try {
        const result = await createRoomFromSignal(signal)
        if (result.safetyBlocked) {
          setHasMatched(false)
          setBackendNotice('Чек-ин отправлен в очередь защиты и не попал в обычный матчинг.')
          return
        }

        if (result.room) {
          setRoom(result.room)
          setActiveRoomId(result.room.id)
          setLiveMatches(result.candidates)
          setHasMatched(true)
          setBackendNotice('Комната создана в Supabase. Сообщения идут через realtime.')
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
    setRoom(buildRoom(signal.state, fallbackMatches))
    setActiveRoomId(null)
    setLiveMatches(null)
    setHasMatched(true)
    setIsMatching(false)
  }

  const openDemoRoom = (match: MatchCandidate) => {
    const focusedMatches = [match, ...matches.filter((item) => item.id !== match.id)].slice(0, 4)
    setRoom(buildRoom(match.state, focusedMatches))
    setActiveRoomId(null)
    setLiveMatches(null)
    setHasMatched(true)
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
        .then(() => loadProductionSafetyEvents())
        .then((events) => {
          if (events.length > 0) {
            setSafetyEvents(events)
          }
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

    setSafetyEvents((items) => [
      {
        id: `s-${Date.now()}`,
        label: reason,
        source: room.title,
        status: 'new',
        severity: reason.includes('Заблокировать') ? 'medium' : 'low',
        detail: 'Участник скрыт для комнаты, модератор видит контекст и историю репортов.',
      },
      ...items,
    ])
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

  const joinWaitlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanHandle = telegramHandle.trim().replace(/^@/, '')

    if (!cleanHandle) {
      setWaitlistStatus('Добавь Telegram-ник, чтобы попасть в первую волну.')
      return
    }

    if (backendMode === 'live') {
      try {
        await joinProductionWaitlist(cleanHandle)
        setWaitlistStatus(`@${cleanHandle} сохранен в Supabase waitlist.`)
        setBackendNotice('Waitlist-заявка записана в Supabase.')
        return
      } catch (error: unknown) {
        setWaitlistStatus(
          error instanceof Error
            ? `Supabase не принял заявку: ${error.message}`
            : 'Supabase не принял заявку, оставили локальный статус.',
        )
      }
    }

    setWaitlistStatus(`@${cleanHandle} добавлен в демо-очередь. Для MVP это уйдет в Telegram/CRM.`)
  }

  return (
    <main className={`app-shell tab-${activeTab}`}>
      <div className="world-backdrop" aria-hidden="true" />

      <aside className="game-rail" aria-label="Игровая навигация">
        <button className="brand" type="button" onClick={() => setActiveTab('home')} aria-label="Рядом">
          <span className="brand-mark">Р</span>
          <span>Рядом</span>
        </button>

        <div className="level-card">
          <div>
            <Star size={18} aria-hidden="true" />
            <strong>Lv. 7</strong>
          </div>
          <span>780 / 1200 XP</span>
          <i />
        </div>

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
                {item.count && <em>{item.count}</em>}
              </button>
            )
          })}
        </nav>

        <div className="mission-card">
          <div>
            <strong>Ежедневная миссия</strong>
            <button type="button" aria-label="Скрыть миссию">
              ×
            </button>
          </div>
          <p>Проведи 1 комнату</p>
          <span className="mission-progress">
            <i style={{ width: hasMatched ? '100%' : '18%' }} />
          </span>
          <small>{hasMatched ? '1 / 1' : '0 / 1'} · +60 XP</small>
        </div>

        <div className="streak-card">
          <strong>Серия чек-инов</strong>
          <p>5 дней подряд</p>
          <div>
            {['Пн', 'Вт', 'Ср', 'Чт', 'Сб', 'Вс'].map((day, index) => (
              <span className={index < 5 ? 'done' : ''} key={day}>
                {day}
              </span>
            ))}
          </div>
        </div>

        <button className="rail-help" type="button" onClick={() => setActiveTab('safety')}>
          <ShieldCheck size={24} aria-hidden="true" />
          <span>
            <strong>Ты не один</strong>
            Если сейчас тяжело, мы рядом.
          </span>
        </button>
      </aside>

      <section className="game-board">
        <header className="game-topbar">
          <div className={`backend-strip ${backendMode}`} role="status" aria-live="polite">
            <strong>{backendModeLabels[backendMode]}</strong>
            <span>{backendNotice}</span>
          </div>

          <div className="resource-strip" aria-label="Ресурсы">
            <span>
              <Gem size={16} aria-hidden="true" />
              210
            </span>
            <span>
              <Flame size={16} aria-hidden="true" />
              3
            </span>
            <button type="button" onClick={() => setActiveTab('missions')} aria-label="Ранний доступ">
              <Bell size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="active-tab-title" aria-live="polite">
          <span>Текущая вкладка</span>
          <strong>{activeNavLabel}</strong>
        </div>

        <section className="hero-grid" id="check-in">
          <div className="signal-stage">
            <div className="stage-copy">
              <p className="quest-label">Чек-ин за 30 секунд</p>
              <h1>Что сейчас внутри?</h1>
              <p className="stage-subcopy">
                Напиши короткий сигнал. Карта найдет людей с похожим контекстом и откроет
                спокойную комнату.
              </p>
            </div>

            <div className="checkin-panel">
              <label className="field">
                <span>Состояние в 2 словах</span>
                <input
                  value={stateText}
                  maxLength={32}
                  onChange={(event) => setStateText(event.target.value)}
                  placeholder="например: тихая усталость"
                />
                <small className={wordCount > 3 ? 'field-error' : ''}>
                  {wordCount || 0}/3 слова. Лучше коротко и честно.
                </small>
              </label>

              <label className="field">
                <span>Короткая мысль</span>
                <textarea
                  value={thought}
                  maxLength={420}
                  onChange={(event) => setThought(event.target.value)}
                  placeholder="Опиши, что крутится в голове."
                />
                <small>{thought.length}/420 · исходный текст можно удалить после комнаты.</small>
              </label>

              <div className="intent-grid" aria-label="Выбор намерения">
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
                      <small>{intentDescriptions[item]}</small>
                    </button>
                  )
                })}
              </div>

              <button
                className="primary-cta"
                type="button"
                onClick={handleMatch}
                disabled={!canMatch || isMatching}
              >
                <Radio size={19} aria-hidden="true" />
                {isMatching ? 'Создаем комнату...' : 'Найти своих'}
              </button>

              <div className={`safety-note ${signal.safetyLevel}`}>
                <AlertTriangle size={18} aria-hidden="true" />
                <span>{safetyCopy}</span>
              </div>
            </div>

            <div className="signal-world" id="signals" aria-label="Карта сигналов рядом">
              <div className="signal-world-head">
                <span>
                  <i />
                  Сигналов рядом: {onlineSignals}
                </span>
                <small>обновляется каждые 15 секунд</small>
              </div>

              <div className="signal-map-art" aria-hidden="true">
                {signalNodes.map((match, index) => (
                  <span
                    className={`signal-node node-${index}`}
                    key={match.id}
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
                  </span>
                ))}
              </div>
            </div>
          </div>

          <aside className="room-console" id="room" aria-label="Активная комната">
            <div className="panel-heading">
              <div>
                <p className="overline">Комната #{roomCode}</p>
                <h2>{hasMatched ? 'Комната активна' : 'Комната ждет сигнал'}</h2>
              </div>
              <span className="live-pill">Live</span>
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

            <div className="room-state">
              <Star size={18} aria-hidden="true" />
              <div>
                <strong>{room.title}</strong>
                <span>{hasMatched ? 'сессия открыта' : 'найди своих, чтобы войти'}</span>
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
            </div>

            <form className="message-form" onSubmit={sendMessage}>
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Напиши сообщение..."
                aria-label="Сообщение в комнату"
              />
              <button type="submit" disabled={isSending}>
                <Send size={17} aria-hidden="true" />
              </button>
            </form>

            <div className="room-actions">
              <button type="button" onClick={() => addReport('Пожаловаться на сообщение')}>
                <AlertTriangle size={16} aria-hidden="true" />
                Пожаловаться
              </button>
              <button type="button" onClick={() => addReport('Заблокировать участника')}>
                <Ban size={16} aria-hidden="true" />
                Блок
              </button>
            </div>
          </aside>
        </section>

        <section className="room-strip" aria-label="Активные комнаты">
          <div className="strip-head">
            <h2>Активные комнаты</h2>
            <button type="button" onClick={() => setActiveTab('signals')}>карта сигналов</button>
          </div>

          <div className="room-cards">
            {activeRooms.map((match, index) => (
              <article className={index === 1 || hasMatched ? 'room-card active' : 'room-card'} key={match.id}>
                <span className="avatar" style={{ background: match.user.hue }}>
                  {match.user.alias.slice(0, 1).toLocaleUpperCase('ru-RU')}
                </span>
                <div>
                  <strong>#{117 + index * 104} {match.state}</strong>
                  <p>{match.thought}</p>
                  <small>{Math.min(5, 2 + index)} / 5 · {match.minutesAgo} мин назад</small>
                </div>
                <button type="button" onClick={() => openDemoRoom(match)}>
                  Войти
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="ops-grid" id="safety">
          <div className="ops-panel">
            <div className="panel-heading">
              <div>
                <p className="overline">Очередь защиты</p>
                <h2>Модерация</h2>
              </div>
              <Lock size={20} aria-hidden="true" />
            </div>
            <div className="safety-table">
              {safetyEvents.slice(0, 5).map((event) => (
                <article className="safety-row" key={event.id}>
                  <span className={`severity ${event.severity}`}>
                    {severityLabels[event.severity]}
                  </span>
                  <div>
                    <strong>{event.label}</strong>
                    <p>{event.detail}</p>
                  </div>
                  <span>{eventStatusLabels[event.status]}</span>
                </article>
              ))}
            </div>
          </div>

          <div className="ops-panel" id="launch">
            <div className="panel-heading">
              <div>
                <p className="overline">Сезон запуска</p>
                <h2>Прогресс сегодня</h2>
              </div>
              <Trophy size={22} aria-hidden="true" />
            </div>

            <div className="progress-card">
              <div>
                <strong>{progressCount} / 5 комнат</strong>
                <span>следующая награда: +100 XP</span>
              </div>
              <div className="progress-dots">
                {Array.from({ length: 5 }).map((_, index) => (
                  <i className={index < progressCount ? 'filled' : ''} key={index} />
                ))}
              </div>
            </div>

            <div className="feedback-row">
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
              placeholder="Что улучшить в подборе?"
            />
          </div>
        </section>

        <section className="waitlist-band" id="waitlist">
          <div>
            <p className="overline">Первая волна</p>
            <h2>Игровые комнаты без ленты и лайков</h2>
            <p>
              Подключаем первых пользователей через Telegram, смотрим качество матчей и
              открываем сезон постепенно.
            </p>
          </div>
          <form className="waitlist-form" onSubmit={joinWaitlist}>
            <input
              value={telegramHandle}
              onChange={(event) => setTelegramHandle(event.target.value)}
              placeholder="@username"
              aria-label="Telegram username"
            />
            <button type="submit">
              <Rocket size={17} aria-hidden="true" />
              В ранний доступ
            </button>
            {waitlistStatus && <small>{waitlistStatus}</small>}
          </form>
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
