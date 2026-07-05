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
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        }
      })
      .filter((item) => item.width > 0 && (item.left < -2 || item.right > viewport + 2))
      .slice(0, 5)

    return { viewport, scrollWidth, offenders }
  })

  assert(
    overflow.scrollWidth <= overflow.viewport + 2,
    `${label} has horizontal overflow: ${JSON.stringify(overflow)}`,
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

    const currentTab = await visibleText(page.locator('.active-tab-title strong'))
    assert(currentTab === 'Главная', `Expected home tab, got "${currentTab}".`)
    assert(await page.locator('.tab-home .signal-world').count() === 0, 'Signal map leaked onto home tab.')

    const homeTitle = await visibleText(page.locator('.stage-copy h1'))
    assert(homeTitle === 'Что сейчас внутри?', `Unexpected home title: "${homeTitle}".`)

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

    await page.getByRole('button', { name: 'Сигналы' }).click()
    await page.waitForSelector('.tab-signals .signal-node')
    assert(await page.locator('.tab-signals .signal-node').count() >= 3, 'Signals tab should show at least three readable signal cards.')
    assert(await page.locator('.tab-signals .match-radar:visible').count() === 0, 'Old radar widget should stay hidden on signals tab.')
    assert(await page.locator('.tab-signals .signal-hub:visible').count() === 0, 'Old central signal hub should stay hidden.')

    await page.locator('.tab-signals .signal-node').first().click()
    await page.waitForSelector('.tab-room .room-console')

    const roomTitle = await visibleText(page.locator('.room-console h2').first())
    assert(roomTitle === 'Комната активна', `Expected active room, got "${roomTitle}".`)

    for (let index = 0; index < 3; index += 1) {
      await page.getByRole('button', { name: 'Следующий ход' }).click()
      await page.waitForFunction(() => {
        const input = document.querySelector('.message-form input')
        return input instanceof HTMLInputElement && input.value.trim().length > 0
      })
      await page.getByRole('button', { name: 'Отправить сообщение' }).click()
      await page.waitForTimeout(1_050)
    }

    await page.waitForFunction(() => {
      const progress = document.querySelector('.round-progress i')
      return progress instanceof HTMLElement && Number.parseFloat(progress.style.width) >= 100
    })

    const finalLabel = await visibleText(page.locator('.room-close-head strong'))
    assert(finalLabel === 'Инсайт собран', `Expected completed room summary, got "${finalLabel}".`)

    await page.getByRole('button', { name: 'Сохранить след' }).click()
    await page.waitForFunction(() => document.body.textContent?.includes('След сохранен'))

    await page.getByRole('button', { name: 'Найти еще' }).click()
    await page.waitForFunction(() => document.querySelector('.active-tab-title strong')?.textContent === 'Сигналы')

    await checkNoHorizontalOverflow(page, 'Desktop')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.app-shell')
    assert(await page.locator('.tab-home .signal-world').count() === 0, 'Signal map leaked onto mobile home tab.')
    await checkNoHorizontalOverflow(page, 'Mobile')

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
