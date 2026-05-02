import { describe, expect, test } from 'bun:test'

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
} from '../content-logic'
import { DEFAULT_SETTINGS } from '../shared/settings'
import type { CountryCacheEntry } from '../shared/types'

function entry(overrides: Partial<CountryCacheEntry>): CountryCacheEntry {
  return {
    username: 'alice',
    parserVersion: CACHE_PARSER_VERSION,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + 10_000,
    status: 'hit',
    ...overrides,
  }
}

describe('content logic', () => {
  test('normalizes usernames and profile hrefs', () => {
    expect(normalizeUsername('@Alice')).toBe('alice')
    expect(usernameFromHref(null)).toBeUndefined()
    expect(usernameFromHref('/@Alice.Post?x=1')).toBe('alice.post')
    expect(usernameFromHref('https://www.threads.net/@Bob#top')).toBe('bob')
    expect(usernameFromHref('/not-profile')).toBeUndefined()
  })

  test('formats badges for flag, country, both, and unknown modes', () => {
    expect(formatBadge(entry({ country: '대한민국' }), DEFAULT_SETTINGS)).toBe(
      '🇰🇷',
    )
    expect(
      formatBadge(entry({ country: 'Atlantis' }), {
        ...DEFAULT_SETTINGS,
        badgeMode: 'both',
      }),
    ).toBe('(Atlantis)')
    expect(
      formatBadge(entry({ country: '대한민국' }), {
        ...DEFAULT_SETTINGS,
        badgeMode: 'both',
      }),
    ).toBe('🇰🇷 (대한민국)')
    expect(
      formatBadge(entry({ country: '미국' }), {
        ...DEFAULT_SETTINGS,
        badgeMode: 'country',
      }),
    ).toBe('(미국)')
    expect(
      formatBadge(entry({ status: 'miss' }), DEFAULT_SETTINGS),
    ).toBeUndefined()
    expect(
      formatBadge(entry({ status: 'miss' }), {
        ...DEFAULT_SETTINGS,
        showUnknown: true,
      }),
    ).toBe('(?)')
  })

  test('classifies cache and retry states', () => {
    expect(isReusableCacheEntry(entry({ country: '대한민국' }))).toBe(true)
    expect(
      isReusableCacheEntry(
        entry({ error: 'User ID not discovered yet', status: 'error' }),
      ),
    ).toBe(false)
    expect(isTransientResolveError('Failed to fetch')).toBe(true)
    expect(isTransientResolveError('Permanent country miss')).toBe(false)
    expect(isRetryablePendingEntry(entry({ error: 'Failed to fetch' }))).toBe(
      true,
    )
  })

  test('creates cache keys and debug badge labels', () => {
    expect(cacheKeyFor('alice')).toBe('profile:alice')
    expect(debugBadgeLabel('User ID not discovered yet')).toBe('ID?')
    expect(debugBadgeLabel('Threads rate limit reached')).toBe('API?')
    expect(debugBadgeLabel('session token not discovered yet')).toBe('API?')
    expect(debugBadgeLabel('Country missing')).toBe('?')
  })
})
