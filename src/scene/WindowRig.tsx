import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { view } from './state'
import { pointer, updatePointer } from './touch'
import { START_STEP, TRANSITION, zoneOf } from './moment'

/** Seconds spent flying the wormhole on the far side of a crossing. */
const TUNNEL_SECONDS = 1.6

/** Where a black hole's pull begins, as a fraction of a world from its centre. */
const HOLE_REACH = 0.2
/** How fast an idle visitor drifts toward the hole ahead (world units / s). */
const BASE_PULL = 0.3
/** drifting: how fast the view flies on by itself (world units / s) — a shade in about 18 s */
const DRIFT_SPEED = 1.45

/**
 * Head-coupled "window" camera, plus endless flight into depth.
 *
 * The camera never rotates. Moving the cursor translates the eye, and the
 * projection is skewed (off-axis frustum) so that a plane at ANCHOR_DIST stays
 * pinned to the browser frame — exactly how a real window behaves: things
 * nearer than that plane slide against the frame, things beyond it barely move,
 * and you can lean to peek past whatever is cut off by the edges.
 *
 * Scrolling travels forward without end. Each world spans DEPTH_STEP units;
 * near its far edge the fog thickens into a veil, and on the other side of the
 * veil the next world begins.
 */
const RANGE_X = 1.35 // world units the eye can lean sideways
const RANGE_Y = 0.8
const ANCHOR_DIST = 60 // plane that stays locked to the screen frame
const ANCHOR_STRENGTH = 1 // 0 = plain translation, 1 = true window

export const DEPTH_STEP = 26
const WHEEL_GAIN = 0.03 // world units per wheel pixel (~9 mouse notches per world)
const TOUCH_GAIN = 0.06

/**
 * How big the hole ahead is: a speck when you enter a zone, growing slowly through
 * its shades, then — over the final stretch — swelling until it covers the frame.
 */
function engulf(toEnd: number, zoneSpan: number) {
  const grow = 0.07 + 0.6 * Math.pow(THREE.MathUtils.clamp(1 - toEnd / zoneSpan, 0, 1), 1.6)
  const final = 1 - THREE.MathUtils.smoothstep(toEnd, 0, DEPTH_STEP * 0.45)
  return grow + (1 - grow) * final
}

const damp = (a: number, b: number, lambda: number, dt: number) =>
  THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt))

// dev-only handle for inspecting the live rig from the console
if (import.meta.env.DEV) (window as unknown as { __view: typeof view }).__view = view

/** Your eye. Every world's camera copies it each frame, at that world's own depth. */
export const mainCamera: { current: THREE.PerspectiveCamera | null } = { current: null }

export function WindowRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  mainCamera.current = camera
  // depth starts slightly behind the first world and glides in during the opening
  const startDepth = START_STEP * DEPTH_STEP
  const target = useRef({ x: 0, y: 0, depth: startDepth })
  const stage1 = useRef({ x: 0, y: 0, depth: startDepth - 3.2 })
  const stage2 = useRef({ x: 0, y: 0, depth: startDepth - 3.2 })
  const lastInput = useRef(0)
  const lastDir = useRef(1)
  // when the current zone began (a crossing just happened): the arrival is held in darkness
  const arrival = useRef({ zone: zoneOf(START_STEP).start, at: -10 })

  useEffect(() => {
    const now = () => performance.now() / 1000
    const push = (d: number) => {
      // never let the target run more than one world ahead of where you are
      const lim = DEPTH_STEP * 1.2
      const cur = stage2.current.depth
      target.current.depth = THREE.MathUtils.clamp(target.current.depth + d, cur - lim, cur + lim)
      lastInput.current = now()
      if (d !== 0) lastDir.current = Math.sign(d)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1
      target.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
      pointer.ndc.set(target.current.x, target.current.y)
      pointer.present = true
    }
    const onLeave = () => {
      target.current.x = 0
      target.current.y = 0
      pointer.present = false
    }
    const onWheel = (e: WheelEvent) => {
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      push(THREE.MathUtils.clamp(px, -160, 160) * WHEEL_GAIN)
    }
    let touchY: number | null = null
    const touchToPointer = (t: Touch) => {
      pointer.ndc.set((t.clientX / window.innerWidth) * 2 - 1, -((t.clientY / window.innerHeight) * 2 - 1))
      pointer.present = true
    }
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null
      if (e.touches[0]) {
        touchToPointer(e.touches[0])
        pointer.smooth.copy(pointer.ndc) // a finger lands, it doesn't glide in
      }
    }
    const onTouchEnd = () => {
      touchY = null
      pointer.present = false
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (touchY === null || y === undefined) return
      push((touchY - y) * TOUCH_GAIN)
      touchY = y
      // a touch drag also leans the viewpoint a little, and pushes what it touches
      target.current.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1
      touchToPointer(e.touches[0])
    }
    window.addEventListener('pointermove', onMove)
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  useFrame((state, rawDt) => {
    if (import.meta.env.DEV) (window as unknown as { __frameStart: number }).__frameStart = performance.now()
    const dt = Math.min(rawDt, 1 / 20)
    const t = state.clock.elapsedTime
    const tg = target.current
    const s1 = stage1.current
    const s2 = stage2.current

    // gravity: the black hole you're travelling toward is always pulling. Left alone you
    // drift toward it slowly; close to it the pull grows until it takes you. Scrolling the
    // other way can still break free — and the hole behind you never pulls you back.
    {
      const dir = lastDir.current
      // measured from where you actually are, not where you're headed — otherwise the pull
      // fades the moment your destination slips past the horizon, and you coast in the dark
      const here = s2.depth
      const z = zoneOf(Math.round(here / DEPTH_STEP))
      const toHole = dir > 0
        ? (z.start + z.length - 0.5) * DEPTH_STEP - here
        : here - (z.start - 0.5) * DEPTH_STEP
      const near = 1 - THREE.MathUtils.smoothstep(toHole, 0, DEPTH_STEP * (0.5 - HOLE_REACH))
      const opening = THREE.MathUtils.smoothstep(t, 6, 12) // let the first view settle before it starts
      // like gravity: faint on arrival, stronger with every unit closer, irresistible at the end
      const closeness = THREE.MathUtils.clamp(1 - toHole / (z.length * DEPTH_STEP), 0, 1)
      // exponential: each shade deeper pulls about e times harder than the last
      const pull = BASE_PULL * Math.exp(3 * closeness) * opening + 4.5 * near * near
      // while drifting, your chosen pace sets the hole's pull too — slow stays slow to the end
      tg.depth += dir * pull * (view.auto ? view.driftRate : 1) * dt
      // drifting: carried gently forward, through every reality and home again, without end
      if (view.auto) {
        lastDir.current = 1
        tg.depth += DRIFT_SPEED * view.driftRate * opening * dt
      }
    }

    // a barely-there breathing sway so the world is never perfectly still
    const idleX = Math.sin(t * 0.11) * 0.07 + Math.sin(t * 0.037) * 0.05
    const idleY = Math.sin(t * 0.13 + 1.7) * 0.05

    // two chained dampers → eased start *and* eased stop (feels like mass)
    s1.x = damp(s1.x, tg.x + idleX, 2.6, dt)
    s1.y = damp(s1.y, tg.y + idleY, 2.6, dt)
    s2.x = damp(s2.x, s1.x, 2.6, dt)
    s2.y = damp(s2.y, s1.y, 2.6, dt)
    s1.depth = damp(s1.depth, tg.depth, 2.4, dt)
    s2.depth = damp(s2.depth, s1.depth, 2.4, dt)

    const step = Math.round(s2.depth / DEPTH_STEP)
    const local = s2.depth - step * DEPTH_STEP
    view.x = s2.x
    view.y = s2.y
    // how fast you're falling (world units / s), smoothed — the glass streaks with it
    view.speed = damp(view.speed, (s2.depth - view.depth) / Math.max(dt, 1e-3), 4, dt)
    view.depth = s2.depth
    view.step = step
    view.local = local
    // a zone (one colour, all its shades) is one continuous space; the camera only
    // jumps when a new zone is built, inside the black hole
    const zone = zoneOf(step)
    view.zoneStart = zone.start
    view.zoneLength = zone.length
    view.camZ = -(s2.depth - zone.start * DEPTH_STEP)

    // the zone's two black holes: one at its far end (the next colour), one at its
    // near end (the colour you came from). Distances in world units, ≥ 0 inside the zone.
    const zoneSpan = zone.length * DEPTH_STEP
    const toEnd = (zone.start + zone.length - 0.5) * DEPTH_STEP - s2.depth
    const toStart = s2.depth - (zone.start - 0.5) * DEPTH_STEP
    const forward = lastDir.current >= 0
    view.across = forward ? zone.start + zone.length : zone.start - 1
    view.holeBoundary = true

    // travelling forward: the next hole is visible the whole way through the zone —
    // a speck when you arrive, growing through every shade until it swallows you.
    // the one you came out of is behind you, so nothing hangs in front after a crossing.
    // travelling back: darkness closes in from the edges as the near end comes up.
    const holeTarget = forward
      ? engulf(toEnd, zoneSpan)
      : 1 - THREE.MathUtils.smoothstep(toStart, 0, DEPTH_STEP * 0.5)
    if (zone.start !== arrival.current.zone) {
      // just came through: the new zone is being built unseen — the hole snaps to its
      // new far-off speck now, while everything is still black, instead of sliding there
      view.tunnelFrom = arrival.current.zone
      view.tunnelTo = zone.start
      arrival.current = { zone: zone.start, at: t }
      // portal: the next hole fades in from nothing rather than popping up at speck size;
      // other modes snap it while the screen is hidden
      view.hole = TRANSITION === 'portal' ? 0 : holeTarget
      // pushed out the far side: you come out moving, carried several metres into the new zone
      // (in portal mode your momentum simply carries on: the world was already there)
      if (TRANSITION !== 'portal') {
        const PUSH_OUT = 8
        if (forward) tg.depth = Math.max(tg.depth, (zone.start - 0.5) * DEPTH_STEP + PUSH_OUT)
        else tg.depth = Math.min(tg.depth, (zone.start + zone.length - 0.5) * DEPTH_STEP - PUSH_OUT)
      }
    }
    view.hole = damp(view.hole, holeTarget, 6, dt)
    view.holeBehind = damp(view.holeBehind, forward ? 0 : 1, 4, dt)

    // the black veil only exists at the zone's ends (entering or leaving through a hole);
    // between shades of one colour the flight just continues
    // the hole fills the frame first; only the very last stretch goes fully black
    const veilBand = DEPTH_STEP * 0.06
    // (three's smoothstep needs min < max, unlike GLSL's — hence 1 − …)
    // after a crossing the darkness holds for a moment, then the new zone opens around you
    const sinceArrival = t - arrival.current.at
    // out the other side as from a white hole: a white-hot flash in the new zone's light
    // (it also covers the frame where the new zone is built), then the world bursts outward
    // out the other side: the exit opens dead ahead as a point of light and, as you rush
    // through it, widens past the edges of the frame (emerge 1 → 0 over ~1.25 s)
    view.flash = sinceArrival < 0 ? 0 : Math.exp(-sinceArrival / 0.12)
    view.emerge = 1 - THREE.MathUtils.clamp(sinceArrival / 1.25, 0, 1)
    // dev-only: freeze the exit at a chosen moment to inspect it (window.__freezeExit = 0..1)
    if (import.meta.env.DEV) {
      const fz = (window as unknown as { __freezeExit?: number }).__freezeExit
      if (typeof fz === 'number') {
        view.emerge = 1 - fz
        view.flash = fz < 0.05 ? 1 - fz * 20 : 0
      }
    }
    // darkness only on the way in — toward the hole you're heading for
    view.veil = forward
      ? 1 - THREE.MathUtils.smoothstep(toEnd, 0, veilBand)
      : 1 - THREE.MathUtils.smoothstep(toStart, 0, veilBand)

    if (TRANSITION === 'wormhole') {
      // the darkness at the end of the fall is the mouth of a tunnel; on the far side you fly
      // it for a moment before its walls thin away into the new zone
      const inTunnel = sinceArrival >= 0 && sinceArrival < TUNNEL_SECONDS
      view.tunnelP = inTunnel ? sinceArrival / TUNNEL_SECONDS : 0
      view.tunnel = inTunnel ? 1 : view.veil
      if (!inTunnel) {
        view.tunnelFrom = zone.start
        view.tunnelTo = view.across
      }
      // fast at the mouth, easing off as the exit nears
      const tunnelSpeed = inTunnel ? THREE.MathUtils.lerp(5.5, 1.2, view.tunnelP) : 3 + 3 * view.veil
      view.tunnelPhase += tunnelSpeed * dt
      // the tunnel replaces the white-hole opening
      view.emerge = 0
      view.flash = 0
    } else {
      view.tunnel = 0
    }

    if (TRANSITION === 'portal') {
      // the next world is seen through the hole — no veil, no flash, nothing to hide
      view.veil = 0
      view.emerge = 0
      view.flash = 0
      view.tunnel = 0
      view.spiral = 0
    }

    if (TRANSITION === 'spiral') {
      // no darkness at all: the view itself is wound into the hole, and the new zone
      // unwinds out of the same point, turning the other way
      const SPIRAL_OUT = 1.4
      if (sinceArrival >= 0 && sinceArrival < SPIRAL_OUT) {
        const p = sinceArrival / SPIRAL_OUT
        view.spiral = 1 - p * p * (3 - 2 * p)
        view.spiralDir = -1
      } else {
        const toHoleNow = forward ? toEnd : toStart
        view.spiral = Math.pow(1 - THREE.MathUtils.smoothstep(toHoleNow, 0, DEPTH_STEP * 0.3), 1.5)
        view.spiralDir = 1
      }
      view.veil = 0
      view.emerge = 0
      view.flash = 0
    } else {
      view.spiral = 0
    }
    // dev-only: freeze inside the wormhole (window.__freezeTunnel = 0..1, between home and red)
    if (import.meta.env.DEV) {
      const fz = (window as unknown as { __freezeTunnel?: number }).__freezeTunnel
      if (typeof fz === 'number') {
        view.tunnel = 1
        view.tunnelP = fz
        view.tunnelFrom = 0
        view.tunnelTo = 1
      }
    }

    const cx = s2.x * RANGE_X
    const cy = s2.y * RANGE_Y
    camera.position.set(cx, cy, view.camZ)
    camera.rotation.set(0, 0, 0)
    camera.updateMatrixWorld()

    // off-axis frustum: keep the anchor plane centred on the frame
    const near = camera.near
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * near
    const halfW = halfH * camera.aspect
    const k = (ANCHOR_STRENGTH * near) / ANCHOR_DIST
    const sx = -cx * k
    const sy = -cy * k
    camera.projectionMatrix.makePerspective(-halfW + sx, halfW + sx, halfH + sy, -halfH + sy, near, camera.far)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    updatePointer(camera, dt)
  }, -1) // first: every world copies this camera afterwards

  return null
}
