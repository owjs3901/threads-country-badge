import { describe, expect, test } from 'bun:test'

import {
  isThreadsUrl,
  nextSettingsAfterMigration,
  SETTINGS_MIGRATION_VERSION,
  SETTINGS_VERSION_KEY,
} from '../background-logic'

describe('background logic', () => {
  test('matches Threads URLs only', () => {
    expect(isThreadsUrl('https://www.threads.com/@alice')).toBe(true)
    expect(isThreadsUrl('https://threads.net/')).toBe(true)
    expect(isThreadsUrl('http://threads.com/')).toBe(false)
    expect(isThreadsUrl(undefined)).toBe(false)
  })

  test('migrates stored settings and restores fallback construction', () => {
    expect(
      nextSettingsAfterMigration({
        [SETTINGS_VERSION_KEY]: 1,
        useFallbackConstruction: false,
      }),
    ).toMatchObject({
      [SETTINGS_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
      useFallbackConstruction: true,
    })
  })
})
