import {
  decodeEscapedUnicode,
  decodeJsonString,
  extractHandleFromDisplayName,
  extractUserIdFromProfileHtml,
  isAboutProfileCountryKey,
  isLabelTextStyle,
  isLocationLabel,
  isUsefulCountryCandidate,
  isUsefulUsernameCandidate,
  isValueTextStyle,
  normalizeUsername,
  parseMaybeJson,
} from './injected-logic'

interface SessionTokens {
  fbDtsg?: string
  lsd?: string
  jazoest?: string
  a?: string
  hs?: string
  dpr?: string
  ccg?: string
  rev?: string
  s?: string
  hsi?: string
  dyn?: string
  csr?: string
  cometReq?: string
  spinR?: string
  spinB?: string
  spinT?: string
  user?: string
  d?: string
  bkv?: string
}

interface AboutProfileTemplate {
  url: string
  bodyEntries: Array<[string, string]>
  capturedAt: number
  useCount: number
}

interface RequestDetail {
  requestId: string
  username: string
  knownUserId?: string
  allowTemplateReplay?: boolean
  allowFallbackConstruction?: boolean
}

const REQUEST_EVENT = 'threads-country-badge:request'
const RESULT_EVENT = 'threads-country-badge:result'
const USER_ID_EVENT = 'threads-country-badge:user-id'
const DEBUG_EVENT = 'threads-country-badge:debug'
const userIds = new Map<string, string>()
const usernamesByUserId = new Map<string, string>()
const pendingAboutProfileRequests: Array<{
  url: string
  userId: string
  capturedAt: number
}> = []
const passiveCountriesByUserId = new Map<string, string>()
const tokens: SessionTokens = {}
let originalFetch: typeof window.fetch | undefined
let aboutProfileTemplate: AboutProfileTemplate | undefined
const DEFAULT_BKV =
  '22713cafbb647b89c4e9c1acdea97d89c8c2046e2f4b18729760e9b1ae0724f7'
const INSPECTABLE_CONTENT_TYPE_PATTERN =
  /(?:json|text|html|javascript|x-www-form-urlencoded)/
const TEXT_STYLE_PAIR_PATTERN =
  /"text"\s*:\s*"([^"]+)"[\s\S]{0,250}?"text_style"\s*:\s*"([^"]+)"|"text_style"\s*:\s*"([^"]+)"[\s\S]{0,250}?"text"\s*:\s*"([^"]+)"/g
const ON_BIND_PATTERN = /"on_bind"\s*:\s*"((?:\\.|[^"])*)"/g
const USERNAME_FIRST_PATTERN =
  /"username"\s*:\s*"([\w.]+)"[\s\S]{0,120}?"user_id"\s*:\s*"?(\d+)"?/g
const USER_ID_FIRST_PATTERN =
  /"user_id"\s*:\s*"?(\d+)"?[\s\S]{0,120}?"username"\s*:\s*"([\w.]+)"/g
const pageWindow = window as Window & {
  __threadsCountryBadgeInjected?: boolean
}

if (pageWindow.__threadsCountryBadgeInjected === true) {
  debug('injected-ready', 'Page-world script already installed')
} else {
  pageWindow.__threadsCountryBadgeInjected = true

  scanDocumentScripts()
  patchFetch()
  patchXhr()
  bindRequests()
  debug('injected-ready', 'Page-world script installed')
  window.setTimeout(() => scanDocumentScripts(), 1_000)
  window.setTimeout(() => scanDocumentScripts(), 3_000)
}

function bindRequests(): void {
  window.addEventListener(REQUEST_EVENT, (event) => {
    if (!(event instanceof CustomEvent)) {
      return
    }

    void handleRequest(event.detail as RequestDetail)
  })
}

async function handleRequest(detail: RequestDetail): Promise<void> {
  const username = normalizeUsername(detail.username)
  const userId =
    detail.knownUserId ??
    userIds.get(username) ??
    (await resolveUserIdFromProfileHtml(username))

  if (userId === undefined) {
    debug('resolve-miss-user-id', `No user id for @${username}`)
    dispatchResult(detail.requestId, username, {
      error: 'User ID not discovered yet',
    })
    return
  }

  if (tokens.fbDtsg === undefined) {
    scanDocumentScripts()
  }

  if (tokens.fbDtsg === undefined) {
    debug('resolve-miss-token', `No fb_dtsg token for @${username}`)
    dispatchResult(detail.requestId, username, {
      userId,
      error:
        'Threads session token not discovered yet. Scroll or interact with Threads, then try again.',
    })
    return
  }

  try {
    const country = await fetchProfileCountry(userId, detail)
    debug('resolve-result', `@${username}: ${country ?? 'no country'}`)
    const result: { userId?: string; country?: string } = { userId }

    if (country !== undefined) {
      result.country = country
    }

    dispatchResult(detail.requestId, username, result)
  } catch (error) {
    debug(
      'resolve-error',
      error instanceof Error ? error.message : 'Unknown profile lookup error',
    )
    dispatchResult(detail.requestId, username, {
      userId,
      error:
        error instanceof Error ? error.message : 'Unknown profile lookup error',
    })
  }
}

async function resolveUserIdFromProfileHtml(
  username: string,
): Promise<string | undefined> {
  debug('profile-html', `Fetching /@${username} for user id fallback`)

  try {
    const response = await fetch(`/@${encodeURIComponent(username)}`, {
      credentials: 'include',
      headers: {
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      debug('profile-html-error', `/@${username} returned ${response.status}`)
      return undefined
    }

    const html = await response.text()
    captureTokensFromText(html)
    harvestUserIdsFromText(html)
    const userId = extractUserIdFromProfileHtml(html)

    if (userId !== undefined) {
      addUserId(username, userId)
      debug('profile-html-user-id', `@${username} → ${userId}`)
      return userId
    }
  } catch (error) {
    debug(
      'profile-html-error',
      error instanceof Error
        ? error.message
        : 'Unknown profile HTML lookup error',
    )
  }

  return undefined
}

async function fetchProfileCountry(
  userId: string,
  detail: RequestDetail,
): Promise<string | undefined> {
  let response: Response | undefined

  if (
    detail.allowTemplateReplay !== false &&
    aboutProfileTemplate !== undefined
  ) {
    response = await replayAboutProfileTemplate(userId, aboutProfileTemplate)
  } else if (detail.allowFallbackConstruction === true) {
    response = await fetchProfileCountryWithSessionParams(userId)
  } else {
    throw new Error(
      'No captured profile template yet. Open About this profile once, or enable unstable fallback construction in options.',
    )
  }

  if (response.status === 429) {
    throw new Error('Threads rate limit reached while fetching profile country')
  }

  if (!response.ok) {
    throw new Error(
      `Threads profile country request failed (${response.status})`,
    )
  }

  const text = await response.text()

  return extractCountryFromBloks(text)
}

async function replayAboutProfileTemplate(
  userId: string,
  template: AboutProfileTemplate,
): Promise<Response> {
  const body = new URLSearchParams(template.bodyEntries)
  const previousParams = parseJsonObject(body.get('params'))
  body.set('__req', `ext_${Math.random().toString(36).slice(2, 9)}`)
  body.set(
    'params',
    JSON.stringify({
      ...previousParams,
      atpTriggerSessionID: crypto.randomUUID(),
      referer_type: 'TextPostAppProfileOverflow',
      target_user_id: userId,
    }),
  )

  if (tokens.fbDtsg !== undefined) {
    body.set('fb_dtsg', tokens.fbDtsg)
  }

  if (tokens.lsd !== undefined) {
    body.set('lsd', tokens.lsd)
  }

  template.useCount += 1
  debug(
    'bloks-replay',
    `Replaying captured template for ${userId}; use=${template.useCount}`,
  )

  return getOriginalFetch()(template.url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-fb-friendly-name': 'BarcelonaProfileAboutThisProfileAsyncActionQuery',
      'x-fb-lsd': body.get('lsd') ?? tokens.lsd ?? '',
    },
    body,
  })
}

async function fetchProfileCountryWithSessionParams(
  userId: string,
): Promise<Response> {
  const body = new URLSearchParams()
  body.set('fb_dtsg', tokens.fbDtsg ?? '')
  body.set('lsd', tokens.lsd ?? '')
  body.set('jazoest', tokens.jazoest ?? '')
  body.set('__user', '0')
  body.set('__a', tokens.a ?? '1')
  body.set('__req', `ext_${Math.random().toString(36).slice(2, 9)}`)
  body.set('__hs', tokens.hs ?? '')
  body.set('dpr', tokens.dpr ?? String(window.devicePixelRatio || 1))
  body.set('__ccg', tokens.ccg ?? 'UNKNOWN')
  body.set('__rev', tokens.rev ?? tokens.spinR ?? '')
  body.set('__s', tokens.s ?? '')
  body.set('__hsi', tokens.hsi ?? '')
  body.set('__dyn', tokens.dyn ?? '')
  body.set('__csr', tokens.csr ?? '')
  body.set('__comet_req', tokens.cometReq ?? '29')
  body.set('server_timestamps', 'true')
  body.set('__spin_r', tokens.spinR ?? '')
  body.set('__spin_b', tokens.spinB ?? 'trunk')
  body.set('__spin_t', tokens.spinT ?? '')
  body.set(
    'params',
    JSON.stringify({
      atpTriggerSessionID: crypto.randomUUID(),
      referer_type: 'TextPostAppProfileOverflow',
      target_user_id: userId,
    }),
  )
  body.set('__d', tokens.d ?? 'www')

  debug('bloks-fallback', `Using session params fallback for ${userId}`)

  return getOriginalFetch()(
    `/async/wbloks/fetch/?appid=com.bloks.www.text_post_app.about_this_profile_async_action&type=app&__bkv=${encodeURIComponent(tokens.bkv ?? DEFAULT_BKV)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-fb-friendly-name':
          'BarcelonaProfileAboutThisProfileAsyncActionQuery',
        'x-fb-lsd': tokens.lsd ?? '',
      },
      body,
    },
  )
}

function patchFetch(): void {
  originalFetch = window.fetch.bind(window)

  window.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    captureRequestBody(init?.body, url)
    const response = await getOriginalFetch()(input, init)

    if (shouldInspectResponse(url, response)) {
      void response
        .clone()
        .text()
        .then((text) => inspectResponseText(url, text))
        .catch(() => undefined)
    }

    return response
  }) as typeof window.fetch
}

function patchXhr(): void {
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const xhrUrls = new WeakMap<XMLHttpRequest, string>()

  XMLHttpRequest.prototype.open = function open(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    xhrUrls.set(this, typeof url === 'string' ? url : url.href)
    this.addEventListener('load', () => {
      const responseUrl = typeof url === 'string' ? url : url.href

      if (
        shouldInspectUrl(responseUrl) &&
        typeof this.responseText === 'string'
      ) {
        inspectResponseText(responseUrl, this.responseText)
      }
    })
    originalOpen.call(this, method, url, async ?? true, username, password)
  }

  XMLHttpRequest.prototype.send = function send(
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    captureRequestBody(body, xhrUrls.get(this))
    originalSend.call(this, body)
  }
}

function shouldInspectResponse(url: string, response: Response): boolean {
  return response.ok && shouldInspectUrl(url) && shouldInspectContent(response)
}

function shouldInspectContent(response: Response): boolean {
  const contentType = response.headers.get('content-type')

  return (
    contentType === null || INSPECTABLE_CONTENT_TYPE_PATTERN.test(contentType)
  )
}

function shouldInspectUrl(url: string): boolean {
  if (url.startsWith('/')) {
    return true
  }

  if (url.includes('threads.com') || url.includes('threads.net')) {
    return true
  }

  return url.includes('bulk-route-definitions') || url.includes('graphql')
}

function inspectResponseText(url: string, text: string): void {
  captureTokensFromText(text)

  if (url.includes('about_this_profile_async_action')) {
    handlePassiveAboutProfileResponse(url, text)
  }

  if (!text.includes('username') || !text.includes('user_id')) {
    return
  }

  try {
    const json = parseMaybeJson(text)
    harvestUserIds(json)
  } catch {
    harvestUserIdsFromText(text)
  }

  if (url.includes('bulk-route-definitions')) {
    harvestRouteDefinitions(text)
  }
}

function captureRequestBody(
  body: BodyInit | Document | null | undefined,
  url?: string,
): void {
  if (body === null || body === undefined) {
    return
  }

  if (typeof body === 'string') {
    const params = new URLSearchParams(body)
    captureTokensFromParams(params)
    captureAboutProfileTemplate(url, params)
    return
  }

  if (body instanceof URLSearchParams) {
    captureTokensFromParams(body)
    captureAboutProfileTemplate(url, body)
  }
}

function captureAboutProfileTemplate(
  url: string | undefined,
  params: URLSearchParams,
): void {
  if (url === undefined || !url.includes('about_this_profile_async_action')) {
    return
  }

  const requestParams = parseJsonObject(params.get('params'))
  const targetUserId =
    typeof requestParams.target_user_id === 'string'
      ? requestParams.target_user_id
      : undefined

  if (targetUserId !== undefined) {
    pendingAboutProfileRequests.push({
      url,
      userId: targetUserId,
      capturedAt: Date.now(),
    })
    prunePendingAboutProfileRequests()
    debug('bloks-request', `Captured about profile request for ${targetUserId}`)
  }

  aboutProfileTemplate = {
    url,
    bodyEntries: [...params.entries()],
    capturedAt: Date.now(),
    useCount: 0,
  }
  assignIfPresent('bkv', firstMatch(url, [/__bkv=([a-f0-9]{32,})/]), true)
  debug(
    'bloks-template',
    `Captured about profile template (${aboutProfileTemplate.bodyEntries.length} fields)`,
  )
}

function handlePassiveAboutProfileResponse(url: string, text: string): void {
  const request = takePendingAboutProfileRequest(url)
  const country = extractCountryFromBloks(text)

  if (country === undefined) {
    debug('passive-about', 'Observed about profile response with no country')
    return
  }

  const parsed = parseBloksResponse(text)
  const recoveredUserId =
    extractTargetUserIdFromAboutProfile(parsed, text) ?? request?.userId
  const recoveredUsername =
    recoveredUserId === undefined
      ? undefined
      : (usernamesByUserId.get(recoveredUserId) ??
        extractUsernameFromAboutProfile(parsed))
  debug(
    'passive-about-recovery',
    `country=${country}; requestUserId=${request?.userId ?? 'none'}; recoveredUserId=${recoveredUserId ?? 'none'}; recoveredUsername=${recoveredUsername ?? 'none'}`,
  )

  if (recoveredUserId !== undefined && recoveredUsername !== undefined) {
    addUserId(recoveredUsername, recoveredUserId)
  }

  const username =
    recoveredUserId === undefined
      ? extractUsernameFromAboutProfile(parsed)
      : (usernamesByUserId.get(recoveredUserId) ?? recoveredUsername)

  if (username !== undefined) {
    debug(
      'passive-about',
      `@${username}${recoveredUserId === undefined ? '' : ` (${recoveredUserId})`}: ${country}`,
    )
    dispatchResult(
      `passive_${crypto.randomUUID()}`,
      username,
      recoveredUserId === undefined
        ? { country }
        : { userId: recoveredUserId, country },
    )
    return
  }

  if (recoveredUserId !== undefined) {
    passiveCountriesByUserId.set(recoveredUserId, country)
    debug(
      'passive-about',
      `Stored ${country} for user id ${recoveredUserId}; waiting for username`,
    )
    return
  }

  debug(
    'passive-about',
    `Observed ${country}, but user id and username were not recovered`,
  )
}

function takePendingAboutProfileRequest(
  url: string,
): { url: string; userId: string; capturedAt: number } | undefined {
  prunePendingAboutProfileRequests()
  const normalizedUrl = stripVolatileUrl(url)
  const index = pendingAboutProfileRequests.findIndex(
    (request) => stripVolatileUrl(request.url) === normalizedUrl,
  )

  if (index === -1) {
    return undefined
  }

  const [request] = pendingAboutProfileRequests.splice(index, 1)

  return request
}

function prunePendingAboutProfileRequests(): void {
  const cutoff = Date.now() - 10_000
  const firstFreshIndex = pendingAboutProfileRequests.findIndex(
    (request) => request.capturedAt >= cutoff,
  )

  if (firstFreshIndex === -1) {
    pendingAboutProfileRequests.length = 0
    return
  }

  if (firstFreshIndex > 0) {
    pendingAboutProfileRequests.splice(0, firstFreshIndex)
  }
}

function stripVolatileUrl(url: string): string {
  const hashIndex = url.indexOf('#')

  return hashIndex === -1 ? url : url.slice(0, hashIndex)
}

function captureTokensFromParams(params: URLSearchParams): void {
  assignIfPresent('fbDtsg', params.get('fb_dtsg'))
  assignIfPresent('lsd', params.get('lsd'))
  assignIfPresent('jazoest', params.get('jazoest'))
  assignIfPresent('a', params.get('__a'))
  assignIfPresent('hs', params.get('__hs'))
  assignIfPresent('dpr', params.get('dpr'))
  assignIfPresent('ccg', params.get('__ccg'))
  assignIfPresent('rev', params.get('__rev'))
  assignIfPresent('s', params.get('__s'))
  assignIfPresent('hsi', params.get('__hsi'))
  assignIfPresent('dyn', params.get('__dyn'))
  assignIfPresent('csr', params.get('__csr'))
  assignIfPresent('cometReq', params.get('__comet_req'))
  assignIfPresent('spinR', params.get('__spin_r'))
  assignIfPresent('spinB', params.get('__spin_b'))
  assignIfPresent('spinT', params.get('__spin_t'))
  assignIfPresent('user', params.get('__user'))
  assignIfPresent('d', params.get('__d'))
}

function scanDocumentScripts(): void {
  const shouldCaptureTokens = !hasCoreSessionTokens()

  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script:not([src])',
  )) {
    const text = script.textContent

    if (text === null || text.length === 0) {
      continue
    }

    if (shouldCaptureTokens) {
      captureTokensFromText(text)
    }

    harvestUserIdsFromText(text)
  }
}

function hasCoreSessionTokens(): boolean {
  return tokens.fbDtsg !== undefined && tokens.lsd !== undefined
}

function captureTokensFromText(text: string): void {
  assignIfPresent(
    'fbDtsg',
    firstMatch(text, [
      /"fb_dtsg"\s*:\s*"([^"]+)"/,
      /\["DTSGInitialData",\[\],\{"token":"([^"]+)"/,
    ]),
    true,
  )
  assignIfPresent(
    'lsd',
    firstMatch(text, [
      /"LSD",\[\],\{"token":"([^"]+)"/,
      /"lsd"\s*:\s*"([^"]+)"/,
    ]),
    true,
  )
  assignIfPresent(
    'jazoest',
    firstMatch(text, [/"jazoest"\s*:\s*"([^"]+)"/]),
    true,
  )
  assignIfPresent(
    'user',
    firstMatch(text, [
      /"USER_ID"\s*:\s*"(\d{5,})"/,
      /"viewer"\s*:\s*\{[^}]*"id"\s*:\s*"(\d{5,})"/,
    ]),
    true,
  )
  assignIfPresent(
    'spinR',
    firstMatch(text, [/"__spin_r"\s*:\s*"?(\d+)"?/]),
    true,
  )
  assignIfPresent(
    'spinB',
    firstMatch(text, [/"__spin_b"\s*:\s*"([^"]+)"/]),
    true,
  )
  assignIfPresent(
    'spinT',
    firstMatch(text, [/"__spin_t"\s*:\s*"?(\d+)"?/]),
    true,
  )
  assignIfPresent(
    'bkv',
    firstMatch(text, [
      /__bkv=([a-f0-9]{32,})/,
      /"__bkv"\s*:\s*"([a-f0-9]{32,})"/,
    ]),
    true,
  )
}

function extractCountryFromBloks(text: string): string | undefined {
  let parsed: unknown

  try {
    parsed = parseMaybeJson(text)
  } catch {
    parsed = undefined
  }

  if (parsed !== undefined) {
    const globalStateCountry = extractCountryFromGlobalState(parsed)

    if (globalStateCountry !== undefined) {
      debug('country-parser', `global-state: ${globalStateCountry}`)
      return globalStateCountry
    }
  }

  const pairs =
    parsed === undefined
      ? extractTextPairsFromString(text)
      : extractTextPairs(parsed)

  for (const pair of pairs) {
    const value = decodeEscapedUnicode(pair.value.trim())

    if (isLocationLabel(pair.label) && isUsefulCountryCandidate(value)) {
      debug('country-parser', `label-pair: ${value}`)
      return value
    }
  }

  const bindCountry = extractCountryFromOnBindString(text)

  if (bindCountry !== undefined) {
    debug('country-parser', `on-bind-string: ${bindCountry}`)
    return bindCountry
  }

  return undefined
}

function extractCountryFromGlobalState(value: unknown): string | undefined {
  let country: string | undefined

  walk(value, (node) => {
    if (country !== undefined || !isRecord(node)) {
      return
    }

    const key = readFirstNestedString(node, [
      ['data', 'key'],
      ['key'],
      ['metadata', 'key'],
      ['props', 'key'],
    ])
    const initial = readFirstNestedString(node, [
      ['data', 'initial'],
      ['initial'],
      ['data', 'value'],
      ['value'],
      ['props', 'initial'],
    ])

    const decodedInitial =
      initial === undefined ? undefined : decodeEscapedUnicode(initial.trim())

    if (
      key !== undefined &&
      isAboutProfileCountryKey(key) &&
      decodedInitial !== undefined &&
      isUsefulCountryCandidate(decodedInitial)
    ) {
      country = decodedInitial
    }
  })

  return country
}

function extractTextPairs(
  value: unknown,
): Array<{ label: string; value: string }> {
  const textNodes: Array<{ style: string; text: string }> = []

  walk(value, (node) => {
    if (!isRecord(node)) {
      return
    }

    const text = readFirstStringField(node, [
      'text',
      'content',
      'label',
      'value',
    ])
    const textStyle =
      typeof node.text_style === 'string'
        ? node.text_style
        : typeof node.textStyle === 'string'
          ? node.textStyle
          : undefined
    const onBindText = extractOnBindText(node.on_bind)
    const resolvedText = text ?? onBindText

    if (resolvedText !== undefined && textStyle !== undefined) {
      textNodes.push({ style: textStyle, text: resolvedText })
    }
  })

  return pairTextNodes(textNodes)
}

function extractTextPairsFromString(
  text: string,
): Array<{ label: string; value: string }> {
  const textNodes: Array<{ style: string; text: string }> = []
  TEXT_STYLE_PAIR_PATTERN.lastIndex = 0
  let match = TEXT_STYLE_PAIR_PATTERN.exec(text)

  while (match !== null) {
    const firstText = match[1]
    const firstStyle = match[2]
    const secondStyle = match[3]
    const secondText = match[4]
    const nodeText = firstText ?? secondText
    const nodeStyle = firstStyle ?? secondStyle

    if (nodeText !== undefined && nodeStyle !== undefined) {
      textNodes.push({ style: nodeStyle, text: decodeJsonString(nodeText) })
    }

    match = TEXT_STYLE_PAIR_PATTERN.exec(text)
  }

  return pairTextNodes(textNodes)
}

function extractCountryFromOnBindString(text: string): string | undefined {
  ON_BIND_PATTERN.lastIndex = 0
  let match = ON_BIND_PATTERN.exec(text)

  while (match !== null) {
    const value = extractFirstUsefulOnBindValue(
      decodeJsonString(match[1] ?? ''),
    )

    if (value !== undefined) {
      return value
    }

    match = ON_BIND_PATTERN.exec(text)
  }

  return undefined
}

function extractFirstUsefulOnBindValue(onBind: string): string | undefined {
  const ifMatch =
    /bk\.action\.(?:core\.)?If\b[\s\S]*?,\s*"((?:\\.|[^"])*)"\s*,\s*"((?:\\.|[^"])*)"/.exec(
      onBind,
    )

  if (ifMatch !== null) {
    const visibleValue = decodeEscapedUnicode(
      decodeJsonString(ifMatch[1] ?? '').trim(),
    )
    const fallbackValue = decodeEscapedUnicode(
      decodeJsonString(ifMatch[2] ?? '').trim(),
    )
    const preferred = visibleValue.length > 0 ? visibleValue : fallbackValue

    return isUsefulCountryCandidate(preferred) ? preferred : undefined
  }

  const quoted = [...onBind.matchAll(/"((?:\\.|[^"])*)"/g)].map((match) =>
    decodeEscapedUnicode(decodeJsonString(match[1] ?? '').trim()),
  )
  const candidates = quoted.filter(isUsefulCountryCandidate)

  return candidates[0]
}

function extractOnBindText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return (
      extractFirstUsefulOnBindValue(value) ??
      (isUsefulCountryCandidate(value) ? value.trim() : undefined)
    )
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractOnBindText(item)

      if (extracted !== undefined) {
        return extracted
      }
    }

    return undefined
  }

  if (isRecord(value)) {
    const text = readFirstStringField(value, [
      'text',
      'content',
      'label',
      'value',
    ])

    return text !== undefined && isUsefulCountryCandidate(text)
      ? text.trim()
      : undefined
  }

  return undefined
}

function pairTextNodes(
  textNodes: Array<{ style: string; text: string }>,
): Array<{ label: string; value: string }> {
  const pairs: Array<{ label: string; value: string }> = []
  let currentLabel: string | undefined

  for (const node of textNodes) {
    if (isLabelTextStyle(node.style) && node.text.trim().length > 0) {
      currentLabel = node.text
      continue
    }

    if (
      isValueTextStyle(node.style) &&
      currentLabel !== undefined &&
      node.text.trim().length > 0
    ) {
      pairs.push({ label: currentLabel, value: node.text })
      currentLabel = undefined
    }
  }

  return pairs
}

function parseBloksResponse(text: string): unknown {
  try {
    return parseMaybeJson(text)
  } catch {
    return undefined
  }
}

function extractTargetUserIdFromAboutProfile(
  parsed: unknown,
  text: string,
): string | undefined {
  if (parsed !== undefined) {
    let userId: string | undefined

    walk(parsed, (node) => {
      if (userId !== undefined || !isRecord(node)) {
        return
      }

      const targetUserId = readFirstStringField(node, [
        'target_user_id',
        'target_ig_user_id',
      ])
      const numericTargetUserId = readFirstNumberField(node, [
        'target_user_id',
        'target_ig_user_id',
      ])
      const onFirstMount =
        typeof node.on_first_mount === 'string'
          ? node.on_first_mount
          : undefined

      if (targetUserId !== undefined && /^\d+$/.test(targetUserId)) {
        userId = targetUserId
        return
      }

      if (numericTargetUserId !== undefined) {
        userId = String(numericTargetUserId)
        return
      }

      if (onFirstMount !== undefined) {
        userId = extractTargetUserIdFromActionString(onFirstMount)
      }
    })

    if (userId !== undefined) {
      return userId
    }
  }

  return extractTargetUserIdFromActionString(text)
}

function extractTargetUserIdFromActionString(text: string): string | undefined {
  return firstMatch(text, [
    /"target_(?:ig_)?user_id"\s*:\s*"?(\d+)"?/,
    /target_(?:ig_)?user_id[\s\S]{0,500}?bk\.action\.i64\.Const,\s*(\d+)/,
    /target_(?:ig_)?user_id[\s\S]{0,500}?\(bk\.action\.i64\.Const,\s*(\d+)\)/,
  ])
}

function extractUsernameFromAboutProfile(parsed: unknown): string | undefined {
  if (parsed === undefined) {
    return undefined
  }

  const pairs = extractTextPairs(parsed)
  const namePair = pairs.find((pair) => isNameLabel(pair.label))

  if (namePair !== undefined) {
    const directUsername = normalizeUsername(namePair.value.trim())

    if (isUsefulUsernameCandidate(directUsername)) {
      return directUsername
    }

    const embeddedHandle = extractHandleFromDisplayName(namePair.value)

    if (embeddedHandle !== undefined) {
      return embeddedHandle
    }
  }

  let username: string | undefined

  walk(parsed, (node) => {
    if (username !== undefined || !isRecord(node)) {
      return
    }

    const candidate = readFirstStringField(node, [
      'username',
      'user_name',
      'handle',
    ])
    const embeddedHandleSource = readFirstStringField(node, [
      'text',
      'content',
      'label',
      'value',
    ])

    if (candidate !== undefined && isUsefulUsernameCandidate(candidate)) {
      username = normalizeUsername(candidate.trim())
      return
    }

    if (embeddedHandleSource !== undefined) {
      username = extractHandleFromDisplayName(embeddedHandleSource)
    }
  })

  return username
}

function isNameLabel(label: string): boolean {
  const normalized = label
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[:：]$/, '')

  return [
    'name',
    'username',
    'display name',
    '名前',
    '사용자 이름',
    '이름',
    '姓名',
    '名稱',
    '名称',
  ].includes(normalized)
}

function harvestRouteDefinitions(text: string): void {
  const routeRegex =
    /\\?"\/@([\w.]+)\\?"[\s\S]{0,2500}?\\?"user_id\\?"\s*:\s*\\?"?(\d+)\\?"?/g
  let match = routeRegex.exec(text)

  while (match !== null) {
    addUserId(match[1], match[2])
    match = routeRegex.exec(text)
  }
}

function harvestUserIdsFromText(text: string): void {
  USERNAME_FIRST_PATTERN.lastIndex = 0
  let match = USERNAME_FIRST_PATTERN.exec(text)

  while (match !== null) {
    addUserId(match[1], match[2])
    match = USERNAME_FIRST_PATTERN.exec(text)
  }

  USER_ID_FIRST_PATTERN.lastIndex = 0
  match = USER_ID_FIRST_PATTERN.exec(text)

  while (match !== null) {
    addUserId(match[2], match[1])
    match = USER_ID_FIRST_PATTERN.exec(text)
  }
}

function harvestUserIds(value: unknown): void {
  walk(value, (node) => {
    if (!isRecord(node)) {
      return
    }

    const username =
      typeof node.username === 'string' ? node.username : undefined
    const userId =
      typeof node.user_id === 'string' || typeof node.user_id === 'number'
        ? String(node.user_id)
        : undefined

    if (
      username !== undefined &&
      userId !== undefined &&
      /^\d+$/.test(userId)
    ) {
      addUserId(username, userId)
    }
  })
}

function addUserId(
  username: string | undefined,
  userId: string | undefined,
): void {
  if (username === undefined || userId === undefined || !/^\d+$/.test(userId)) {
    return
  }

  const normalized = normalizeUsername(username)

  if (!isUsefulUsernameCandidate(normalized)) {
    debug('user-id-rejected', `Invalid username format: ${username}`)
    return
  }

  if (userIds.get(normalized) === userId) {
    return
  }

  userIds.set(normalized, userId)
  usernamesByUserId.set(userId, normalized)
  debug('user-id', `@${normalized} → ${userId}`)
  window.dispatchEvent(
    new CustomEvent(USER_ID_EVENT, {
      detail: {
        type: 'THREADS_COUNTRY_BADGE_USER_ID',
        username: normalized,
        userId,
      },
    }),
  )
  const passiveCountry = passiveCountriesByUserId.get(userId)

  if (passiveCountry !== undefined) {
    passiveCountriesByUserId.delete(userId)
    debug(
      'passive-about',
      `Flushing stored ${passiveCountry} for @${normalized}`,
    )
    dispatchResult(`passive_${crypto.randomUUID()}`, normalized, {
      userId,
      country: passiveCountry,
    })
  }
}

function debug(stage: string, message: string): void {
  window.dispatchEvent(
    new CustomEvent(DEBUG_EVENT, {
      detail: { source: 'injected', stage, message, at: Date.now() },
    }),
  )
}

function dispatchResult(
  requestId: string,
  username: string,
  result: { userId?: string; country?: string; error?: string },
): void {
  window.dispatchEvent(
    new CustomEvent(RESULT_EVENT, {
      detail: {
        type: 'THREADS_COUNTRY_BADGE_RESULT',
        requestId,
        username,
        ...result,
      },
    }),
  )
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (value === null) {
    return {}
  }

  try {
    const parsed = JSON.parse(value) as unknown

    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getOriginalFetch(): typeof window.fetch {
  if (originalFetch === undefined) {
    originalFetch = window.fetch.bind(window)
  }

  return originalFetch
}

function walk(value: unknown, visit: (value: unknown) => void): void {
  visit(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visit)
    }
    return
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      walk(item, visit)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNestedString(
  value: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let current: unknown = value

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined
    }

    current = current[key]
  }

  return typeof current === 'string' ? current : undefined
}

function readFirstNestedString(
  value: Record<string, unknown>,
  paths: readonly (readonly string[])[],
): string | undefined {
  for (const path of paths) {
    const result = readNestedString(value, path)

    if (result !== undefined) {
      return result
    }
  }

  return undefined
}

function readFirstStringField(
  value: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const result = value[field]

    if (typeof result === 'string') {
      return result
    }
  }

  return undefined
}

function readFirstNumberField(
  value: Record<string, unknown>,
  fields: readonly string[],
): number | undefined {
  for (const field of fields) {
    const result = value[field]

    if (typeof result === 'number' && Number.isInteger(result)) {
      return result
    }
  }

  return undefined
}

function firstMatch(
  text: string,
  patterns: readonly RegExp[],
): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text)

    if (match?.[1] !== undefined) {
      return decodeJsonString(match[1])
    }
  }

  return undefined
}

function assignIfPresent(
  key: keyof SessionTokens,
  value: string | null | undefined,
  overwrite = false,
): void {
  if (value === null || value === undefined || value.length === 0) {
    return
  }

  if (tokens[key] === undefined || overwrite) {
    tokens[key] = value
  }
}
