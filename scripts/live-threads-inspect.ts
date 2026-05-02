import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  type BrowserContext,
  chromium,
  type ConsoleMessage,
  type Page,
} from '@playwright/test'

const root =
  import.meta.dir === undefined ? process.cwd() : join(import.meta.dir, '..')
const dist = join(root, 'dist')
const profile = join(root, '.chrome-profile')

interface BadgeSnapshot {
  username: string | null
  text: string
  title: string
  href: string | null
  parentText: string
  rect: { x: number; y: number; width: number; height: number }
}

const consoleMessages: string[] = []
const aboutResponses: Array<{ url: string; status: number; snippet: string }> =
  []

await mkdir(profile, { recursive: true })

console.info(`[live-threads-inspect] launching Chromium with ${dist}`)
const context = await launchThreadsContext()
console.info('[live-threads-inspect] browser launched')
const page = await context.newPage()
wireDiagnostics(page)

console.info('[live-threads-inspect] navigating to https://www.threads.com/')
await page.goto('https://www.threads.com/', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
})
console.info(`[live-threads-inspect] loaded ${page.url()}`)
await page.waitForTimeout(6_000)
await page.evaluate(() =>
  window.scrollBy(0, Math.floor(window.innerHeight * 1.5)),
)
await page.waitForTimeout(4_000)

const snapshot = await collectBadgeSnapshot(page)
const questionBadges = snapshot.badges.filter(
  (badge) =>
    badge.text.trim() === '?' ||
    badge.title.includes('No captured profile template') ||
    badge.title.includes('country unavailable'),
)

console.info(
  JSON.stringify(
    {
      url: page.url(),
      title: await page.title(),
      badgeCount: snapshot.badges.length,
      questionBadgeCount: questionBadges.length,
      questionBadges,
      badges: snapshot.badges.slice(0, 30),
      aboutResponseCount: aboutResponses.length,
      aboutResponses,
      countryBadgeLogs: consoleMessages
        .filter((message) => message.includes('Threads Country Badge'))
        .slice(-120),
    },
    null,
    2,
  ),
)

console.info('[live-threads-inspect] closing browser')
await context.close()

async function launchThreadsContext(): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: false,
      viewport: { width: 1440, height: 1100 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(
      `Failed to launch Playwright Chromium with the extension loaded. Close any Chrome using ${profile}, then retry. Original error: ${message}`,
      { cause: error },
    )
  }
}

function wireDiagnostics(page: Page): void {
  page.on('console', (message: ConsoleMessage) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`)
  })

  page.on('response', (response) => {
    const url = response.url()

    if (!url.includes('about_this_profile_async_action')) {
      return
    }

    void response
      .text()
      .then((text) => {
        aboutResponses.push({
          url,
          status: response.status(),
          snippet: text.slice(0, 3_000),
        })
      })
      .catch(() => undefined)
  })
}

async function collectBadgeSnapshot(
  page: Page,
): Promise<{ badges: BadgeSnapshot[] }> {
  return page.evaluate(() => ({
    badges: [
      ...document.querySelectorAll<HTMLElement>('[data-threads-country-badge]'),
    ].map((badge) => {
      const link = badge.closest<HTMLAnchorElement>('a[href*="/@"]')
      const rect = badge.getBoundingClientRect()

      return {
        username: badge.getAttribute('data-threads-country-badge'),
        text: badge.textContent ?? '',
        title: badge.getAttribute('title') ?? '',
        href: link?.href ?? null,
        parentText:
          badge.parentElement?.textContent?.trim().slice(0, 160) ?? '',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }
    }),
  }))
}
