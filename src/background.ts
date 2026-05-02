import {
  isThreadsUrl,
  nextSettingsAfterMigration,
  SETTINGS_VERSION_KEY,
} from './background-logic'
import { DEFAULT_SETTINGS } from './shared/settings'

chrome.runtime.onInstalled.addListener(() => {
  void initializeSettings().then(injectIntoExistingThreadsTabs)
})

chrome.runtime.onStartup.addListener(() => {
  void initializeSettings().then(injectIntoExistingThreadsTabs)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') {
    return
  }

  if (!isThreadsUrl(tab.url)) {
    return
  }

  void injectIntoTab(tabId)
})

async function initializeSettings(): Promise<void> {
  const stored = await chrome.storage.sync.get({
    ...DEFAULT_SETTINGS,
    [SETTINGS_VERSION_KEY]: 0,
  })

  await chrome.storage.sync.set(nextSettingsAfterMigration(stored))
}

async function injectIntoExistingThreadsTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({})

  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && isThreadsUrl(tab.url))
      .map((tab) => injectIntoTab(tab.id as number)),
  )
}

async function injectIntoTab(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['injected.js'],
      world: 'MAIN',
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
      world: 'ISOLATED',
    })
  } catch {
    // Tabs may navigate away or reject script injection on restricted pages.
  }
}
