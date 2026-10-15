import { mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import ffmpeg from 'ffmpeg-static'

// A smooth showcase video: the page runs on a virtual clock that advances exactly 1/FPS per
// frame, every frame is captured, then joined with ffmpeg. Nothing is ever dropped, however
// slowly the capture runs. Needs a dev server (npx vite --port 5300).
//   node scripts/render-video.mjs [url] [out.mp4]
const FPS = 60
const W = 1920
const H = 1080
const url = process.argv[2] ?? 'http://localhost:5300/?v=1a2b3c4d&hour=22'
const out = process.argv[3] ?? 'beyond-showcase.mp4'
const frames = 'video-frames'
const MAX_SECONDS = Number(process.env.MAX_SECONDS ?? 32)
// after coming through into the ether, stay this long before ending
const AFTER_CROSSING = 5

await rm(frames, { recursive: true, force: true })
await mkdir(frames, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  ...(process.env.ICON_BROWSER_CHANNEL ? { channel: process.env.ICON_BROWSER_CHANNEL } : {}),
})
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  // the virtual clock: time only moves when we step it, one frame at a time
  await page.addInitScript(() => {
    let vt = 0
    performance.now = () => vt
    let queue = []
    window.requestAnimationFrame = (cb) => (queue.push(cb), queue.length)
    window.cancelAnimationFrame = () => {}
    window.__step = (ms) => {
      vt += ms
      const run = queue
      queue = []
      for (const cb of run) cb(vt)
    }
  })
  await page.goto(url)
  await page.addStyleTag({ content: '.whisper,.inscription,.scroll-hint,.controls,.depth-marker{display:none!important}' })
  // let the worlds build and compile before the clock starts
  await page.waitForTimeout(4000)
  await page.evaluate(() => (window.__view.auto = false))

  const dt = 1000 / FPS
  let crossedAt = -1
  for (let i = 0; i < MAX_SECONDS * FPS; i++) {
    const t = i / FPS
    const state = await page.evaluate(
      ({ dt, t }) => {
        // after the opening, a gentle steady scroll toward the black hole, until we're through
        if (t > 8.5 && window.__view.zoneStart === 0 && Math.round(t * 60) % 6 === 0)
          window.dispatchEvent(new WheelEvent('wheel', { deltaY: 18 }))
        // two ticks per frame: the frame governor asks for a render, then it's drawn
        window.__step(dt / 2)
        window.__step(dt / 2)
        return window.__view.zoneStart
      },
      { dt, t },
    )
    await page.screenshot({ path: `${frames}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 })
    if (state !== 0 && crossedAt < 0) crossedAt = t
    if (crossedAt >= 0 && t - crossedAt > AFTER_CROSSING) break
    if (i % 120 === 0) console.log(`frame ${i} (${t.toFixed(1)}s) zone ${state}`)
  }
} finally {
  await browser.close()
}

await new Promise((resolve, reject) => {
  const p = spawn(ffmpeg, ['-y', '-framerate', String(FPS), '-i', `${frames}/%05d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' })
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code))))
})
await rm(frames, { recursive: true, force: true })
console.log('wrote', out)
