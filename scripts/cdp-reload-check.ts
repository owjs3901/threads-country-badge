interface TargetInfo {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

interface BadgeResult {
  username: string | null
  text: string
  title: string
  href: string | null
  hasFlagImage: boolean
}

interface Snapshot {
  href: string
  injectedReady: boolean
  badgeCount: number
  resolvedBadges: BadgeResult[]
  questionBadges: BadgeResult[]
  pendingBadges: BadgeResult[]
  debugPanel: string | null
}

interface RoundResult {
  round: number
  initial: Snapshot
  down: Snapshot
  up: Snapshot
  passed: boolean
  reason: string
}

interface PendingCall {
  resolve: (message: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export {}

const endpoint = process.env.CHROME_CDP ?? 'http://127.0.0.1:9222'
const rounds = Number(process.env.RELOAD_ROUNDS ?? '10')
const waitMs = Number(process.env.RELOAD_WAIT_MS ?? '30000')
const settleMs = Number(process.env.RELOAD_SETTLE_MS ?? '5000')
const pollMs = Number(process.env.RELOAD_POLL_MS ?? '1000')
const targets = await fetchJson<TargetInfo[]>(`${endpoint}/json/list`)
const target = targets.find(
  (item) => item.type === 'page' && item.url.includes('threads.com'),
)

if (target === undefined) {
  throw new Error('No Threads page found in the attached Chrome session.')
}

const cdp = await connect(target.webSocketDebuggerUrl)
const results: RoundResult[] = []

try {
  await cdp.send('Runtime.enable', {})
  await cdp.send('Page.enable', {})

  for (let round = 1; round <= rounds; round += 1) {
    await cdp.send('Page.navigate', { url: 'https://www.threads.com/' })
    const initial = await waitForMeaningfulSnapshot(cdp, waitMs)
    logSnapshot(round, 'initial', initial)

    await cdp.evaluate(
      'window.scrollBy(0, Math.floor(window.innerHeight * 1.25))',
    )
    const down = await waitForMeaningfulSnapshot(cdp, waitMs)
    logSnapshot(round, 'down', down)

    await cdp.evaluate('window.scrollTo(0, 0)')
    await delay(settleMs)
    const up = await waitForMeaningfulSnapshot(cdp, waitMs)
    logSnapshot(round, 'up', up)

    const reason = getRoundFailureReason(initial, down, up)
    const result = { round, initial, down, up, passed: reason === '', reason }
    results.push(result)

    if (!result.passed) {
      break
    }
  }
} finally {
  cdp.close()
}

const firstFailure = results.find((result) => !result.passed)

console.info(
  JSON.stringify(
    {
      passed: firstFailure === undefined,
      roundsRequested: rounds,
      roundsCompleted: results.length,
      firstFailure,
      results,
    },
    null,
    2,
  ),
)

if (firstFailure !== undefined) {
  process.exitCode = 1
}

function snapshotExpression(): string {
  return `(() => {
    const pageWindow = window;
    const badges = [...document.querySelectorAll('[data-threads-country-badge]')].map((badge) => ({
      username: badge.getAttribute('data-threads-country-badge'),
      text: badge.textContent?.trim() ?? '',
      title: badge.getAttribute('title') ?? '',
      href: badge.closest('a[href*="/@"]')?.href ?? null,
      hasFlagImage: badge.querySelector('img') !== null,
    }));
    const isResolved = (badge) => badge.hasFlagImage || (badge.text !== '' && badge.text !== '?' && badge.text !== '…');
    return {
      href: location.href,
      injectedReady: pageWindow.__threadsCountryBadgeInjected === true,
      badgeCount: badges.length,
      resolvedBadges: badges.filter(isResolved),
      questionBadges: badges.filter((badge) => badge.text === '?'),
      pendingBadges: badges.filter((badge) => badge.text === '…'),
      debugPanel: document.querySelector('#threads-country-badge-debug')?.textContent ?? null,
    };
  })()`
}

async function waitForMeaningfulSnapshot(
  cdp: { evaluate: <T>(expression: string) => Promise<T> },
  timeoutMs: number,
): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs
  let snapshot = await cdp.evaluate<Snapshot>(snapshotExpression())

  while (Date.now() < deadline) {
    if (
      snapshot.questionBadges.length > 0 ||
      snapshot.resolvedBadges.length > 0
    ) {
      return snapshot
    }

    await delay(pollMs)
    snapshot = await cdp.evaluate<Snapshot>(snapshotExpression())
  }

  return snapshot
}

function logSnapshot(round: number, phase: string, snapshot: Snapshot): void {
  console.info(
    `[reload-check] ${round}/${rounds} ${phase}: badges=${snapshot.badgeCount}, resolved=${snapshot.resolvedBadges.length}, pending=${snapshot.pendingBadges.length}, questions=${snapshot.questionBadges.length}, injected=${snapshot.injectedReady}`,
  )
}

function getRoundFailureReason(...snapshots: Snapshot[]): string {
  const notInjectedSnapshot = snapshots.find(
    (snapshot) => !snapshot.injectedReady,
  )

  if (notInjectedSnapshot !== undefined) {
    return 'extension was not injected'
  }

  const questionSnapshot = snapshots.find(
    (snapshot) => snapshot.questionBadges.length > 0,
  )

  if (questionSnapshot !== undefined) {
    return 'question badge appeared'
  }

  const noResolvedSnapshot = snapshots.find(
    (snapshot) => snapshot.resolvedBadges.length === 0,
  )

  if (noResolvedSnapshot !== undefined) {
    return 'no resolved flag/country badge before reload'
  }

  return ''
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function connect(webSocketUrl: string): Promise<{
  close: () => void
  evaluate: <T>(expression: string) => Promise<T>
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>
}> {
  const socket = new WebSocket(webSocketUrl)
  let id = 0
  const pending = new Map<number, PendingCall>()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number }

    if (message.id !== undefined) {
      const call = pending.get(message.id)

      if (call !== undefined) {
        clearTimeout(call.timer)
        call.resolve(message)
      }

      pending.delete(message.id)
    }
  })

  socket.addEventListener('close', () => {
    const error = new Error('CDP websocket closed unexpectedly')

    for (const call of pending.values()) {
      clearTimeout(call.timer)
      call.reject(error)
    }

    pending.clear()
  })

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('CDP websocket failed to open')),
      { once: true },
    )
  })

  return {
    close: () => socket.close(),
    evaluate: async <T>(expression: string): Promise<T> => {
      const response = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      const payload = response as {
        result?: { result?: { value?: T }; exceptionDetails?: unknown }
      }

      if (payload.result?.exceptionDetails !== undefined) {
        throw new Error(JSON.stringify(payload.result.exceptionDetails))
      }

      return payload.result?.result?.value as T
    },
    send,
  }

  function send(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const messageId = ++id
    const message = JSON.stringify({ id: messageId, method, params })

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(messageId)
        reject(new Error(`CDP timeout while waiting for ${method}`))
      }, 30_000)
      pending.set(messageId, { resolve, reject, timer })
      socket.send(message)
    })
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
