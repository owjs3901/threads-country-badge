import { beforeEach, describe, expect, test } from 'bun:test'

import { DEFAULT_SETTINGS, getSettings } from '../settings'

interface SyncStorageMock {
  get(defaults: Record<string, unknown>): Promise<Record<string, unknown>>
  next: Record<string, unknown>
}

const syncStorage: SyncStorageMock = {
  next: {},
  async get(defaults) {
    return { ...defaults, ...this.next }
  },
}

globalThis.chrome = {
  storage: {
    sync: syncStorage,
  },
} as unknown as typeof chrome

describe('settings normalization', () => {
  beforeEach(() => {
    syncStorage.next = {}
  })

  test('returns defaults when storage has no overrides', async () => {
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS)
  })

  test('accepts valid stored values and bounds', async () => {
    syncStorage.next = {
      badgeMode: 'both',
      showUnknown: true,
      debugMode: false,
      debugShowOverlay: true,
      useTemplateReplay: false,
      useFallbackConstruction: false,
      cacheSuccessDays: 365,
      cacheMissHours: 168,
    }

    await expect(getSettings()).resolves.toEqual({
      badgeMode: 'both',
      showUnknown: true,
      debugMode: false,
      debugShowOverlay: true,
      useTemplateReplay: false,
      useFallbackConstruction: false,
      cacheSuccessDays: 365,
      cacheMissHours: 168,
    })
  })

  test('coerces invalid values back to safe defaults', async () => {
    syncStorage.next = {
      badgeMode: 'emoji',
      showUnknown: 'yes',
      debugMode: 'yes',
      debugShowOverlay: 'yes',
      useTemplateReplay: undefined,
      useFallbackConstruction: undefined,
      cacheSuccessDays: 366,
      cacheMissHours: Number.POSITIVE_INFINITY,
    }

    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS)
  })

  test('accepts country mode and lower numeric bounds', async () => {
    syncStorage.next = {
      badgeMode: 'country',
      cacheSuccessDays: 1,
      cacheMissHours: 1,
    }

    await expect(getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      badgeMode: 'country',
      cacheSuccessDays: 1,
      cacheMissHours: 1,
    })
  })
})
