import { toBadgeMode, toPositiveInteger } from './options-logic'
import { DEFAULT_SETTINGS, getSettings } from './shared/settings'
import type { Settings } from './shared/types'

const badgeMode = mustGet<HTMLSelectElement>('badgeMode')
const showUnknown = mustGet<HTMLInputElement>('showUnknown')
const debugMode = mustGet<HTMLInputElement>('debugMode')
const debugShowOverlay = mustGet<HTMLInputElement>('debugShowOverlay')
const useTemplateReplay = mustGet<HTMLInputElement>('useTemplateReplay')
const useFallbackConstruction = mustGet<HTMLInputElement>(
  'useFallbackConstruction',
)
const cacheSuccessDays = mustGet<HTMLInputElement>('cacheSuccessDays')
const cacheMissHours = mustGet<HTMLInputElement>('cacheMissHours')
const status = mustGet<HTMLDivElement>('status')

void load()

document.getElementById('save')?.addEventListener('click', () => {
  void save()
})

document.getElementById('clearCache')?.addEventListener('click', () => {
  void clearCache()
})

async function load(): Promise<void> {
  const settings = await getSettings()
  badgeMode.value = settings.badgeMode
  showUnknown.checked = settings.showUnknown
  debugMode.checked = settings.debugMode
  debugShowOverlay.checked = settings.debugShowOverlay
  useTemplateReplay.checked = settings.useTemplateReplay
  useFallbackConstruction.checked = settings.useFallbackConstruction
  cacheSuccessDays.value = String(settings.cacheSuccessDays)
  cacheMissHours.value = String(settings.cacheMissHours)
}

async function save(): Promise<void> {
  const next: Settings = {
    badgeMode: toBadgeMode(badgeMode.value),
    showUnknown: showUnknown.checked,
    debugMode: debugMode.checked,
    debugShowOverlay: debugShowOverlay.checked,
    useTemplateReplay: useTemplateReplay.checked,
    useFallbackConstruction: useFallbackConstruction.checked,
    cacheSuccessDays: toPositiveInteger(
      cacheSuccessDays.value,
      DEFAULT_SETTINGS.cacheSuccessDays,
    ),
    cacheMissHours: toPositiveInteger(
      cacheMissHours.value,
      DEFAULT_SETTINGS.cacheMissHours,
    ),
  }

  await chrome.storage.sync.set(next)
  setStatus('저장되었습니다.')
}

async function clearCache(): Promise<void> {
  const values = await chrome.storage.local.get(null)
  const cacheKeys = Object.keys(values).filter((key) =>
    key.startsWith('profile:'),
  )

  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys)
  }

  setStatus('캐시를 삭제했습니다.')
}

function setStatus(message: string): void {
  status.textContent = message
  window.setTimeout(() => {
    status.textContent = ''
  }, 2_000)
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)

  if (element === null) {
    throw new Error(`Missing options element: ${id}`)
  }

  return element as T
}
