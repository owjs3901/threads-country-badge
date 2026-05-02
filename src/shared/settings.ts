import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  badgeMode: 'flag',
  showUnknown: false,
  debugMode: true,
  debugShowOverlay: false,
  useTemplateReplay: true,
  useFallbackConstruction: true,
  cacheSuccessDays: 21,
  cacheMissHours: 24,
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS })
  const cacheSuccessDays = stored.cacheSuccessDays
  const cacheMissHours = stored.cacheMissHours

  return {
    badgeMode:
      stored.badgeMode === 'country' || stored.badgeMode === 'both'
        ? stored.badgeMode
        : 'flag',
    showUnknown: booleanSetting(
      stored.showUnknown,
      DEFAULT_SETTINGS.showUnknown,
    ),
    debugMode: booleanSetting(stored.debugMode, DEFAULT_SETTINGS.debugMode),
    debugShowOverlay: booleanSetting(
      stored.debugShowOverlay,
      DEFAULT_SETTINGS.debugShowOverlay,
    ),
    useTemplateReplay: booleanSetting(
      stored.useTemplateReplay,
      DEFAULT_SETTINGS.useTemplateReplay,
    ),
    useFallbackConstruction: booleanSetting(
      stored.useFallbackConstruction,
      DEFAULT_SETTINGS.useFallbackConstruction,
    ),
    cacheSuccessDays: boundedNumber(
      cacheSuccessDays,
      DEFAULT_SETTINGS.cacheSuccessDays,
      1,
      365,
    ),
    cacheMissHours: boundedNumber(
      cacheMissHours,
      DEFAULT_SETTINGS.cacheMissHours,
      1,
      168,
    ),
  }
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback
}
