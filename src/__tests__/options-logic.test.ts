import { describe, expect, test } from 'bun:test'

import { toBadgeMode, toPositiveInteger } from '../options-logic'

describe('options logic', () => {
  test('coerces badge mode values', () => {
    expect(toBadgeMode('country')).toBe('country')
    expect(toBadgeMode('both')).toBe('both')
    expect(toBadgeMode('invalid')).toBe('flag')
  })

  test('parses positive integer settings with fallback', () => {
    expect(toPositiveInteger('12', 3)).toBe(12)
    expect(toPositiveInteger('0', 3)).toBe(3)
    expect(toPositiveInteger('abc', 3)).toBe(3)
  })
})
