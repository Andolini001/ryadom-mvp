import {
  AlertTriangle,
  Ban,
  Bell,
  Clock3,
  HeartHandshake,
  Lock,
  MessageCircle,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import './App.css'
import {
  initialRoom,
  initialSafetyEvents,
  intentDescriptions,
  intentLabels,
} from './data'
import { buildMoodSignal, findMatches } from './matching'
import type { FormEvent } from 'react'
import type {
  Intent,
  Message,
  Report,
  Room,
  SafetyEvent,
  SafetyLevel,
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
  hue: '#11100f',
  lastSeen: 'сейчас',
  trustScore: 100,
}

const defaultThought =
  'Вроде все нормально, но я устал держаться бодро. Хочу поговорить с теми, кто сейчас примерно там же.'

const safetyLevelLabels: Record<SafetyLevel, string> = {
  clear: 'низкий',
  sensitive: 'чувствительно',
  blocked: 'стоп',
  crisis: 'кризис',
}

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

  const signal = useMemo(
    () => buildMoodSignal(stateText, thought, intent),
    [stateText, thought, intent],
  )
  const matches = useMemo(() => findMatches(signal), [signal])
  const wordCount = stateText.trim().split(/\s+/).filter(Boolean).length
  const canMatch =
    wordCount >= 1 &&
    wordCount <= 3 &&
    thought.trim().length >= 18 &&
    signal.safetyLevel !== 'blocked' &&
    signal.safetyLevel !== 'crisis'

  const safetyCopy = {
    clear: 'Можно матчить: язык RU, 18-30, риск низкий, исходный текст хранится минимально.',
    sensitive: 'Чек-ин длинный или чувствительный. MVP просит сократить мысль до сути перед матчингом.',
    blocked: 'Рядом не для дейтинга, сексуального поиска или контакта с несовершеннолетними.',
    crisis:
      'Этот чек-ин не отправляется в обычный чат. Если есть риск прямо сейчас, обратись в местную экстренную службу или к человеку рядом.',
  }[signal.safetyLevel]

  const handleMatch = () => {
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

    setRoom(buildRoom(signal.state, matches))
    setHasMatched(true)
  }

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!message.trim()) return

    const nextMessage: Message = {
      id: `m-${Date.now()}`,
      author: 'вы',
      body: message.trim(),
      time: 'сейчас',
      tone: 'warm',
    }

    setRoom((current) => ({
      ...current,
      messages: [...current.messages, nextMessage],
    }))
    setMessage('')
  }

  const addReport = (reason: string) => {
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

  const joinWaitlist = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanHandle = telegramHandle.trim().replace(/^@/, '')

    if (!cleanHandle) {
      setWaitlistStatus('Добавь Telegram-ник, чтобы попасть в первую волну.')
      return
    }

    setWaitlistStatus(`@${cleanHandle} добавлен в демо-очередь. Для MVP это уйдет в Telegram/CRM.`)
  }

  return (
    <main className="app-shell">
      <header className="topbar" aria-label="Главная навигация">
        <a className="brand" href="#check-in" aria-label="Рядом">
          <span className="brand-mark">Р</span>
          <span>Рядом</span>
        </a>
        <nav className="topnav">
          <a href="#room">Комната</a>
          <a href="#safety">Защита</a>
          <a href="#launch">Запуск</a>
        </nav>
        <a className="top-action" href="#waitlist">
          <Bell size={17} aria-hidden="true" />
          Ранний доступ
        </a>
      </header>

      <section className="product-grid" id="check-in">
        <div className="checkin-panel">
          <div className="section-title">
            <div>
              <p className="overline">18+ · анонимно · не терапия</p>
              <h1>Что сейчас внутри?</h1>
            </div>
            <ShieldCheck size={28} aria-hidden="true" />
          </div>

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
            <span>Мысль, которую хочется положить рядом</span>
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

          <div className={`safety-note ${signal.safetyLevel}`}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{safetyCopy}</span>
          </div>

          <button className="primary-cta" type="button" onClick={handleMatch} disabled={!canMatch}>
            <Radio size={19} aria-hidden="true" />
            Найти своих
          </button>
        </div>

        <aside className="match-panel" aria-label="Подбор комнаты">
          <div className="panel-heading">
            <div>
              <p className="overline">подбор сейчас</p>
              <h2>{hasMatched ? 'Комната готова' : 'Кандидаты рядом'}</h2>
            </div>
            <span className="match-speed">&lt; 90 сек</span>
          </div>

          <div className="signal-map">
            <div>
              <span>язык</span>
              <strong>RU</strong>
            </div>
            <div>
              <span>возраст</span>
              <strong>18-30</strong>
            </div>
            <div>
              <span>темы</span>
              <strong>{signal.topics.length || 'ищем'}</strong>
            </div>
            <div>
              <span>риск</span>
              <strong>{safetyLevelLabels[signal.safetyLevel]}</strong>
            </div>
          </div>

          <div className="topic-row">
            {(signal.topics.length ? signal.topics : ['усталость', 'тишина', 'поддержка']).map(
              (topic) => (
                <span key={topic}>{topic}</span>
              ),
            )}
          </div>

          <div className="match-list">
            {matches.length ? (
              matches.map((match) => (
                <article className="match-row" key={match.id}>
                  <span className="avatar" style={{ background: match.user.hue }}>
                    {match.user.alias.slice(0, 1).toLocaleUpperCase('ru-RU')}
                  </span>
                  <div>
                    <div className="row-title">
                      <strong>{match.user.alias}</strong>
                      <span>{match.score}%</span>
                    </div>
                    <p>{match.state}</p>
                    <small>{match.reasons.join(' · ')}</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Ban size={22} aria-hidden="true" />
                <p>Матчинг остановлен до проверки сигнала защиты.</p>
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="room-band" id="room">
        <div className="room-shell">
          <div className="room-main">
            <div className="panel-heading">
              <div>
                <p className="overline">малая комната · 3-5 человек</p>
                <h2>{room.title}</h2>
              </div>
              <div className="timer">
                <Clock3 size={18} aria-hidden="true" />
                {room.timerMinutes}:00
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
              {room.messages.map((item) => (
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
                placeholder="Написать спокойно, без давления..."
                aria-label="Сообщение в комнату"
              />
              <button type="submit">
                <Send size={17} aria-hidden="true" />
                Отправить
              </button>
            </form>
          </div>

          <aside className="room-tools">
            <div className="tool-block">
              <h3>Быстрая защита</h3>
              <button type="button" onClick={() => addReport('Пожаловаться на сообщение')}>
                <AlertTriangle size={17} aria-hidden="true" />
                Пожаловаться
              </button>
              <button type="button" onClick={() => addReport('Заблокировать участника')}>
                <Ban size={17} aria-hidden="true" />
                Заблокировать
              </button>
              <p>Репорт скрывает участника локально и отправляет событие в очередь.</p>
            </div>

            <div className="tool-block">
              <h3>После комнаты</h3>
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
                      setFeedback((current) => ({
                        ...current,
                        moodAfter: value as UserFeedback['moodAfter'],
                      }))
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
                placeholder="Что улучшить в подборе?"
              />
            </div>
          </aside>
        </div>
      </section>

      <section className="ops-grid" id="safety">
        <div className="ops-panel">
          <div className="panel-heading">
            <div>
              <p className="overline">очередь защиты</p>
              <h2>Очередь модерации</h2>
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
              <p className="overline">проверка спроса</p>
              <h2>Ручной MVP</h2>
            </div>
          </div>
          <div className="metric-grid">
            <div>
              <span>цель</span>
              <strong>1000</strong>
              <p>первых чек-инов</p>
            </div>
            <div>
              <span>активация</span>
              <strong>35%</strong>
              <p>дошли до комнаты</p>
            </div>
            <div>
              <span>качество</span>
              <strong>65%</strong>
              <p>стало легче или интересно</p>
            </div>
            <div>
              <span>риск</span>
              <strong>&lt;3</strong>
              <p>жалобы на 100 чатов</p>
            </div>
          </div>
          <ol className="launch-list">
            <li>Неделя 1: Telegram-очередь и три рекламных угла.</li>
            <li>Неделя 2: ручной подбор комнат и измерение качества.</li>
            <li>Недели 3-8: живой чат, отчеты, панель, PWA.</li>
          </ol>
        </div>
      </section>

      <section className="waitlist-band" id="waitlist">
        <div>
          <p className="overline">старт через Telegram</p>
          <h2>Первая волна без ленты и лайков</h2>
          <p>
            MVP собирает людей через Telegram, проверяет качество матчинга и только потом
            масштабирует комнаты.
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
            <Bell size={17} aria-hidden="true" />
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
    </main>
  )
}

export default App
