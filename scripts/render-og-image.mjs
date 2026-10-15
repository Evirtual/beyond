import { chromium } from 'playwright'

// The social preview (public/og-image.jpg): a real frame of the site at the standard 1200×630,
// with the words on the glass hidden and the name set quietly in the app's own type.
//   node scripts/render-og-image.mjs [url] [out] [scrolls]
//   (ICON_BROWSER_CHANNEL=msedge to use installed Edge)
const url = process.argv[2] ?? 'https://beyond.edgarasneverdauskas.com/?v=1a2b3c4d&hour=22'
const out = process.argv[3] ?? new URL('../public/og-image.jpg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
// how far to fly in before the shot: the nearer, the bigger the black hole
const scrolls = Number(process.argv[4] ?? 1)
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  ...(process.env.ICON_BROWSER_CHANNEL ? { channel: process.env.ICON_BROWSER_CHANNEL } : {}),
})
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await page.goto(url)
  await page.addStyleTag({
    content: `.whisper,.inscription,.scroll-hint,.controls,.depth-marker{display:none!important}
      .og-name{position:fixed;left:0;right:0;bottom:44px;text-align:center;z-index:9;pointer-events:none;
        font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:34px;
        letter-spacing:0.32em;color:rgba(232,228,248,0.86);text-shadow:0 0 24px rgba(150,140,230,0.45)}`,
  })
  await page.evaluate(() => {
    const d = document.createElement('div')
    d.className = 'og-name'
    d.textContent = 'Beyond the Glass'
    document.body.appendChild(d)
  })
  // past the opening, then fly in a little so the black hole is the clear focus
  await page.waitForTimeout(8000)
  await page.mouse.move(600, 315)
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(1500)
  await page.screenshot({ path: out, type: 'jpeg', quality: 88 })
} finally {
  await browser.close()
}
