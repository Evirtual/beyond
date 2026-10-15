import { chromium } from 'playwright'

// The social preview (public/og-image.jpg): a real frame of the site at the standard 1200×630,
// with the words on the glass hidden. Needs the dev server running (npm run dev).
//   node scripts/render-og-image.mjs [url]   (ICON_BROWSER_CHANNEL=msedge to use installed Edge)
const url = process.argv[2] ?? 'http://localhost:5199/?v=1a2b3c4d'
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  ...(process.env.ICON_BROWSER_CHANNEL ? { channel: process.env.ICON_BROWSER_CHANNEL } : {}),
})
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.goto(url)
  await page.addStyleTag({ content: '.whisper,.inscription,.scroll-hint,.controls,.depth-marker{display:none!important}' })
  // past the opening, with the black hole small and far off
  await page.waitForTimeout(11000)
  await page.screenshot({ path: new URL('../public/og-image.jpg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), type: 'jpeg', quality: 88 })
} finally {
  await browser.close()
}
