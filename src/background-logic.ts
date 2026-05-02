import { DEFAULT_SETTINGS } from './shared/settings'

export const SETTINGS_VERSION_KEY = 'threadsCountryBadgeSettingsVersion'
export const SETTINGS_MIGRATION_VERSION = 2

const THREADS_URL_PATTERN = /^https:\/\/(?:www\.)?threads\.(?:com|net)\//

export function isThreadsUrl(url: string | undefined): boolean {
  return url !== undefined && THREADS_URL_PATTERN.test(url)
}

export function nextSettingsAfterMigration(
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const storedVersion =
    typeof stored[SETTINGS_VERSION_KEY] === 'number'
      ? stored[SETTINGS_VERSION_KEY]
      : 0
  const next = {
    ...DEFAULT_SETTINGS,
    ...stored,
    [SETTINGS_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
  }

  if (
    storedVersion < SETTINGS_MIGRATION_VERSION &&
    stored.useFallbackConstruction === false
  ) {
    next.useFallbackConstruction = true
  }

  return next
}
