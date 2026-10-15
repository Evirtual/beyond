/** Re-send the cutout preference after Android's installed-app window is ready. */
export function initializeLaunchViewport() {
  // Safari has a separate status-bar implementation. Leave it and browser tabs alone.
  if (!/Android/i.test(navigator.userAgent)) return
  if (!window.matchMedia('(display-mode: fullscreen)').matches) return

  const refresh = () => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!viewport) return
    const original = viewport.content
    if (!/viewport-fit\s*=\s*cover/i.test(original)) return

    // On some cold launches, cover arrives before the native window is ready.
    // A real preference change asks Chrome to apply its cutout policy again.
    requestAnimationFrame(() => {
      viewport.content = original.replace(/viewport-fit\s*=\s*cover/i, 'viewport-fit=contain')
      const restore = () => {
        viewport.content = original
        cancelAnimationFrame(frame)
        clearTimeout(timer)
      }
      const frame = requestAnimationFrame(restore)
      // Restore even if the app is backgrounded before the next animation frame.
      const timer = window.setTimeout(restore, 100)
    })
  }

  if (document.readyState === 'complete') refresh()
  else window.addEventListener('load', refresh, { once: true })
}
