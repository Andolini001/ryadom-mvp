const targetUrl = process.argv[2] ?? 'https://andolini001.github.io/ryadom-mvp/'
const baseUrl = new URL(targetUrl)

const requiredStaticAssets = [
  'manifest.webmanifest',
  'favicon.svg',
  'glass-bg.png',
]

const requestTimeoutMs = 15_000

const fail = (message) => {
  console.error(message)
  process.exitCode = 1
}

const fetchWithTimeout = (url) =>
  fetch(url, {
    signal: AbortSignal.timeout(requestTimeoutMs),
  })

const fetchText = async (url) => {
  const response = await fetchWithTimeout(url)

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  return response.text()
}

const fetchOk = async (url) => {
  const response = await fetchWithTimeout(url)

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }
}

try {
  const html = await fetchText(baseUrl)

  if (!html.includes('id="root"')) {
    fail('Public HTML does not contain the React root node.')
  }

  if (!html.includes('/ryadom-mvp/assets/')) {
    fail('Public HTML does not point to GitHub Pages asset paths.')
  }

  const assetMatches = [
    ...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
  ].map((match) => match[1])

  if (assetMatches.length === 0) {
    fail('Public HTML does not include JS/CSS assets.')
  }

  await Promise.all(
    assetMatches.map((assetPath) => fetchOk(new URL(assetPath, baseUrl))),
  )

  await Promise.all(
    requiredStaticAssets.map((assetPath) => fetchOk(new URL(assetPath, baseUrl))),
  )

  const manifest = JSON.parse(await fetchText(new URL('manifest.webmanifest', baseUrl)))

  if (manifest.start_url !== '.') {
    fail('Manifest start_url must stay relative for GitHub Pages.')
  }

  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    fail('Manifest has no icons.')
  }

  if (process.exitCode) {
    process.exit(process.exitCode)
  }

  console.log(`Public smoke passed: ${baseUrl.href}`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
