import {
  CACHE_PARSER_VERSION,
  cacheKeyFor,
  debugBadgeLabel,
  formatBadge,
  isRetryablePendingEntry,
  isReusableCacheEntry,
  isTransientResolveError,
  normalizeUsername,
  usernameFromHref,
} from './content-logic'
import { countryToFlag, countryToFlagInfo } from './shared/countries'
import { DEFAULT_SETTINGS, getSettings } from './shared/settings'
import type {
  CountryCacheEntry,
  ResolveCountryResponse,
  Settings,
  UserIdHarvestMessage,
} from './shared/types'

const REQUEST_EVENT = 'threads-country-badge:request'
const RESULT_EVENT = 'threads-country-badge:result'
const USER_ID_EVENT = 'threads-country-badge:user-id'
const DEBUG_EVENT = 'threads-country-badge:debug'
const CONTENT_READY_ATTR = 'data-threads-country-badge-content-ready'
const PROCESSED_ATTR = 'data-threads-country-badge-processed'
const BADGE_ATTR = 'data-threads-country-badge'
const DEBUG_STATS_ATTR = 'data-threads-country-badge-stats'
const SCAN_DEBOUNCE_MS = 500
const RESIZE_REPOSITION_DEBOUNCE_MS = 250
const DEBUG_STATS_RENDER_DEBOUNCE_MS = 100
const MAX_MEMORY_CACHE_ENTRIES = 500
const MAX_USER_ID_ENTRIES = 1_000

interface StorageGetWaiter {
  resolve: (value: Record<string, unknown> | undefined) => void
  reject: (error: unknown) => void
}

interface StorageSetWaiter {
  resolve: () => void
  reject: (error: unknown) => void
}

const inflight = new Map<string, Promise<CountryCacheEntry | undefined>>()
const memoryCache = new Map<string, CountryCacheEntry>()
const flagUrlCache = new Map<string, string>()
const userIds = new Map<string, string>()
const userIdWaiters = new Map<string, Set<(userId: string) => void>>()
const resultWaiters = new Map<
  string,
  (response: ResolveCountryResponse) => void
>()
const pendingBadgeTargets = new Map<string, Set<HTMLAnchorElement>>()
const debugStats = {
  scans: 0,
  profileLinks: 0,
  requested: 0,
  rendered: 0,
  cacheHits: 0,
  cacheMisses: 0,
  userIds: 0,
  lastMessage: 'starting',
  lastError: '',
}
let settings: Settings | undefined
let debugPanel: HTMLDivElement | undefined
let domObserver: MutationObserver | undefined
let debugRenderTimer: number | undefined
let lastDebugStatsJson = ''
let storageGetQueue = new Map<string, Set<StorageGetWaiter>>()
let storageGetScheduled = false
let storageSetQueue: Record<string, CountryCacheEntry> = {}
let storageSetWaiters = new Set<StorageSetWaiter>()
let storageSetScheduled = false
let extensionContextValid = true
let hasCapturedAboutProfileTemplate = false
let lastTemplateRetryAt = 0

if (document.documentElement.getAttribute(CONTENT_READY_ATTR) !== 'true') {
  document.documentElement.setAttribute(CONTENT_READY_ATTR, 'true')
  void init()
}

async function init(): Promise<void> {
  settings = await safeGetSettings()
  bindPageEvents()
  bindStorageEvents()
  bindResizeEvents()
  observeThreadsDom()
  debug('init', `Content script active on ${location.hostname}`)
  scanPage()
}

function bindPageEvents(): void {
  window.addEventListener(RESULT_EVENT, (event) => {
    const detail = getCustomDetail<ResolveCountryResponse>(event)

    if (detail === undefined) {
      return
    }

    const waiter = resultWaiters.get(detail.requestId)

    if (waiter !== undefined) {
      resultWaiters.delete(detail.requestId)
      waiter(detail)
    }

    if (detail.userId !== undefined) {
      rememberUserId(detail.username, detail.userId)
    }

    if (detail.error !== undefined) {
      debugStats.lastError = `@${detail.username}: ${detail.error}`
      debug('resolve-error', debugStats.lastError)
    }

    if (detail.country !== undefined) {
      void applyResolvedCountry(detail).catch((error: unknown) =>
        handleAsyncError('passive-result', detail.username, error),
      )
    }
  })

  window.addEventListener(USER_ID_EVENT, (event) => {
    const detail = getCustomDetail<UserIdHarvestMessage>(event)

    if (detail !== undefined) {
      rememberUserId(detail.username, detail.userId)
    }
  })

  window.addEventListener(DEBUG_EVENT, (event) => {
    const detail = getCustomDetail<{
      source?: string
      stage?: string
      message?: string
    }>(event)

    if (detail?.message !== undefined) {
      debug(
        detail.stage ?? 'page',
        `${detail.source ?? 'page'}: ${detail.message}`,
      )

      if (detail.source === 'injected' && detail.stage === 'bloks-template') {
        hasCapturedAboutProfileTemplate = true
        retryVisibleUnresolvedBadges('captured template')
      }
    }
  })
}

function bindStorageEvents(): void {
  if (!isExtensionContextAvailable()) {
    markExtensionContextInvalid(
      'Cannot bind storage events because the extension context is unavailable',
    )
    return
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionContextAvailable()) {
      markExtensionContextInvalid(
        'Storage changed after extension context was invalidated. Refresh the Threads tab.',
      )
      return
    }

    if (area !== 'sync') {
      return
    }

    const next = {
      ...settings,
      ...Object.fromEntries(
        Object.entries(changes).map(([key, change]) => [key, change.newValue]),
      ),
    }
    settings = next as Settings
    document
      .querySelectorAll(`[${BADGE_ATTR}]`)
      .forEach((node) => node.remove())
    document
      .querySelectorAll(`[${PROCESSED_ATTR}]`)
      .forEach((node) => node.removeAttribute(PROCESSED_ATTR))
    debug('settings', 'Settings changed; rescanning page')
    try {
      scanPage()
    } catch (error) {
      handleAsyncError('scan', 'settings-change', error)
    }
  })
}

function observeThreadsDom(): void {
  domObserver?.disconnect()
  domObserver = new MutationObserver(() => scheduleScan())
  domObserver.observe(document.body, { childList: true, subtree: true })
}

let resizeTimer: number | undefined

function bindResizeEvents(): void {
  window.addEventListener(
    'resize',
    () => {
      if (resizeTimer !== undefined) {
        window.clearTimeout(resizeTimer)
      }

      resizeTimer = window.setTimeout(() => {
        resizeTimer = undefined
        repositionConnectedBadges()
      }, RESIZE_REPOSITION_DEBOUNCE_MS)
    },
    { passive: true },
  )
}

let scanTimer: number | undefined

function scheduleScan(): void {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer)
  }

  scanTimer = window.setTimeout(() => {
    scanTimer = undefined
    scanPage()
  }, SCAN_DEBOUNCE_MS)
}

function scanPage(): void {
  if (!isExtensionContextAvailable()) {
    markExtensionContextInvalid(
      'Extension context invalidated. Refresh the Threads tab after reloading the extension.',
    )
    return
  }

  debugStats.scans += 1
  resetProcessedProfileLinksWithoutBadges()
  const profileLinks = document.querySelectorAll<HTMLAnchorElement>(
    `a[href*="/@"]:not([${PROCESSED_ATTR}])`,
  )
  debugStats.profileLinks = profileLinks.length
  debug('scan', `Found ${profileLinks.length} unprocessed profile links`)

  for (const profileLink of profileLinks) {
    profileLink.setAttribute(PROCESSED_ATTR, 'true')
    const username = usernameFromHref(profileLink.getAttribute('href'))

    if (
      username === undefined ||
      !isLikelyAuthorLink(profileLink, username) ||
      hasNearbyBadge(profileLink, username)
    ) {
      debug(
        'scan-skip',
        `Skipped profile link: ${profileLink.getAttribute('href') ?? 'missing href'}`,
      )
      continue
    }

    debug('scan-hit', `Queueing @${username}`)
    void addBadge(profileLink, username).catch((error: unknown) =>
      handleAsyncError('badge', username, error),
    )
  }

  if (
    hasCapturedAboutProfileTemplate &&
    Date.now() - lastTemplateRetryAt > 5_000
  ) {
    retryVisibleUnresolvedBadges('scan with captured template')
  }
}

function resetProcessedProfileLinksWithoutBadges(): void {
  document
    .querySelectorAll<HTMLAnchorElement>(`a[href*="/@"][${PROCESSED_ATTR}]`)
    .forEach((profileLink) => {
      const username = usernameFromHref(profileLink.getAttribute('href'))

      if (
        username !== undefined &&
        isLikelyAuthorLink(profileLink, username) &&
        !hasNearbyBadge(profileLink, username)
      ) {
        profileLink.removeAttribute(PROCESSED_ATTR)
      }
    })
}

function repositionConnectedBadges(): void {
  document
    .querySelectorAll<HTMLSpanElement>(`[${BADGE_ATTR}]`)
    .forEach((badge) => {
      const username = badge.getAttribute(BADGE_ATTR)
      const profileLink = badge.closest<HTMLAnchorElement>('a[href*="/@"]')

      if (
        username !== null &&
        profileLink !== null &&
        profileLink.isConnected
      ) {
        placeBadgeElement(profileLink, username, badge)
      }
    })
}

async function addBadge(
  profileLink: HTMLAnchorElement,
  username: string,
): Promise<void> {
  debugStats.requested += 1
  debug('badge-start', `Resolving @${username}`)
  const placeholder = ensureBadgeElement(profileLink, username)
  const cacheEntry = await getCountry(username)
  const activeSettings = settings ?? (await safeGetSettings())

  if (
    cacheEntry === undefined ||
    (cacheEntry.country === undefined && !activeSettings.showUnknown)
  ) {
    if (cacheEntry?.status === 'miss') {
      placeholder.remove()
      forgetPendingBadge(username, profileLink)
      debug('badge-hidden', `@${username}: country unavailable`)
      return
    }

    rememberPendingBadge(username, profileLink)
    updateBadgeElement(placeholder, username, cacheEntry, activeSettings)
    debug(
      'badge-skip',
      `@${username}: ${cacheEntry?.error ?? 'country unavailable and showUnknown=false'}`,
    )
    return
  }

  if (!renderBadgeContent(placeholder, cacheEntry, activeSettings)) {
    updateBadgeElement(placeholder, username, cacheEntry, activeSettings)
    debug('badge-skip', `@${username}: no renderable label`)
    return
  }

  placeholder.title =
    cacheEntry.country === undefined
      ? 'Country not available'
      : `Based in ${cacheEntry.country}`
  placeholder.style.display = 'inline-flex'
  placeholder.style.opacity = '1'
  forgetPendingBadge(username, profileLink)
  debugStats.rendered += 1
  debug(
    'badge-rendered',
    `@${username}: ${formatBadge(cacheEntry, activeSettings) ?? cacheEntry.country ?? 'unknown'}`,
  )
}

function ensureBadgeElement(
  profileLink: HTMLAnchorElement,
  username: string,
): HTMLSpanElement {
  const existing = profileLink.querySelector<HTMLSpanElement>(`[${BADGE_ATTR}]`)

  if (existing !== null && existing.getAttribute(BADGE_ATTR) === username) {
    placeBadgeElement(profileLink, username, existing)
    return existing
  }

  const badge = document.createElement('span')
  badge.setAttribute(BADGE_ATTR, username)
  badge.className = 'threads-country-badge'
  badge.textContent = '…'
  badge.title = `Resolving country for @${username}`
  badge.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'flex:0 0 auto',
    'font-size:0.95em',
    'line-height:1',
    'vertical-align:middle',
    'white-space:nowrap',
    'user-select:none',
    'opacity:.65',
  ].join(';')

  placeBadgeElement(profileLink, username, badge)

  return badge
}

function placeBadgeElement(
  profileLink: HTMLAnchorElement,
  username: string,
  badge: HTMLSpanElement,
): void {
  if (!profileLink.isConnected) {
    return
  }

  const host = findInlineBadgeHost(profileLink, username)
  profileLink.style.whiteSpace = 'nowrap'
  host.style.display = 'inline-flex'
  host.style.alignItems = 'center'
  host.style.gap = '4px'
  host.style.whiteSpace = 'nowrap'

  if (badge.parentElement !== host) {
    host.append(badge)
  }
}

function findInlineBadgeHost(
  profileLink: HTMLAnchorElement,
  username: string,
): HTMLElement {
  const normalizedUsername = normalizeUsername(username)
  const headings = profileLink.querySelectorAll<HTMLElement>(
    "h1,h2,h3,[role='heading']",
  )
  let partialMatch: HTMLElement | undefined

  for (const heading of headings) {
    const text = heading.textContent ?? ''

    if (normalizeUsername(text.trim()) === normalizedUsername) {
      return heading
    }

    if (partialMatch === undefined && text.includes(username)) {
      partialMatch = heading
    }
  }

  if (partialMatch !== undefined) {
    return partialMatch
  }

  const textHost = findUsernameTextHost(profileLink, normalizedUsername)

  if (textHost !== undefined) {
    return textHost
  }

  return profileLink
}

function findUsernameTextHost(
  profileLink: HTMLAnchorElement,
  normalizedUsername: string,
): HTMLElement | undefined {
  let candidate: HTMLElement | undefined

  for (const element of profileLink.querySelectorAll<HTMLElement>(
    'span,div,strong,b',
  )) {
    if (
      element.hasAttribute(BADGE_ATTR) ||
      element.querySelector(`[${BADGE_ATTR}]`) !== null
    ) {
      continue
    }

    if (
      normalizeUsername(element.textContent?.trim() ?? '') ===
      normalizedUsername
    ) {
      candidate = element
    }
  }

  return candidate
}

function updateBadgeElement(
  badge: HTMLSpanElement,
  username: string,
  cacheEntry: CountryCacheEntry | undefined,
  activeSettings: Settings,
): void {
  if (cacheEntry?.country !== undefined || activeSettings.showUnknown) {
    const label =
      cacheEntry === undefined
        ? undefined
        : formatBadge(cacheEntry, activeSettings)

    if (label !== undefined && cacheEntry !== undefined) {
      renderBadgeContent(badge, cacheEntry, activeSettings)
      badge.title =
        cacheEntry?.country === undefined
          ? 'Country not available'
          : `Based in ${cacheEntry.country}`
      badge.style.display = 'inline-flex'
      badge.style.opacity = '1'
      return
    }
  }

  if (cacheEntry === undefined || isRetryablePendingEntry(cacheEntry)) {
    badge.textContent = '…'
    badge.title = `Resolving country for @${username}`
    badge.style.display = 'inline-flex'
    badge.style.opacity = '.65'
    return
  }

  const error = cacheEntry.error ?? 'country unavailable'
  badge.textContent = activeSettings.debugShowOverlay
    ? debugBadgeLabel(error)
    : '?'
  badge.title = `@${username}: ${error}`
  badge.style.display = 'inline-flex'
  badge.style.opacity = '.75'
}

function renderBadgeContent(
  badge: HTMLSpanElement,
  cacheEntry: CountryCacheEntry,
  activeSettings: Settings,
): boolean {
  if (cacheEntry.country === undefined) {
    const unknownLabel = activeSettings.showUnknown ? '(?)' : undefined

    if (unknownLabel === undefined) {
      return false
    }

    badge.textContent = unknownLabel
    return true
  }

  if (activeSettings.badgeMode === 'country') {
    badge.textContent = `(${cacheEntry.country})`
    return true
  }

  const flagInfo = countryToFlagInfo(cacheEntry.country)

  if (flagInfo === undefined) {
    badge.textContent = `(${cacheEntry.country})`
    return true
  }

  const flagUrl = getFlagUrl(flagInfo.iso)
  const existingFlag = badge.querySelector<HTMLImageElement>('img')

  if (existingFlag === null) {
    badge.textContent = ''
    badge.append(createFlagImage(flagUrl, cacheEntry.country))
  } else {
    existingFlag.alt = cacheEntry.country

    if (existingFlag.src !== flagUrl) {
      existingFlag.src = flagUrl
    }

    let node = badge.firstChild

    while (node !== null) {
      const next = node.nextSibling

      if (node !== existingFlag) {
        node.remove()
      }

      node = next
    }
  }

  if (activeSettings.badgeMode === 'both') {
    badge.append(document.createTextNode(` (${cacheEntry.country})`))
  }

  return true
}

function createFlagImage(src: string, country: string): HTMLImageElement {
  const image = document.createElement('img')
  image.src = src
  image.alt = country
  image.decoding = 'async'
  image.loading = 'lazy'
  image.style.cssText = [
    'width:1.15em',
    'height:.86em',
    'display:inline-block',
    'object-fit:cover',
    'border-radius:2px',
    'box-shadow:0 0 0 0.5px rgba(255,255,255,.35)',
  ].join(';')

  return image
}

function getFlagUrl(iso: string): string {
  const cached = flagUrlCache.get(iso)

  if (cached !== undefined) {
    return cached
  }

  const url = chrome.runtime.getURL(`flags/${iso}.svg`)
  flagUrlCache.set(iso, url)

  return url
}

async function getCountry(
  username: string,
): Promise<CountryCacheEntry | undefined> {
  if (!isExtensionContextAvailable()) {
    markExtensionContextInvalid(
      'Cannot read profile cache because the extension context is unavailable',
    )
    return undefined
  }

  const normalized = normalizeUsername(username)
  const cacheKey = cacheKeyFor(normalized)
  const memoryEntry = memoryCache.get(normalized)

  if (memoryEntry !== undefined && isReusableCacheEntry(memoryEntry)) {
    debugStats.cacheHits += 1
    debug(
      'memory-cache-hit',
      `@${normalized}: ${memoryEntry.country ?? memoryEntry.error ?? 'miss cached'}`,
    )
    return memoryEntry
  }

  const cached = await safeStorageGet(cacheKey)

  if (cached === undefined) {
    return undefined
  }

  const cacheEntry = cached[cacheKey] as CountryCacheEntry | undefined

  if (cacheEntry !== undefined && cacheEntry.expiresAt > Date.now()) {
    if (cacheEntry.parserVersion !== CACHE_PARSER_VERSION) {
      debugStats.cacheMisses += 1
      debug(
        'cache-stale',
        `@${normalized}: parser version ${cacheEntry.parserVersion ?? 'none'}`,
      )
    } else if (
      cacheEntry.error !== undefined &&
      isTransientResolveError(cacheEntry.error)
    ) {
      debugStats.cacheMisses += 1
      debug('cache-skip-transient', `@${normalized}: ${cacheEntry.error}`)
    } else {
      rememberMemoryCache(normalized, cacheEntry)
      debugStats.cacheHits += 1
      debug(
        'cache-hit',
        `@${normalized}: ${cacheEntry.country ?? cacheEntry.error ?? 'miss cached'}`,
      )
      return cacheEntry
    }
  }

  debugStats.cacheMisses += 1
  debug('cache-miss', `@${normalized}`)

  const existing = inflight.get(normalized)

  if (existing !== undefined) {
    return existing
  }

  const request = resolveCountry(normalized).finally(() =>
    inflight.delete(normalized),
  )
  inflight.set(normalized, request)

  return request
}

async function resolveCountry(
  username: string,
): Promise<CountryCacheEntry | undefined> {
  const requestId = crypto.randomUUID()
  const response = await requestFromPage(username, requestId)

  if (response.error !== undefined && isTransientResolveError(response.error)) {
    debug('resolve-transient', `@${username}: ${response.error}`)
    const transientEntry = buildTransientEntry(username, response)
    rememberMemoryCache(username, transientEntry)
    return transientEntry
  }

  const activeSettings = settings ?? (await safeGetSettings())
  const now = Date.now()
  const country = response.country?.trim()
  const status = country === undefined || country.length === 0 ? 'miss' : 'hit'
  const ttl =
    status === 'hit'
      ? activeSettings.cacheSuccessDays * 24 * 60 * 60 * 1000
      : activeSettings.cacheMissHours * 60 * 60 * 1000
  const resolvedUserId = response.userId ?? userIds.get(username)
  const entry: CountryCacheEntry = {
    username,
    parserVersion: CACHE_PARSER_VERSION,
    fetchedAt: now,
    expiresAt: now + ttl,
    status,
  }

  if (resolvedUserId !== undefined) {
    entry.userId = resolvedUserId
  }

  if (country !== undefined && country.length > 0) {
    entry.country = country
    const flag = countryToFlag(country)

    if (flag !== undefined) {
      entry.flag = flag
    }
  }

  if (response.error !== undefined) {
    entry.error = response.error
  }

  await safeStorageSet({ [cacheKeyFor(username)]: entry })
  rememberMemoryCache(username, entry)

  return entry
}

async function requestFromPage(
  username: string,
  requestId: string,
): Promise<ResolveCountryResponse> {
  const knownUserId = await waitForUserId(username, 2_000)

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      resultWaiters.delete(requestId)
      debugStats.lastError = `@${username}: request timed out`
      debug('request-timeout', debugStats.lastError)
      resolve({
        type: 'THREADS_COUNTRY_BADGE_RESULT',
        requestId,
        username,
        error: 'Timed out waiting for Threads profile data',
      })
    }, 12_000)

    resultWaiters.set(requestId, (detail) => {
      window.clearTimeout(timeout)
      resolve(detail)
    })

    debug(
      'request',
      `Dispatching request for @${username}; knownUserId=${knownUserId ?? 'none'}`,
    )
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: {
          requestId,
          username,
          knownUserId,
          allowTemplateReplay: settings?.useTemplateReplay !== false,
          allowFallbackConstruction: true,
        },
      }),
    )
  })
}

function waitForUserId(
  username: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const normalized = normalizeUsername(username)
  const existing = userIds.get(normalized)

  if (existing !== undefined) {
    return Promise.resolve(existing)
  }

  return new Promise((resolve) => {
    let waiters = userIdWaiters.get(normalized)

    if (waiters === undefined) {
      waiters = new Set<(userId: string) => void>()
      userIdWaiters.set(normalized, waiters)
    }

    const timeout = window.setTimeout(() => {
      waiters.delete(resolveUserId)

      if (waiters.size === 0) {
        userIdWaiters.delete(normalized)
      }

      resolve(userIds.get(normalized))
    }, timeoutMs)

    function resolveUserId(userId: string): void {
      window.clearTimeout(timeout)
      resolve(userId)
    }

    waiters.add(resolveUserId)
  })
}

function rememberUserId(username: string, userId: string): void {
  const normalized = normalizeUsername(username)

  if (!userIds.has(normalized) && userIds.size >= MAX_USER_ID_ENTRIES) {
    const oldest = userIds.keys().next().value as string | undefined

    if (oldest !== undefined) {
      userIds.delete(oldest)
    }
  }

  userIds.set(normalized, userId)
  debugStats.userIds = userIds.size
  debug('user-id', `@${normalized} → ${userId}`)

  const waiters = userIdWaiters.get(normalized)

  if (waiters !== undefined) {
    userIdWaiters.delete(normalized)

    for (const resolve of waiters) {
      resolve(userId)
    }
  }

  retryPendingBadges(normalized)
}

function isLikelyAuthorLink(
  profileLink: HTMLAnchorElement,
  username: string,
): boolean {
  if (
    profileLink.closest(
      'nav, aside, [role="navigation"], [role="tablist"], [role="menu"], [role="menubar"]',
    ) !== null
  ) {
    return false
  }

  if (/\/post\//.test(profileLink.getAttribute('href') ?? '')) {
    return false
  }

  const text =
    profileLink.textContent
      ?.normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '')
      .trim() ?? ''
  const compactUsername = username.toLowerCase().replace(/\./g, '')

  if (text.length === 0) {
    return false
  }

  return (
    text.includes(username) ||
    text.includes(compactUsername) ||
    username.includes(text)
  )
}

function hasNearbyBadge(
  profileLink: HTMLAnchorElement,
  username: string,
): boolean {
  const selector = `[${BADGE_ATTR}="${normalizeUsername(username)}"]`

  return (
    profileLink.querySelector(selector) !== null ||
    profileLink.parentElement?.querySelector(selector) !== null
  )
}

function rememberPendingBadge(
  username: string,
  profileLink: HTMLAnchorElement,
): void {
  if (userIds.has(username) || !profileLink.isConnected) {
    return
  }

  const existing =
    pendingBadgeTargets.get(username) ?? new Set<HTMLAnchorElement>()
  existing.add(profileLink)
  pendingBadgeTargets.set(username, existing)
  debug(
    'pending',
    `@${username}: waiting for user id (${existing.size} target${existing.size === 1 ? '' : 's'})`,
  )
}

function forgetPendingBadge(
  username: string,
  profileLink: HTMLAnchorElement,
): void {
  const existing = pendingBadgeTargets.get(username)

  if (existing === undefined) {
    return
  }

  existing.delete(profileLink)

  if (existing.size === 0) {
    pendingBadgeTargets.delete(username)
  }
}

function retryPendingBadges(username: string): void {
  const targets = pendingBadgeTargets.get(username)

  if (targets === undefined) {
    return
  }

  pendingBadgeTargets.delete(username)
  debug(
    'pending-retry',
    `@${username}: retrying ${targets.size} target${targets.size === 1 ? '' : 's'}`,
  )

  for (const target of targets) {
    if (target.isConnected) {
      void addBadge(target, username).catch((error: unknown) =>
        handleAsyncError('pending-retry', username, error),
      )
    }
  }
}

function retryVisibleUnresolvedBadges(reason: string): void {
  const targets = new Map<string, HTMLAnchorElement>()
  lastTemplateRetryAt = Date.now()

  document
    .querySelectorAll<HTMLSpanElement>(`[${BADGE_ATTR}]`)
    .forEach((badge) => {
      const username = badge.getAttribute(BADGE_ATTR)
      const title = badge.getAttribute('title') ?? ''
      const text = badge.textContent?.trim()
      const isUnresolved =
        text === '…' ||
        text === '?' ||
        title.includes('No captured profile template') ||
        title.includes('country unavailable')
      const profileLink = badge.closest<HTMLAnchorElement>('a[href*="/@"]')

      if (
        username !== null &&
        isUnresolved &&
        profileLink !== null &&
        profileLink.isConnected
      ) {
        targets.set(username, profileLink)
      }
    })

  if (targets.size === 0) {
    return
  }

  debug(
    'pending-retry',
    `Retrying ${targets.size} unresolved badge${targets.size === 1 ? '' : 's'} after ${reason}`,
  )

  for (const [username, profileLink] of targets) {
    void addBadge(profileLink, username).catch((error: unknown) =>
      handleAsyncError('pending-retry', username, error),
    )
  }
}

function refreshExistingBadges(
  username: string,
  cacheEntry: CountryCacheEntry,
  activeSettings: Settings,
): void {
  let refreshed = 0

  document
    .querySelectorAll<HTMLSpanElement>(`[${BADGE_ATTR}="${username}"]`)
    .forEach((badge) => {
      const profileLink = badge.closest<HTMLAnchorElement>('a[href*="/@"]')

      if (profileLink !== null) {
        placeBadgeElement(profileLink, username, badge)
      }

      if (renderBadgeContent(badge, cacheEntry, activeSettings)) {
        badge.title =
          cacheEntry.country === undefined
            ? 'Country not available'
            : `Based in ${cacheEntry.country}`
        badge.style.display = 'inline-flex'
        badge.style.opacity = '1'
        refreshed += 1
      }
    })

  if (refreshed > 0) {
    debug(
      'badge-refresh',
      `@${username}: refreshed ${refreshed} existing badge${refreshed === 1 ? '' : 's'}`,
    )
  }
}

function buildTransientEntry(
  username: string,
  response: ResolveCountryResponse,
): CountryCacheEntry {
  const now = Date.now()
  const entry: CountryCacheEntry = {
    username,
    parserVersion: CACHE_PARSER_VERSION,
    fetchedAt: now,
    expiresAt: now,
    status: 'error',
  }

  if (response.userId !== undefined) {
    entry.userId = response.userId
  }

  if (response.error !== undefined) {
    entry.error = response.error
  }

  return entry
}

async function applyResolvedCountry(
  response: ResolveCountryResponse,
): Promise<void> {
  const username = normalizeUsername(response.username)
  const country = response.country?.trim()

  if (username.length === 0 || country === undefined || country.length === 0) {
    return
  }

  const activeSettings = settings ?? (await safeGetSettings())
  const now = Date.now()
  const entry: CountryCacheEntry = {
    username,
    parserVersion: CACHE_PARSER_VERSION,
    fetchedAt: now,
    expiresAt: now + activeSettings.cacheSuccessDays * 24 * 60 * 60 * 1000,
    status: 'hit',
    country,
  }
  const flag = countryToFlag(country)

  if (response.userId !== undefined) {
    entry.userId = response.userId
  }

  if (flag !== undefined) {
    entry.flag = flag
  }

  if (response.requestId.startsWith('passive_')) {
    await safeStorageSet({ [cacheKeyFor(username)]: entry })
  }

  rememberMemoryCache(username, entry)
  debug('passive-cache', `@${username}: ${country}`)
  hasCapturedAboutProfileTemplate = true
  refreshExistingBadges(username, entry, activeSettings)
  retryPendingBadges(username)
  retryVisibleUnresolvedBadges('passive country cache')
}

function rememberMemoryCache(
  username: string,
  cacheEntry: CountryCacheEntry,
): void {
  if (
    !memoryCache.has(username) &&
    memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES
  ) {
    const oldest = memoryCache.keys().next().value as string | undefined

    if (oldest !== undefined) {
      memoryCache.delete(oldest)
    }
  }

  memoryCache.set(username, cacheEntry)
}

function getCustomDetail<T>(event: Event): T | undefined {
  if (!(event instanceof CustomEvent)) {
    return undefined
  }

  return event.detail as T
}

function debug(stage: string, message: string): void {
  debugStats.lastMessage = `${stage}: ${message}`

  if (settings?.debugMode === true) {
    console.info(`[Threads Country Badge:${stage}] ${message}`)
  }

  scheduleDebugRender()
}

async function safeGetSettings(): Promise<Settings> {
  if (!isExtensionContextAvailable()) {
    markExtensionContextInvalid(
      'Cannot read settings because the extension context is unavailable',
    )
    return settings ?? DEFAULT_SETTINGS
  }

  try {
    return await getSettings()
  } catch (error) {
    if (isExtensionContextError(error)) {
      markExtensionContextInvalid(
        'Cannot read settings because the extension context was invalidated',
      )
      return settings ?? DEFAULT_SETTINGS
    }

    throw error
  }
}

async function safeStorageGet(
  key: string,
): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    let waiters = storageGetQueue.get(key)

    if (waiters === undefined) {
      waiters = new Set<StorageGetWaiter>()
      storageGetQueue.set(key, waiters)
    }

    waiters.add({ resolve, reject })

    if (!storageGetScheduled) {
      storageGetScheduled = true
      queueMicrotask(() => {
        void flushStorageGetQueue()
      })
    }
  })
}

async function flushStorageGetQueue(): Promise<void> {
  const queued = storageGetQueue
  storageGetQueue = new Map()
  storageGetScheduled = false

  if (queued.size === 0) {
    return
  }

  try {
    const values = (await chrome.storage.local.get([
      ...queued.keys(),
    ])) as Record<string, unknown>

    for (const [key, waiters] of queued) {
      const result: Record<string, unknown> = {}

      if (Object.prototype.hasOwnProperty.call(values, key)) {
        result[key] = values[key]
      }

      for (const waiter of waiters) {
        waiter.resolve(result)
      }
    }
  } catch (error) {
    if (isExtensionContextError(error)) {
      markExtensionContextInvalid(
        'Extension context invalidated while reading cache. Refresh the Threads tab.',
      )

      for (const waiters of queued.values()) {
        for (const waiter of waiters) {
          waiter.resolve(undefined)
        }
      }

      return
    }

    for (const waiters of queued.values()) {
      for (const waiter of waiters) {
        waiter.reject(error)
      }
    }
  }
}

async function safeStorageSet(
  value: Record<string, CountryCacheEntry>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    Object.assign(storageSetQueue, value)
    storageSetWaiters.add({ resolve, reject })

    if (!storageSetScheduled) {
      storageSetScheduled = true
      queueMicrotask(() => {
        void flushStorageSetQueue()
      })
    }
  })
}

async function flushStorageSetQueue(): Promise<void> {
  const queued = storageSetQueue
  const waiters = storageSetWaiters
  storageSetQueue = {}
  storageSetWaiters = new Set()
  storageSetScheduled = false

  if (Object.keys(queued).length === 0) {
    for (const waiter of waiters) {
      waiter.resolve()
    }

    return
  }

  try {
    await chrome.storage.local.set(queued)

    for (const waiter of waiters) {
      waiter.resolve()
    }
  } catch (error) {
    if (isExtensionContextError(error)) {
      markExtensionContextInvalid(
        'Extension context invalidated while writing cache. Refresh the Threads tab.',
      )

      for (const waiter of waiters) {
        waiter.resolve()
      }

      return
    }

    for (const waiter of waiters) {
      waiter.reject(error)
    }
  }
}

function handleAsyncError(
  stage: string,
  username: string,
  error: unknown,
): void {
  if (isExtensionContextError(error)) {
    markExtensionContextInvalid(
      `Extension context invalidated while processing @${username}. Refresh the Threads tab.`,
    )
    return
  }

  debugStats.lastError = `@${username}: ${error instanceof Error ? error.message : String(error)}`
  debug(`${stage}-error`, debugStats.lastError)
}

function isExtensionContextAvailable(): boolean {
  return (
    extensionContextValid &&
    typeof chrome !== 'undefined' &&
    chrome.runtime?.id !== undefined
  )
}

function markExtensionContextInvalid(message: string): void {
  extensionContextValid = false
  debugStats.lastError = message
  debug('extension-context-invalid', message)
}

function isExtensionContextError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('Extension context invalidated')
  )
}

function renderDebugPanel(): void {
  const statsJson = JSON.stringify(debugStats)

  if (statsJson !== lastDebugStatsJson) {
    document.documentElement.setAttribute(DEBUG_STATS_ATTR, statsJson)
    lastDebugStatsJson = statsJson
  }

  if (settings?.debugShowOverlay !== true) {
    debugPanel?.remove()
    debugPanel = undefined
    return
  }

  if (debugPanel === undefined) {
    debugPanel = document.createElement('div')
    debugPanel.id = 'threads-country-badge-debug'
    debugPanel.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'max-width:360px',
      'padding:10px 12px',
      'border:1px solid rgba(255,255,255,.2)',
      'border-radius:12px',
      'background:rgba(18,18,18,.92)',
      'color:#fff',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
      'pointer-events:none',
      'white-space:pre-wrap',
    ].join(';')
    document.documentElement.append(debugPanel)
  }

  debugPanel.textContent = [
    'Threads Country Badge DEBUG',
    `host: ${location.hostname}`,
    `scans: ${debugStats.scans} | links: ${debugStats.profileLinks}`,
    `requests: ${debugStats.requested} | rendered: ${debugStats.rendered}`,
    `cache hit/miss: ${debugStats.cacheHits}/${debugStats.cacheMisses}`,
    `userIds: ${debugStats.userIds}`,
    `last: ${debugStats.lastMessage}`,
    debugStats.lastError.length > 0
      ? `error: ${debugStats.lastError}`
      : 'error: -',
  ].join('\n')
}

function scheduleDebugRender(): void {
  if (debugRenderTimer !== undefined) {
    return
  }

  debugRenderTimer = window.setTimeout(() => {
    debugRenderTimer = undefined
    renderDebugPanel()
  }, DEBUG_STATS_RENDER_DEBOUNCE_MS)
}
