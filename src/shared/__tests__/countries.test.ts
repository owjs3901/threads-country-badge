import { describe, expect, test } from 'bun:test'

import { countryToFlag, countryToFlagInfo } from '../countries'

describe('country lookup', () => {
  test('returns flag and ISO info for exact aliases', () => {
    expect(countryToFlag('대한민국')).toBe('🇰🇷')
    expect(countryToFlagInfo('u.s.a.')).toEqual({ flag: '🇺🇸', iso: 'us' })
  })

  test('normalizes case, full-width text, brackets, and whitespace', () => {
    expect(countryToFlagInfo('  (ＵＳＡ)  ')).toEqual({ flag: '🇺🇸', iso: 'us' })
    expect(countryToFlagInfo('[ south   korea ]')).toEqual({
      flag: '🇰🇷',
      iso: 'kr',
    })
  })

  test('matches useful partial country phrases in either direction', () => {
    expect(countryToFlagInfo('based in the united states')).toEqual({
      flag: '🇺🇸',
      iso: 'us',
    })
    expect(countryToFlagInfo('korea')).toEqual({ flag: '🇰🇷', iso: 'kr' })
  })

  test('returns undefined for unknown countries', () => {
    expect(countryToFlag('atlantis')).toBeUndefined()
    expect(countryToFlagInfo('')).toBeUndefined()
  })
})
