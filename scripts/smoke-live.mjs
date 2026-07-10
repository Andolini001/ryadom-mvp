import { chromium } from 'playwright'

const baseUrl = process.argv[2]

if (!baseUrl) {
  throw new Error('Usage: npm run smoke:live -- <public-url>')
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const browser = await chromium.launch({ headless: true })
const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const pageA = await contextA.newPage()
const pageB = await contextB.newPage()
const runtimeIssues = []

for (const [label, page] of [['A', pageA], ['B', pageB]]) {
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeIssues.push(`${label} console: ${message.text()}`)
  })
  page.on('pageerror', (error) => runtimeIssues.push(`${label} pageerror: ${error.message}`))
}

const marker = Date.now().toString().slice(-7)
const liveMessage = `Проверка живого диалога ${marker}`

const enterLiveRoom = async (page, suffix) => {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-shell')
  await page.waitForFunction(
    () => document.querySelector('.backend-strip strong')?.textContent?.includes('Люди онлайн'),
    null,
    { timeout: 15_000 },
  )

  await page.locator('.checkin-panel input').fill(`кварцовый спутник ${suffix}`)
  await page.locator('.checkin-panel textarea').fill(
    `Редкая мысль становится яснее в разговоре с человеком, который замечает тот же кварцовый спутник ${marker}.`,
  )
  await page.locator('.primary-cta').click()
  await page.waitForSelector('.tab-room .room-console.active-room')

  return (await page.locator('.room-console .overline').first().innerText()).trim()
}

try {
  const roomA = await enterLiveRoom(pageA, 'альфа')
  const roomB = await enterLiveRoom(pageB, 'бета')

  assert(roomA === roomB, `Users landed in different rooms: ${roomA} / ${roomB}`)
  await pageA.waitForFunction(
    () => document.querySelectorAll('.member-strip .member').length >= 2,
    null,
    { timeout: 8_000 },
  )

  await pageB.locator('.message-form input').fill(liveMessage)
  await pageB.getByRole('button', { name: 'Отправить сообщение' }).click()
  await pageA.waitForFunction(
    (expected) => [...document.querySelectorAll('.chat-message p')].some((node) => node.textContent?.includes(expected)),
    liveMessage,
    { timeout: 8_000 },
  )

  const ownMessage = pageB.locator('.chat-message').filter({ hasText: liveMessage })
  const remoteMessage = pageA.locator('.chat-message').filter({ hasText: liveMessage })
  assert((await ownMessage.locator('strong').innerText()).trim() === 'вы', 'Sender should see their own message as "вы".')
  assert((await remoteMessage.locator('strong').innerText()).trim() !== 'вы', 'Receiver should see the sender alias.')
  assert(runtimeIssues.length === 0, `Runtime issues found:\n${runtimeIssues.join('\n')}`)

  console.log(`Live two-user smoke passed: ${baseUrl} (${roomA})`)
} finally {
  await contextA.close()
  await contextB.close()
  await browser.close()
}
