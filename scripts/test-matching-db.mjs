import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migrations = [
  'supabase/migrations/20260705123000_guest_live_backend.sql',
  'supabase/migrations/20260710031935_guest_message_authors.sql',
  'supabase/migrations/20260710082955_enforce_matching_capacity.sql',
]

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const db = new PGlite()

const token = (index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`

const checkIn = async ({ index, state, thought, intent = 'similar', topics }) => {
  const { rows } = await db.query(
    `select public.create_guest_room_for_checkin(
      $1, $2, $3, $4, $5::text[], 'clear', $6, '#4c8b85'
    ) as payload`,
    [token(index), state, thought, intent, topics, `тестер ${index}`],
  )

  return rows[0].payload
}

try {
  await db.exec('create role anon; create role authenticated; create role service_role;')

  for (const migration of migrations) {
    await db.exec(await readFile(migration, 'utf8'))
  }

  await db.exec('set role anon;')

  const future = await checkIn({
    index: 1,
    state: 'выбор будущего',
    thought: 'Думаю о том, как маленькие решения меняют наше будущее и выбранный путь.',
    topics: ['будущее', 'выбор'],
  })
  const football = await checkIn({
    index: 2,
    state: 'вечерний футбол',
    thought: 'Хочу обсудить футбольную тактику, прессинг команды и вчерашний матч.',
    topics: ['футбол', 'спорт'],
  })
  const distract = await checkIn({
    index: 3,
    state: 'отвлечься от будущего',
    thought: 'Хочу отвлечься и не рассуждать о решениях или будущем.',
    intent: 'distract',
    topics: ['будущее', 'выбор'],
  })

  assert(future.room.id !== football.room.id, 'Unrelated thoughts joined the same room.')
  assert(future.room.id !== distract.room.id, 'Incompatible intents joined the same room.')
  assert(football.candidates.length === 0, 'Unrelated signals leaked into candidate results.')

  const compatibleResults = await Promise.all(
    [4, 5, 6, 7].map((index) => checkIn({
      index,
      state: 'решения и путь',
      thought: `Мне интересно, как выбор и решения постепенно формируют будущий путь. Мысль ${index}.`,
      topics: ['будущее', 'выбор'],
    })),
  )
  const compatibleRooms = compatibleResults.map((result) => result.room.id)

  assert(
    compatibleRooms.every((roomId) => roomId === future.room.id),
    'Compatible signals did not fill the same room.',
  )

  await db.query(
    'select public.send_guest_message($1, $2::uuid, $3) as payload',
    [token(4), future.room.id, 'Сообщение с проверяемым автором'],
  )
  const { rows: messageRows } = await db.query(
    `select public.load_guest_messages_since($1, $2::uuid, null) as payload`,
    [token(1), future.room.id],
  )
  const deliveredMessage = messageRows[0].payload.find(
    (message) => message.body === 'Сообщение с проверяемым автором',
  )

  assert(deliveredMessage?.guest_id === token(4), 'A delivered message lost its sender identity.')
  assert(deliveredMessage?.author === 'тестер 4', 'A delivered message exposed the wrong author alias.')

  const overflow = await checkIn({
    index: 8,
    state: 'будущий путь',
    thought: 'Размышляю о выборе, который определит мое будущее и направление движения.',
    topics: ['будущее', 'выбор'],
  })

  assert(overflow.room.id !== future.room.id, 'A sixth participant overfilled the room.')

  let internalRpcDenied = false
  try {
    await db.query('select public.load_guest_safety_events($1)', [token(1)])
  } catch (error) {
    internalRpcDenied = error instanceof Error && error.message.toLowerCase().includes('permission denied')
  }
  assert(internalRpcDenied, 'An obsolete internal RPC is still callable by anon.')

  await db.exec('reset role;')
  const { rows: roomStats } = await db.query(`
    select
      gr.id,
      gr.status,
      count(rm.guest_id)::integer as member_count
    from public.guest_rooms gr
    join public.guest_room_members rm on rm.room_id = gr.id
    group by gr.id, gr.status
    order by member_count desc
  `)
  const originalRoom = roomStats.find((room) => room.id === future.room.id)
  const maxMembers = Math.max(...roomStats.map((room) => room.member_count))

  assert(originalRoom?.member_count === 5, 'The compatible room did not stop at five members.')
  assert(originalRoom?.status === 'closed', 'A full room did not close for new matches.')
  assert(maxMembers <= 5, `Room capacity invariant failed: observed ${maxMembers} members.`)

  console.log(`Database matching passed: ${roomStats.length} rooms, max ${maxMembers} members.`)
} finally {
  await db.close()
}
