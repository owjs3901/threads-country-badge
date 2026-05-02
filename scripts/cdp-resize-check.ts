interface TargetInfo {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

interface DebugStats {
  scans: number
  requested: number
  rendered: number
  cacheHits: number
  cacheMisses: number
}

interface Snapshot {
  href: string
  innerWidth: number
  innerHeight: number
  injectedReady: boolean
  badgeCount: number
  resolved: number
  pending: number
  questions: number
  usernames: string[]
  resolvedUsernames: string[]
  questionUsernames: string[]
  stats: DebugStats
  debugPanel: string | null
}

interface ResizeResult {
  before: Snapshot
  narrow: Snapshot
  restored: Snapshot
  deltaNarrow: DebugStats
  deltaRestored: DebugStats
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
const waitMs = Number(process.env.RESIZE_WAIT_MS ?? '15000')
const settleMs = Number(process.env.RESIZE_SETTLE_MS ?? '4000')
const narrowWidth = Number(process.env.RESIZE_NARROW_WIDTH ?? '820')
const narrowHeight = Number(process.env.RESIZE_NARROW_HEIGHT ?? '900')
const targets = await fetchJson<TargetInfo[]>(`${endpoint}/json/list`)
const target = targets.find(
  (item) => item.type === 'page' && item.url.includes('threads.com'),
)

if (target === undefined) {
  throw new Error('No Threads page found in the attached Chrome session.')
}

const cdp = await connect(target.webSocketDebuggerUrl)

try {
  await cdp.send('Runtime.enable', {})
  await cdp.send('Page.enable', {})
  const before = await waitForSnapshot(cdp, waitMs)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: narrowWidth,
    height: narrowHeight,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await delay(settleMs)
  const narrow = await waitForSnapshot(cdp, waitMs)

  await cdp.send('Emulation.clearDeviceMetricsOverride', {})
  await delay(settleMs)
  const restored = await waitForSnapshot(cdp, waitMs)
  const deltaNarrow = diffStats(before.stats, narrow.stats)
  const deltaRestored = diffStats(narrow.stats, restored.stats)
  const reason = getFailureReason(
    before,
    narrow,
    restored,
    deltaNarrow,
    deltaRestored,
  )
  const result: ResizeResult = {
    before,
    narrow,
    restored,
    deltaNarrow,
    deltaRestored,
    passed: reason === '',
    reason,
  }

  console.info(JSON.stringify(result, null, 2))

  if (!result.passed) {
    process.exitCode = 1
  }
} finally {
  cdp.close()
}

function snapshotExpression(): string {
  return `(() => {
    const badges = [...document.querySelectorAll('[data-threads-country-badge]')].map((badge) => ({
      username: badge.getAttribute('data-threads-country-badge') ?? '',
      text: badge.textContent?.trim() ?? '',
      hasFlagImage: badge.querySelector('img') !== null,
    }));
    const statsText = document.documentElement.getAttribute('data-threads-country-badge-stats') ?? '{}';
    let stats = {};
    try { stats = JSON.parse(statsText); } catch {}
    const isResolved = (badge) => badge.hasFlagImage || (badge.text !== '' && badge.text !== '?' && badge.text !== '…');

    return {
      href: location.href,
      innerWidth,
      innerHeight,
      injectedReady: window.__threadsCountryBadgeInjected === true,
      badgeCount: badges.length,
      resolved: badges.filter(isResolved).length,
      pending: badges.filter((badge) => badge.text === '…').length,
      questions: badges.filter((badge) => badge.text === '?').length,
      usernames: badges.map((badge) => badge.username).filter(Boolean),
      resolvedUsernames: badges.filter(isResolved).map((badge) => badge.username).filter(Boolean),
      questionUsernames: badges.filter((badge) => badge.text === '?').map((badge) => badge.username).filter(Boolean),
      stats: {
        scans: Number(stats.scans ?? 0),
        requested: Number(stats.requested ?? 0),
        rendered: Number(stats.rendered ?? 0),
        cacheHits: Number(stats.cacheHits ?? 0),
        cacheMisses: Number(stats.cacheMisses ?? 0),
      },
      debugPanel: document.querySelector('#threads-country-badge-debug')?.textContent ?? null,
    };
  })()`
}

async function waitForSnapshot(
  cdp: { evaluate: <T>(expression: string) => Promise<T> },
  timeoutMs: number,
): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs
  let snapshot = await cdp.evaluate<Snapshot>(snapshotExpression())

  while (Date.now() < deadline) {
    if (snapshot.injectedReady && snapshot.badgeCount > 0) {
      return snapshot
    }

    await delay(500)
    snapshot = await cdp.evaluate<Snapshot>(snapshotExpression())
  }

  return snapshot
}

function diffStats(before: DebugStats, after: DebugStats): DebugStats {
  return {
    scans: after.scans - before.scans,
    requested: after.requested - before.requested,
    rendered: after.rendered - before.rendered,
    cacheHits: after.cacheHits - before.cacheHits,
    cacheMisses: after.cacheMisses - before.cacheMisses,
  }
}

function getFailureReason(
  before: Snapshot,
  narrow: Snapshot,
  restored: Snapshot,
  deltaNarrow: DebugStats,
  deltaRestored: DebugStats,
): string {
  if (
    !before.injectedReady ||
    !narrow.injectedReady ||
    !restored.injectedReady
  ) {
    return 'extension injection was not ready during resize'
  }

  if (
    narrow.innerWidth === before.innerWidth &&
    narrow.innerHeight === before.innerHeight
  ) {
    return `viewport did not resize: ${before.innerWidth}x${before.innerHeight}`
  }

  const narrowLostResolved = findLostResolvedUsernames(before, narrow)
  const restoredLostResolved = findLostResolvedUsernames(before, restored)

  if (narrowLostResolved.length > 0 || restoredLostResolved.length > 0) {
    return `resolved usernames lost flags across resize: narrow=${narrowLostResolved.join(',')}, restored=${restoredLostResolved.join(',')}`
  }

  const narrowNewQuestions = findNewQuestionUsernames(before, narrow)
  const restoredNewQuestions = findNewQuestionUsernames(before, restored)

  if (narrowNewQuestions.length > 0 || restoredNewQuestions.length > 0) {
    return `question badges appeared across resize: narrow=${narrowNewQuestions.join(',')}, restored=${restoredNewQuestions.join(',')}`
  }

  const narrowNewUsernames = findNewUsernames(before, narrow)
  const restoredNewUsernames = findNewUsernames(before, restored)

  if (
    (deltaNarrow.requested > 0 && narrowNewUsernames.length === 0) ||
    (deltaRestored.requested > 0 && restoredNewUsernames.length === 0)
  ) {
    return `resize triggered new requests: narrow=${deltaNarrow.requested}, restored=${deltaRestored.requested}`
  }

  return ''
}

function findLostResolvedUsernames(
  before: Snapshot,
  after: Snapshot,
): string[] {
  const afterVisible = new Set(after.usernames)
  const afterResolved = new Set(after.resolvedUsernames)

  return before.resolvedUsernames.filter(
    (username) => afterVisible.has(username) && !afterResolved.has(username),
  )
}

function findNewQuestionUsernames(before: Snapshot, after: Snapshot): string[] {
  const beforeQuestions = new Set(before.questionUsernames)

  return after.questionUsernames.filter(
    (username) => !beforeQuestions.has(username),
  )
}

function findNewUsernames(before: Snapshot, after: Snapshot): string[] {
  const beforeUsernames = new Set(before.usernames)

  return after.usernames.filter((username) => !beforeUsernames.has(username))
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
