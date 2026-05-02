interface TargetInfo {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

export {}

const endpoint = process.env.CHROME_CDP ?? 'http://127.0.0.1:9222'
const targets = await fetchJson<TargetInfo[]>(`${endpoint}/json/list`)
const target = targets.find(
  (item) => item.type === 'page' && item.url.includes('chrome://extensions'),
)

if (target === undefined) {
  throw new Error('No chrome://extensions page found.')
}

const result = await evaluate(
  target.webSocketDebuggerUrl,
  `(() => {
  const manager = document.querySelector('extensions-manager');
  const managerRoot = manager?.shadowRoot;
  const itemList = managerRoot?.querySelector('extensions-item-list');
  const listRoot = itemList?.shadowRoot;
  const items = [...(listRoot?.querySelectorAll('extensions-item') ?? [])];
  return items.map((item) => {
    const root = item.shadowRoot;
    return {
      text: root?.textContent?.replace(/\\s+/g, ' ').trim() ?? item.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      name: root?.querySelector('#name')?.textContent?.trim() ?? null,
      id: item.getAttribute('id'),
      enabled: item.hasAttribute('enabled'),
      errorsButton: root?.querySelector('#errors-button')?.textContent?.trim() ?? null,
      inspectViews: [...(root?.querySelectorAll('a') ?? [])].map((anchor) => ({ text: anchor.textContent?.trim(), href: anchor.href })),
    };
  });
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
