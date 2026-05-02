interface TargetInfo {
  type: string
  url: string
  webSocketDebuggerUrl: string
}

interface PendingCall {
  resolve: (message: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export {}

const endpoint = process.env.CHROME_CDP ?? 'http://127.0.0.1:9222'
const targetUrlIncludes = process.env.CDP_TARGET ?? 'threads.com'
const expression = process.env.CDP_EXPR

if (expression === undefined) {
  throw new Error('Set CDP_EXPR to a JavaScript expression to evaluate.')
}

const targets = await fetchJson<TargetInfo[]>(`${endpoint}/json/list`)
const target = targets.find(
  (item) => item.type === 'page' && item.url.includes(targetUrlIncludes),
)

if (target === undefined) {
  throw new Error(`No page matching ${targetUrlIncludes} found.`)
}

const result = await evaluate(target.webSocketDebuggerUrl, expression)
console.info(JSON.stringify(result, null, 2))

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function evaluate(webSocketUrl: string, code: string): Promise<unknown> {
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

  try {
    await send('Runtime.enable', {})
    const response = await send('Runtime.evaluate', {
      expression: code,
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
