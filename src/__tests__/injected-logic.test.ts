import { describe, expect, test } from 'bun:test'

import {
  decodeEscapedUnicode,
  decodeJsonString,
  extractHandleFromDisplayName,
  extractUserIdFromProfileHtml,
  isAboutProfileCountryKey,
  isHiddenCountryValue,
  isLabelTextStyle,
  isLocationLabel,
  isUsefulCountryCandidate,
  isUsefulUsernameCandidate,
  isValueTextStyle,
  normalizeUsername,
  parseMaybeJson,
  stripJsonProtectionPrefix,
} from '../injected-logic'

describe('injected parsing logic', () => {
  test('normalizes and validates usernames', () => {
    expect(normalizeUsername('@Alice.Name')).toBe('alice.name')
    expect(isUsefulUsernameCandidate('alice.name')).toBe(true)
    expect(isUsefulUsernameCandidate('12345')).toBe(false)
    expect(extractHandleFromDisplayName('Alice (@Alice.Name)')).toBe(
      'alice.name',
    )
    expect(extractHandleFromDisplayName('Alice')).toBeUndefined()
  })

  test('extracts user ids from encoded and plain profile html', () => {
    expect(extractUserIdFromProfileHtml('{"user_id":"12345"}')).toBe('12345')
    expect(
      extractUserIdFromProfileHtml('\\"props\\":{\\"user_id\\":\\"67890\\"}'),
    ).toBe('67890')
    expect(extractUserIdFromProfileHtml('{"name":"alice"}')).toBeUndefined()
  })

  test('classifies country candidates and labels', () => {
    expect(isHiddenCountryValue('Not shared')).toBe(true)
    expect(isUsefulCountryCandidate('대한민국')).toBe(true)
    expect(isUsefulCountryCandidate('Not shared')).toBe(false)
    expect(isUsefulCountryCandidate('')).toBe(false)
    expect(isUsefulCountryCandidate('a'.repeat(81))).toBe(false)
    expect(isUsefulCountryCandidate('text')).toBe(false)
    expect(isUsefulCountryCandidate('https://threads.com')).toBe(false)
    expect(isUsefulCountryCandidate('2024-01-01T00:00:00')).toBe(false)
    expect(isUsefulCountryCandidate('abc12345')).toBe(false)
    expect(isAboutProfileCountryKey('x.about_this_profile_country')).toBe(true)
    expect(isLocationLabel('Based in:')).toBe(true)
    expect(isLabelTextStyle('TextSemibold')).toBe(true)
    expect(isValueTextStyle('BodyRegular')).toBe(true)
  })

  test('decodes escaped strings and JSON protection prefixes', () => {
    expect(decodeEscapedUnicode('\\uB300\\uD55C\\uBBFC\\uAD6D')).toBe(
      '대한민국',
    )
    expect(decodeJsonString('Korea\\nUS')).toBe('Korea\nUS')
    expect(decodeJsonString('broken\\x')).toBe('broken\\x')
    expect(stripJsonProtectionPrefix('for (;;);{"ok":true}')).toBe(
      '{"ok":true}',
    )
    expect(parseMaybeJson('while(1);{"ok":true}')).toEqual({ ok: true })
  })
})
