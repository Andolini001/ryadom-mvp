import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const configuredPort = process.env.SMOKE_UI_PORT
  ? Number.parseInt(process.env.SMOKE_UI_PORT, 10)
  : null
const smokePath = process.env.SMOKE_UI_PATH ?? '/'
const explicitUrl = process.argv[2]
let baseUrl = explicitUrl ?? ''
let previewProcess = null

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const waitForHttp = async (url, timeoutMs = 30_000) => {
  const startedAt = Date.now()
  let lastError = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await sleep(250)
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`)
}

const findFreePort = async () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const selectedPort = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (selectedPort) {
          resolve(selectedPort)
        } else {
          reject(new Error('Could not select a free preview port.'))
        }
      })
    })
  })

const startPreview = (port) => {
  const viteBin = resolve(scriptDir, '..', 'node_modules', 'vite', 'bin', 'vite.js')
  const baseArgs = smokePath === '/' ? [] : [`--base=${smokePath}`]
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', ...baseArgs],
    {
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  return child
}

const visibleText = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim()

const checkNoHorizontalOverflow = async (page, label) => {
  const overflow = await page.evaluate(() => {
    const viewport = window.innerWidth
    const scrollWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth)
    const offenders = [...document.body.querySelectorAll('*')]
      .map((element) => {
        const style = window.getComputedStyle(element)
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number.parseFloat(style.opacity) === 0
        ) {
          return null
        }

        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        }
      })
      .filter((item) => item && item.width > 0 && (item.left < -2 || item.right > viewport + 2))
      .filter((item) => !item.className.includes('world-backdrop'))
      .slice(0, 5)

    return { viewport, scrollWidth, offenders }
  })

  assert(
    overflow.scrollWidth <= overflow.viewport + 2,
    `${label} has horizontal overflow: ${JSON.stringify(overflow)}`,
  )
  assert(
    overflow.offenders.length === 0,
    `${label} has clipped visible elements: ${JSON.stringify(overflow)}`,
  )
}

const checkNoMobileNavOverlap = async (page) => {
  const overlap = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-nav')
    if (!(nav instanceof HTMLElement)) return []

    const navRect = nav.getBoundingClientRect()
    return [...document.querySelectorAll('.tab-home .intent, .tab-home .spark-deck-head, .tab-home .spark-card, .tab-home .safety-note, .tab-home .primary-cta')]
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const intersects =
          rect.bottom > navRect.top + 2 &&
          rect.top < navRect.bottom - 2 &&
          rect.right > navRect.left + 2 &&
          rect.left < navRect.right - 2

        return intersects
          ? {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className : '',
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              navTop: Math.round(navRect.top),
              navBottom: Math.round(navRect.bottom),
            }
          : null
      })
      .filter(Boolean)
  })

  assert(overlap.length === 0, `Mobile nav overlaps important home controls: ${JSON.stringify(overlap)}`)
}

const checkNoMobileRoomControlOverlap = async (page) => {
  const overlap = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-nav')
    const controls = [...document.querySelectorAll('.message-form, .round-action-row button')]
    if (!(nav instanceof HTMLElement)) return []

    const navRect = nav.getBoundingClientRect()
    return controls.map((control) => {
      const controlRect = control.getBoundingClientRect()
      const intersects =
        controlRect.bottom > navRect.top + 2 &&
        controlRect.top < navRect.bottom - 2 &&
        controlRect.right > navRect.left + 2 &&
        controlRect.left < navRect.right - 2

      return intersects
        ? {
            className: control.className,
            controlTop: Math.round(controlRect.top),
            controlBottom: Math.round(controlRect.bottom),
            navTop: Math.round(navRect.top),
            navBottom: Math.round(navRect.bottom),
          }
        : null
    }).filter(Boolean)
  })

  assert(overlap.length === 0, `Mobile nav overlaps room controls: ${JSON.stringify(overlap)}`)
}

const checkSignalCardLayout = async (page, label) => {
  const cards = await page.evaluate(() => [...document.querySelectorAll('.signal-node')].map((card) => {
    const avatar = card.querySelector('b')?.getBoundingClientRect()
    const title = card.querySelector('em')?.getBoundingClientRect()
    const detail = card.querySelector('.signal-node-detail')?.getBoundingClientRect()
    const action = card.querySelector('.signal-node-action')?.getBoundingClientRect()
    const style = window.getComputedStyle(card)

    return {
      display: style.display,
      gridTemplateAreas: style.gridTemplateAreas,
      separated:
        avatar && title && detail && action
          ? title.left >= avatar.right + 4 && detail.top >= title.bottom && action.top >= detail.bottom
          : false,
    }
  }))

  assert(cards.length > 0, `${label} has no signal cards to inspect.`)
  assert(
    cards.every((card) => card.display === 'grid' && card.gridTemplateAreas !== 'none' && card.separated),
    `${label} signal card content overlaps: ${JSON.stringify(cards)}`,
  )
}

const runSmoke = async () => {
  if (!explicitUrl) {
    const port = configuredPort ?? (await findFreePort())
    baseUrl = new URL(smokePath, `http://127.0.0.1:${port}`).href
    previewProcess = startPreview(port)
    await waitForHttp(baseUrl)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } })
  const runtimeIssues = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeIssues.push(`console: ${message.text()}`)
    }
  })

  page.on('pageerror', (error) => {
    runtimeIssues.push(`pageerror: ${error.message}`)
  })

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.app-shell')

    assert(await page.locator('.app-shell.tab-home').count() === 1, 'Expected the home tab to be active.')
    assert(await page.locator('.tab-home .signal-world').count() === 0, 'Signal map leaked onto home tab.')

    const backendLabel = await visibleText(page.locator('.backend-strip strong'))
    const isLiveBackend = backendLabel === 'Люди онлайн'

    const homeTitle = await visibleText(page.locator('.stage-copy h1'))
    assert(
      homeTitle === 'Найди человека, который думает похоже',
      `Unexpected home title: "${homeTitle}".`,
    )
    assert(
      await page.locator('.tab-home .primary-cta:visible').count() === 1,
      'Home should have one visible primary action.',
    )
    assert(
      await page.locator('.tab-home .level-card:visible, .tab-home .resonance-profile:visible, .tab-home .mission-card:visible').count() === 0,
      'Legacy dashboard clutter leaked onto the first-use screen.',
    )

    const homeFont = await page.locator('.stage-copy h1').evaluate((element) => {
      const style = window.getComputedStyle(element)
      return {
        family: style.fontFamily,
        weight: style.fontWeight,
        letterSpacing: style.letterSpacing,
      }
    })
    assert(!homeFont.family.toLowerCase().includes('times'), `Home title uses a fallback font: ${homeFont.family}`)
    assert(Number.parseInt(homeFont.weight, 10) >= 650, `Home title weight looks too weak: ${homeFont.weight}`)
    assert(
      homeFont.letterSpacing === '0px' || homeFont.letterSpacing === 'normal',
      `Home title letter spacing drifted: ${homeFont.letterSpacing}`,
    )

    await page.getByRole('button', { name: 'Совпадения' }).click()
    assert(await page.locator('.tab-signals .match-radar:visible').count() === 0, 'Old radar widget should stay hidden on signals tab.')
    assert(await page.locator('.tab-signals .signal-hub:visible').count() === 0, 'Old central signal hub should stay hidden.')

    if (isLiveBackend) {
      await page.waitForSelector('.tab-signals .live-signal-state')
      assert(await page.locator('.tab-signals .signal-node').count() === 0, 'Live mode must not present demo people as real signals.')
      assert(
        (await visibleText(page.locator('.live-signal-state strong'))) === 'Сначала расскажи, о чем думаешь',
        'Live signals tab should explain the real first step.',
      )
      await page.getByRole('button', { name: 'Создать сигнал' }).click()
      await page.getByRole('button', { name: 'Найти собеседника' }).click()
    } else {
      await page.waitForSelector('.tab-signals .signal-node')
      assert(await page.locator('.tab-signals .signal-node').count() >= 3, 'Demo mode should show at least three readable practice signals.')
      await checkSignalCardLayout(page, 'Desktop demo')
      await page.locator('.tab-signals .signal-node').first().click()
    }

    await page.waitForSelector('.tab-room .room-console')

    const roomTitle = await visibleText(page.locator('.room-console h2').first())
    assert(roomTitle !== 'Комната пока пуста', `Expected active room, got "${roomTitle}".`)

    const roomLayout = await page.evaluate(() => {
      const grid = document.querySelector('.tab-room .hero-grid')
      const room = document.querySelector('.tab-room .room-console')
      if (!(grid instanceof HTMLElement) || !(room instanceof HTMLElement)) return null
      return {
        gridWidth: Math.round(grid.getBoundingClientRect().width),
        roomWidth: Math.round(room.getBoundingClientRect().width),
      }
    })
    assert(roomLayout, 'Room layout could not be measured.')
    assert(
      roomLayout.roomWidth >= roomLayout.gridWidth * 0.9,
      `Desktop room should use the available width: ${JSON.stringify(roomLayout)}`,
    )

    assert(
      await page.locator('.room-pulse-card:visible, .round-strip:visible').count() === 2,
      'Room should expose the compact game route and pulse.',
    )
    const roomGameLayout = await page.evaluate(() => {
      const pulse = document.querySelector('.room-pulse-card')
      const chat = document.querySelector('.chat-window')
      const strip = document.querySelector('.round-strip')
      if (!(pulse instanceof HTMLElement) || !(chat instanceof HTMLElement) || !(strip instanceof HTMLElement)) return null
      const pulseBox = pulse.getBoundingClientRect()
      const chatBox = chat.getBoundingClientRect()
      const stripBox = strip.getBoundingClientRect()
      return {
        pulseBottom: Math.round(pulseBox.bottom),
        chatTop: Math.round(chatBox.top),
        stripBottom: Math.round(stripBox.bottom),
        pulseTop: Math.round(pulseBox.top),
      }
    })
    assert(roomGameLayout, 'Room game route could not be measured.')
    assert(
      roomGameLayout.stripBottom <= roomGameLayout.pulseTop && roomGameLayout.pulseBottom <= roomGameLayout.chatTop,
      `Room game route overlaps the chat: ${JSON.stringify(roomGameLayout)}`,
    )
    assert(
      await page.locator('.chat-window:visible, .message-form:visible').count() === 2,
      'Room should keep the chat and composer visible.',
    )

    if (isLiveBackend) {
      assert(await page.locator('.resonance-journey:visible').count() === 1, 'Live room should expose the shared journey.')
      await page.locator('.side-nav button').filter({ hasText: 'Атлас' }).click()
    } else {
      await page.locator('.message-form input').fill('Мне важно понять, где наши мысли действительно совпадают.')
      await page.getByRole('button', { name: 'Отправить сообщение' }).click()
      await page.waitForTimeout(1_050)
      await page.waitForSelector('.mirror-card.unlocked:visible')

      const mirrorLabel = await visibleText(page.locator('.journey-head strong'))
      assert(mirrorLabel === 'Зеркало открылось', `Expected mirror, got "${mirrorLabel}".`)

      await page.locator('.message-form input').fill('Кажется, эта общая тема звучит у нас по-разному, но ведет к одному вопросу.')
      await page.getByRole('button', { name: 'Отправить сообщение' }).click()
      await page.waitForTimeout(1_050)
      await page.waitForSelector('.resonance-journey.trace-ready:visible')

      const traceLabel = await visibleText(page.locator('.journey-head strong'))
      assert(traceLabel === 'След готов', `Expected trace, got "${traceLabel}".`)

      await page.getByRole('button', { name: 'Сохранить в Атлас' }).click()
      await page.waitForFunction(() => document.body.textContent?.includes('След сохранен'))
      await page.getByRole('button', { name: 'Открыть Атлас' }).click()
    }

    await page.waitForSelector('.app-shell.tab-missions')
    assert(await page.locator('.atlas-trace').count() === (isLiveBackend ? 0 : 1), 'Atlas trace count is unexpected.')
    assert(await page.locator('.waitlist-band').count() === 0, 'Obsolete waitlist should not appear in the live product.')
    await checkNoHorizontalOverflow(page, 'Desktop atlas')

    await page.locator('.side-nav button').filter({ hasText: 'Защита' }).click()
    await page.waitForSelector('.app-shell.tab-safety')
    assert(await page.getByText('Общайся спокойно').count() === 1, 'Safety tab should be user-facing.')
    assert(await page.getByText('Модерация').count() === 0, 'Internal moderation queue leaked into the user UI.')
    await checkNoHorizontalOverflow(page, 'Desktop safety')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.app-shell')
    await page.evaluate(() => window.scrollTo(0, 0))
    assert(await page.locator('.tab-home .signal-world').count() === 0, 'Signal map leaked onto mobile home tab.')
    await checkNoHorizontalOverflow(page, 'Mobile')
    await checkNoMobileNavOverlap(page)

    await page.getByRole('button', { name: 'Совпадения' }).click()
    if (isLiveBackend) {
      await page.waitForSelector('.tab-signals .live-signal-state')
      await checkNoHorizontalOverflow(page, 'Mobile live signals')
    } else {
      await page.waitForSelector('.tab-signals .signal-node')
      await checkSignalCardLayout(page, 'Mobile demo')
      await page.locator('.tab-signals .signal-node').first().click()
      await page.waitForSelector('.tab-room .room-console')
      await page.evaluate(() => window.scrollTo(0, 0))
      await checkNoHorizontalOverflow(page, 'Mobile room')
      await checkNoMobileRoomControlOverlap(page)
    }

    await page.locator('.mobile-nav button').filter({ hasText: 'Атлас' }).click()
    await page.waitForSelector('.app-shell.tab-missions')
    await checkNoHorizontalOverflow(page, 'Mobile atlas')

    await page.locator('.mobile-nav button').filter({ hasText: 'Защита' }).click()
    await page.waitForSelector('.app-shell.tab-safety')
    await checkNoHorizontalOverflow(page, 'Mobile safety')

    assert(runtimeIssues.length === 0, `Runtime issues found:\n${runtimeIssues.join('\n')}`)
  } finally {
    await browser.close()
  }

  console.log(`UI smoke passed: ${baseUrl}`)
}

try {
  await runSmoke()
} finally {
  if (previewProcess) {
    previewProcess.kill()
  }
}
