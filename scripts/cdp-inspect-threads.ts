interface TargetInfo {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

export {}

const endpoint = process.env.CHROME_CDP ?? 'http://127.0.0.1:9222'
const targetUrlIncludes = process.env.CDP_TARGET ?? 'threads.com'
const targets = await fetchJson<TargetInfo[]>(`${endpoint}/json/list`)
const target = targets.find(
  (item) => item.type === 'page' && item.url.includes(targetUrlIncludes),
)

if (target === undefined) {
  throw new Error(
    `No page matching ${targetUrlIncludes} found in the attached Chrome session.`,
  )
}

const result = await evaluate(
  target.webSocketDebuggerUrl,
  `(() => {
  const pageWindow = window;
  const badges = [...document.querySelectorAll('[data-threads-country-badge]')].map((badge) => ({
    username: badge.getAttribute('data-threads-country-badge'),
    text: badge.textContent,
    title: badge.getAttribute('title'),
    href: badge.closest('a[href*="/@"]')?.href ?? null,
  }));
  return {
    href: location.href,
    readyState: document.readyState,
    injectedReady: pageWindow.__threadsCountryBadgeInjected === true,
    badgeCount: badges.length,
    questionBadges: badges.filter((badge) => badge.text === '?' || badge.title?.includes('country unavailable') || badge.title?.includes('No captured profile template')).slice(0, 20),
    badges: badges.slice(0, 30),
    debugPanel: document.querySelector('#threads-country-badge-debug')?.textContent ?? null,
    profileLinkCount: document.querySelectorAll('a[href*="/@"]').length,
  };
})()`,
)

console.info(JSON.stringify(result, null, 2))

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function evaluate(
  webSocketUrl: string,
  expression: string,
): Promise<unknown> {
  const socket = new WebSocket(webSocketUrl)
  let id = 0
  const pending = new Map<number, (message: unknown) => void>()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number }

    if (message.id !== undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
  })

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('CDP websocket failed to open')),
      { once: true },
    )
  })

  try {
    await send('Runtime.enable', {})
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    const payload = response as {
      result?: { result?: { value?: unknown }; exceptionDetails?: unknown }
    }

    if (payload.result?.exceptionDetails !== undefined) {
      throw new Error(JSON.stringify(payload.result.exceptionDetails))
    }

    return payload.result?.result?.value
  } finally {
    socket.close()
  }

  function send(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const messageId = ++id
    const message = JSON.stringify({ id: messageId, method, params })

    return new Promise((resolve) => {
      pending.set(messageId, resolve)
      socket.send(message)
    })
  }
}
