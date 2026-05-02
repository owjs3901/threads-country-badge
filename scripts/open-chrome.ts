import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const root =
  import.meta.dir === undefined ? process.cwd() : join(import.meta.dir, '..')
const dist = join(root, 'dist')
const fresh = process.argv.includes('--fresh')
const relaunch = process.argv.includes('--relaunch')
const debugPort = process.env.CHROME_DEBUG_PORT ?? '9222'
const debugEndpoint = `http://127.0.0.1:${debugPort}`
const profileArg = process.argv.find((argument) =>
  argument.startsWith('--profile='),
)
const profile =
  profileArg?.slice('--profile='.length) ??
  process.env.CHROME_PROFILE ??
  (fresh
    ? join(root, `.chrome-profile-live-${Date.now()}`)
    : join(root, '.chrome-profile-live'))
const chromePath = findChromePath()

if (chromePath === undefined) {
  throw new Error(
    'Chrome executable not found. Install Chrome or load dist/ manually from chrome://extensions.',
  )
}

if (!existsSync(join(dist, 'manifest.json'))) {
  throw new Error(
    'dist/manifest.json not found. Run `bun run build` before launching Chrome.',
  )
}

await mkdir(profile, { recursive: true })

if (relaunch) {
  await closeExistingDebugBrowser(debugEndpoint)
}

const chromeDist = toChromePath(dist)
const chromeProfile = toChromePath(profile)

const child = spawn(
  chromePath,
  [
    `--user-data-dir=${chromeProfile}`,
    `--disable-extensions-except=${chromeDist}`,
    `--load-extension=${chromeDist}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    '--disable-features=Translate,OptimizationGuideModelDownloading,OptimizationHintsFetching',
    'chrome://extensions/',
    'https://www.threads.com/',
  ],
  {
    detached: true,
    stdio: 'ignore',
  },
)

child.unref()
console.info(`Opened Chrome with extension: ${dist}`)
console.info(`Chrome profile: ${profile}`)
console.info(`Remote debugging: ${debugEndpoint}`)

function findChromePath(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    join(
      process.env.LOCALAPPDATA ?? '',
      'ms-playwright',
      'chromium-1217',
      'chrome-win64',
      'chrome.exe',
    ),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]

  return candidates.find(
    (candidate) => candidate !== undefined && existsSync(candidate),
  )
}

function toChromePath(path: string): string {
  return path.replaceAll('\\', '/')
}

async function closeExistingDebugBrowser(endpoint: string): Promise<void> {
  try {
    const version = await fetchJson<{ webSocketDebuggerUrl?: string }>(
      `${endpoint}/json/version`,
    )

    if (version.webSocketDebuggerUrl === undefined) {
      return
    }

    await sendBrowserClose(version.webSocketDebuggerUrl)
    await waitForEndpointToClose(endpoint)
  } catch {
    // No browser is currently listening on the debug port.
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function sendBrowserClose(webSocketUrl: string): Promise<void> {
  const socket = new WebSocket(webSocketUrl)

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('CDP websocket failed to open')),
      { once: true },
    )
  })

  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  socket.close()
}

async function waitForEndpointToClose(endpoint: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`${endpoint}/json/version`)
    } catch {
      return
    }

    await delay(250)
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
