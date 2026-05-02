import { countryToFlag } from './shared/countries'
import type { CountryCacheEntry, Settings } from './shared/types'

export const CACHE_PARSER_VERSION = 2

export function normalizeUsername(username: string): string {
  return username.replace(/^@/, '').toLowerCase()
}

export function cacheKeyFor(username: string): string {
  return `profile:${username}`
}

export function usernameFromHref(href: string | null): string | undefined {
  if (href === null) {
    return undefined
  }

  const match =
    /(?:^|https?:\/\/(?:www\.)?threads\.(?:com|net))\/@([\w.]+)(?:[/?#]|$)/.exec(
      href,
    )

  return match?.[1] === undefined ? undefined : normalizeUsername(match[1])
}

export function isTransientResolveError(error: string): boolean {
  return (
    error.includes('User ID not discovered yet') ||
    error.includes('session token not discovered yet') ||
    error.includes('No captured profile template yet') ||
    error.includes('Timed out waiting') ||
    error.includes('Failed to fetch')
  )
}

export function isRetryablePendingEntry(
  cacheEntry: CountryCacheEntry,
): boolean {
  return (
    cacheEntry.error !== undefined && isTransientResolveError(cacheEntry.error)
  )
}

export function isReusableCacheEntry(cacheEntry: CountryCacheEntry): boolean {
  return (
    cacheEntry.expiresAt > Date.now() &&
    cacheEntry.parserVersion === CACHE_PARSER_VERSION &&
    (cacheEntry.error === undefined ||
      !isTransientResolveError(cacheEntry.error))
  )
}

export function debugBadgeLabel(error: string): string {
  if (error.includes('User ID')) {
    return 'ID?'
  }

  if (
    error.includes('token') ||
    error.includes('profile country request failed') ||
    error.includes('rate limit')
  ) {
    return 'API?'
  }

  return '?'
}

export function formatBadge(
  cacheEntry: CountryCacheEntry,
  activeSettings: Settings,
): string | undefined {
  if (cacheEntry.country === undefined) {
    return activeSettings.showUnknown ? '(?)' : undefined
  }

  const flag = cacheEntry.flag ?? countryToFlag(cacheEntry.country)

  if (activeSettings.badgeMode === 'country') {
    return `(${cacheEntry.country})`
  }

  if (activeSettings.badgeMode === 'both') {
    return flag === undefined
      ? `(${cacheEntry.country})`
      : `${flag} (${cacheEntry.country})`
  }

  return flag ?? `(${cacheEntry.country})`
}
