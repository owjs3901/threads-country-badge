import { chromium } from '@playwright/test'

const endpoint = process.env.CHROME_CDP ?? 'http://127.0.0.1:9222'
const browser = await chromium.connectOverCDP(endpoint)
const context = browser.contexts()[0]

if (context === undefined) {
  throw new Error(`No browser context available at ${endpoint}`)
}

let page = context
  .pages()
  .find((candidate) => candidate.url().includes('threads.com'))

if (page === undefined) {
  page = await context.newPage()
  await page.goto('https://www.threads.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
}

await page.bringToFront()
await page.waitForTimeout(3_000)

const result = await page.evaluate(() => {
  const pageWindow = window as Window & {
    __threadsCountryBadgeInjected?: boolean
  }
  const badges = [
    ...document.querySelectorAll<HTMLElement>('[data-threads-country-badge]'),
  ].map((badge) => ({
    username: badge.getAttribute('data-threads-country-badge'),
    text: badge.textContent,
    title: badge.getAttribute('title'),
    href: badge.closest<HTMLAnchorElement>('a[href*="/@"]')?.href ?? null,
  }))
  const debugPanel =
    document.querySelector('#threads-country-badge-debug')?.textContent ?? null

  return {
    href: location.href,
    readyState: document.readyState,
    injectedReady: pageWindow.__threadsCountryBadgeInjected === true,
    contentBadgeCount: badges.length,
    badges: badges.slice(0, 30),
    debugPanel,
    profileLinkCount: document.querySelectorAll('a[href*="/@"]').length,
  }
})

console.info(JSON.stringify(result, null, 2))

await browser.close()
