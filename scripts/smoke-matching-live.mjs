import { chromium } from 'playwright'

const baseUrl = process.argv[2]

if (!baseUrl) {
  throw new Error('Usage: npm run smoke:matching-live -- <public-url>')
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({ headless: true })
const contexts = []
const runtimeIssues = []
const marker = Date.now().toString().slice(-7)
const sharedState = `орбита${marker} туман${marker}`
const unrelatedState = `ритм${marker} камень${marker}`

const enterRoom = async ({ state, thought, label }) => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 820 } })
  contexts.push(context)
  const page = await context.newPage()

  page.on('console', (message) => {
    if (message.type() === 'error') runtimeIssues.push(`${label} console: ${message.text()}`)
  })
  page.on('pageerror', (error) => runtimeIssues.push(`${label} pageerror: ${error.message}`))

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => document.querySelector('.backend-strip strong')?.textContent?.includes('Люди онлайн'),
    null,
    { timeout: 15_000 },
  )
  await page.locator('.checkin-panel input').fill(state)
  await page.locator('.checkin-panel textarea').fill(thought)
  await page.locator('.primary-cta').click()
  await page.waitForSelector('.tab-room .room-console')

  return {
    code: (await page.locator('.room-console .overline').innerText()).trim(),
    title: (await page.locator('.room-state strong').innerText()).trim(),
    members: await page.locator('.member-strip .member').count(),
  }
}

try {
  const first = await enterRoom({
    state: sharedState,
    thought: `Сочетание орбита${marker} и туман${marker} образует необычный узор, который хочется внимательно разобрать.`,
    label: 'first',
  })
  const unrelated = await enterRoom({
    state: unrelatedState,
    thought: `Связка ритм${marker} и камень${marker} вызывает спор, полезно проверить аргументы по отдельности.`,
    label: 'unrelated',
  })

  assert(first.code !== unrelated.code, `Unrelated signals joined ${first.code}.`)
  assert(first.title !== unrelated.title, 'Unrelated signals inherited the same room title.')

  const compatibleRooms = []
  for (let index = 0; index < 4; index += 1) {
    compatibleRooms.push(await enterRoom({
      state: sharedState,
      thought: `Маркеры орбита${marker} и туман${marker} складываются в общий вопрос. Проверка ${index + 1}.`,
      label: `compatible-${index + 1}`,
    }))
  }

  assert(
    compatibleRooms.every((room) => room.code === first.code),
    `Compatible signals split across rooms: ${[first, ...compatibleRooms].map((room) => room.code).join(', ')}.`,
  )

  const overflow = await enterRoom({
    state: sharedState,
    thought: `Хочу продолжить тему орбита${marker} и туман${marker}, но эта сессия уже должна быть заполнена.`,
    label: 'overflow',
  })

  assert(overflow.code !== first.code, `A sixth participant overfilled ${first.code}.`)
  assert(overflow.members === 1, `Overflow room should start with one member, got ${overflow.members}.`)
  assert(runtimeIssues.length === 0, `Runtime issues found:\n${runtimeIssues.join('\n')}`)

  console.log(`Live matching invariants passed: ${first.code} capped at 5; overflow ${overflow.code}.`)
} finally {
  await Promise.all(contexts.map((context) => context.close()))
  await browser.close()
}
