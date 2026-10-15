import * as THREE from 'three'
import { mulberry32 } from './rng'

/**
 * Everything that ties the world to *this* visit and *this* moment.
 *
 * - worldSeed: random per arrival (or `?v=xxxxxxxx` to revisit a view)
 * - light: follows the visitor's real local time of day (`?hour=6.5` to preview)
 * - moon: the real current moon phase
 */
const params = new URLSearchParams(location.search)

export const arrivedAt = new Date()

function makeSeed() {
  const v = params.get('v')
  if (v && /^[0-9a-f]{8}$/i.test(v)) return parseInt(v, 16) >>> 0
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return (buf[0] ^ arrivedAt.getTime()) >>> 0
}

/**
 * How a black hole is crossed. Several are kept side by side to compare:
 * ?transition=portal (default) | spiral | wormhole | opening
 *
 * portal: the next zone already exists inside the hole and is seen through it,
 * so crossing is simply flying on — no swap, no fade, no darkness.
 */
export type Transition = 'portal' | 'spiral' | 'wormhole' | 'opening'
const TRANSITIONS: Transition[] = ['portal', 'spiral', 'wormhole', 'opening']
export const TRANSITION: Transition = TRANSITIONS.includes(params.get('transition') as Transition)
  ? (params.get('transition') as Transition)
  : 'portal'

export const seedFromUrl = /^[0-9a-f]{8}$/i.test(params.get('v') ?? '')
/** The world you arrived in. Every DEPTH_CYCLE steps of depth lead back here. */
export const homeSeed = makeSeed()
export const viewId = homeSeed.toString(16).padStart(8, '0')

/**
 * For now the journey is home alone: every black hole leads back into home. (The realms beyond —
 * the spectrum of 6 hues × light / middle / dark — are switched off while they are reimagined;
 * set this back to 1 + 6 * 3 to bring the spectrum's zones back.)
 */
export const DEPTH_CYCLE = 1

/**
 * Every other world is the ether: home, a black hole, the ether, a black hole, home again (a new
 * one), and on. `?at=1` starts in the ether.
 */
export function isEther(step: number) {
  return ((step % 2) + 2) % 2 === 1
}

/**
 * Seed of the world at a given depth step. The home you arrived in keeps the visit's own seed;
 * every home beyond a black hole is dealt its own, as different as a fresh visit would be.
 * Deterministic, so going back through a black hole returns you to the very home you left.
 */
export function seedForStep(step: number) {
  if (step === 0) return homeSeed
  let h = (homeSeed ^ Math.imul(step, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  return (h ^ (h >>> 15)) >>> 0
}

/**
 * A zone is a run of steps sharing one colour: home alone, or a hue's light,
 * middle and dark shades flown through continuously. Zones are only left
 * through a black hole.
 */
export function zoneOf(step: number) {
  const k = ((step % DEPTH_CYCLE) + DEPTH_CYCLE) % DEPTH_CYCLE
  if (k === 0) return { start: step, length: 1 }
  return { start: step - ((k - 1) % 3), length: 3 }
}

export type FormName = 'home' | 'jagged' | 'eroded' | 'radiant' | 'grown' | 'glacial' | 'arcane'
const HUE_FORMS: Record<string, FormName> = {
  red: 'jagged',
  orange: 'eroded',
  yellow: 'radiant',
  green: 'grown',
  blue: 'glacial',
  violet: 'arcane',
}
/** The form language of the zone a step belongs to (see forms.ts). */
export function formNameFor(step: number): FormName {
  const sp = spectrumAt(step)
  return sp ? HUE_FORMS[sp.hue.name] : 'home'
}

/** Independent random stream per system and per world, so nothing reshuffles anything else. */
export function rngForSeed(seed: number, label: string) {
  let h = (seed ^ 0x9e3779b9) >>> 0
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619) >>> 0
  return mulberry32(h)
}

/** A stream tied to the visit itself (shared by every world: the moon, the sky). */
export function rngFor(label: string) {
  return rngForSeed(homeSeed, label)
}

// ── time of day ─────────────────────────────────────────────────────────────

const hourOverride = params.has('hour') ? Number(params.get('hour')) : null
export const hourPreviewed = hourOverride !== null && Number.isFinite(hourOverride)

export function localHour(d = new Date()) {
  if (hourOverride !== null && Number.isFinite(hourOverride)) return ((hourOverride % 24) + 24) % 24
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

type Key = {
  h: number
  horizon: string
  top: string
  glow: string
  key: string
  keyI: number
  fill: string
  exposure: number
}

// a dream-world reading of the real sky: never bright, but its mood follows the clock
const KEYS: Key[] = [
  { h: 0, horizon: '#0a0b1d', top: '#020308', glow: '#a9bcff', key: '#8ea4ff', keyI: 1.5, fill: '#5a6bb0', exposure: 1.35 },
  { h: 4.5, horizon: '#0c0b1e', top: '#020308', glow: '#b0b8ff', key: '#94a2ff', keyI: 1.5, fill: '#5a6bb0', exposure: 1.35 },
  { h: 6.5, horizon: '#1f1426', top: '#06040b', glow: '#ff9e70', key: '#ffb07a', keyI: 2.7, fill: '#7a6cc0', exposure: 1.4 },
  { h: 9, horizon: '#16192f', top: '#05060f', glow: '#ffd9a8', key: '#ffd8a8', keyI: 2.9, fill: '#8fa6e8', exposure: 1.45 },
  { h: 13, horizon: '#172038', top: '#060914', glow: '#ffeac4', key: '#ffe6c0', keyI: 3.1, fill: '#a3b8ff', exposure: 1.55 },
  { h: 17, horizon: '#1d1529', top: '#06040c', glow: '#ffa060', key: '#ffa468', keyI: 2.9, fill: '#8a70d0', exposure: 1.45 },
  { h: 19.5, horizon: '#1a1028', top: '#05030b', glow: '#ff7f6a', key: '#e08aa8', keyI: 2.2, fill: '#7060c8', exposure: 1.4 },
  { h: 21.5, horizon: '#0e0e22', top: '#03030a', glow: '#b49cff', key: '#a898ff', keyI: 1.7, fill: '#6a5cc0', exposure: 1.35 },
]

export function dayPeriod(h: number) {
  if (h < 5) return 'night'
  if (h < 8) return 'dawn'
  if (h < 17) return 'day'
  if (h < 20.5) return 'dusk'
  return 'night'
}

// ── moon ────────────────────────────────────────────────────────────────────

const SYNODIC = 29.530588853
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

/** 0 = new, 0.5 = full, → 1 */
export function moonPhase(d = new Date()) {
  const days = (d.getTime() - KNOWN_NEW_MOON) / 86400000
  return (((days / SYNODIC) % 1) + 1) % 1
}

export function moonName(p: number) {
  const names = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent']
  return names[Math.round(p * 8) % 8]
}

// ── live light state (mutated in place; uniforms hold references) ──────────

/** Time-of-day light, before the spectrum tints it. */
const day = {
  horizon: new THREE.Color(),
  top: new THREE.Color(),
  glow: new THREE.Color(),
  key: new THREE.Color(),
  fill: new THREE.Color(),
  keyI: 1,
  exposure: 1.4,
}

/** The hour's light, tinted by a place in the spectrum. Each world keeps its own. */
export function makeLightState() {
  return {
    horizon: new THREE.Color(),
    top: new THREE.Color(),
    glow: new THREE.Color(),
    key: new THREE.Color(),
    keyI: 1,
    fill: new THREE.Color(),
    /** two haze tones (violet / blue at home) */
    hazeA: new THREE.Color(),
    hazeB: new THREE.Color(),
    exposure: 1.4,
    moonPhase: 0,
    moonLight: 0, // 0..1, how much the moon matters right now
    hour: 0,
  }
}
export type LightState = ReturnType<typeof makeLightState>

/** The light where you are (what the glass and the exposure follow). */
export const light = makeLightState()

/** The hour and the moon: one sky above every world. */
const sharedSky = { hour: 0, moonPhase: 0, moonLight: 0 }

const ca = new THREE.Color()
const cb = new THREE.Color()
function mix(out: THREE.Color, a: string, b: string, t: number) {
  out.copy(ca.set(a)).lerp(cb.set(b), t)
}

export function updateLight(d = new Date()) {
  const h = localHour(d)
  let i = KEYS.length - 1
  while (i > 0 && KEYS[i].h > h) i--
  const a = KEYS[i]
  const b = KEYS[(i + 1) % KEYS.length]
  const span = (b.h > a.h ? b.h : b.h + 24) - a.h
  const tt = THREE.MathUtils.smoothstep((h - a.h) / span, 0, 1)
  mix(day.horizon, a.horizon, b.horizon, tt)
  mix(day.top, a.top, b.top, tt)
  mix(day.glow, a.glow, b.glow, tt)
  mix(day.key, a.key, b.key, tt)
  mix(day.fill, a.fill, b.fill, tt)
  day.keyI = THREE.MathUtils.lerp(a.keyI, b.keyI, tt)
  day.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, tt)
  sharedSky.hour = h

  const p = moonPhase(d)
  const illum = (1 - Math.cos(p * Math.PI * 2)) / 2
  const night = 1 - THREE.MathUtils.smoothstep(Math.abs(((h + 12) % 24) - 12), 5, 8) // 1 around midnight
  sharedSky.moonPhase = p
  sharedSky.moonLight = illum * (0.35 + 0.65 * night)
}

// ── the spectrum: a journey through colour, one depth step at a time ────────

export const HUES = [
  // lum evens out perceived brightness: yellow and green read far brighter than blue at equal lightness
  { name: 'red', h: 0.0, lum: 0.9 },
  { name: 'orange', h: 0.065, lum: 0.75 },
  { name: 'yellow', h: 0.135, lum: 0.55 },
  { name: 'green', h: 0.36, lum: 0.7 },
  { name: 'blue', h: 0.6, lum: 1.15 },
  { name: 'violet', h: 0.77, lum: 0.85 },
] as const
export const SHADES = [
  // coloured darkness, not coloured fog: even 'light' stays a night-time dream
  { name: 'light', horizonL: 0.095, topL: 0.02, glowL: 0.58, exposure: 0.05 },
  { name: 'middle', horizonL: 0.068, topL: 0.013, glowL: 0.5, exposure: 0 },
  { name: 'dark', horizonL: 0.032, topL: 0.005, glowL: 0.38, exposure: -0.12 },
] as const

/** Perceived-brightness correction for any hue, read around the colour wheel from HUES. */
function lumFor(h: number) {
  const pts = [...HUES.map((x) => [x.h, x.lum] as const), [1, HUES[0].lum] as const]
  for (let i = 0; i < pts.length - 1; i++) {
    const [h0, l0] = pts[i], [h1, l1] = pts[i + 1]
    if (h >= h0 && h <= h1) return l0 + ((h - h0) / Math.max(h1 - h0, 1e-6)) * (l1 - l0)
  }
  return 0.85
}

export type Palette = { name: string; h: number; h2: number; h3: number; lum: number }
const palettes = new Map<number, Palette[]>()
/**
 * The colours of one loop: each of its six realities gets a palette dealt at random —
 * a main colour and two companions (near it, opposite it, or in a triad / split) —
 * never sharing its main colour with the reality next to it. A new loop, new colours.
 */
function palettesFor(loop: number) {
  let ps = palettes.get(loop)
  if (ps) return ps
  const r = rngForSeed(homeSeed, 'palettes' + loop)
  ps = []
  let prev = r()
  for (let slot = 0; slot < HUES.length; slot++) {
    let h = r()
    // far enough round the wheel from the reality before it
    const gap = Math.abs(((h - prev + 1.5) % 1) - 0.5)
    if (gap < 0.18) h = (h + 0.33) % 1
    prev = h
    const scheme = Math.floor(r() * 4)
    const [d2, d3] = [[0.09, -0.08], [0.5, 0.46], [1 / 3, 2 / 3], [0.42, 0.58]][scheme]
    const wob = (r() - 0.5) * 0.04
    ps.push({ name: HUES[slot].name, h, h2: (h + d2 + wob + 1) % 1, h3: (h + d3 - wob + 1) % 1, lum: lumFor(h) })
  }
  palettes.set(loop, ps)
  return ps
}

/** Which reality's colours a depth step belongs to (null = home, untinted). */
export function spectrumAt(step: number) {
  const k = ((step % DEPTH_CYCLE) + DEPTH_CYCLE) % DEPTH_CYCLE
  if (k === 0) return null
  const i = k - 1
  const slot = Math.floor(i / SHADES.length)
  return { index: k, hue: palettesFor(Math.floor(step / DEPTH_CYCLE))[slot], shade: SHADES[i % SHADES.length] }
}

/** 'home' or the hue's name — the realm a step belongs to. */
export function hueKey(step: number) {
  return spectrumAt(step)?.hue.name ?? 'home'
}

/** Does crossing from step a to step b change colour (and so pass through a black hole)? */
export function isHueChange(a: number, b: number) {
  return hueKey(a) !== hueKey(b)
}

/** Colour of the matter swirling around the hole: the realm waiting on the other side. */
export function ringColorFor(step: number, out: THREE.Color) {
  if (isEther(step)) return out.set('#a8ecff') // the ether: its own pale living light
  const sp = spectrumAt(step)
  if (!sp) return out.set('#c9bcff') // home: the moonlit violet you arrived in
  return out.setHSL(sp.hue.h3, 0.95, 0.6)
}

type Tint = { horizon: THREE.Color; top: THREE.Color; glow: THREE.Color; key: THREE.Color; fill: THREE.Color; hazeA: THREE.Color; hazeB: THREE.Color; exposure: number }
const makeTint = (): Tint => ({
  horizon: new THREE.Color(), top: new THREE.Color(), glow: new THREE.Color(), key: new THREE.Color(),
  fill: new THREE.Color(), hazeA: new THREE.Color(), hazeB: new THREE.Color(), exposure: 0,
})
const tA = makeTint()
const tB = makeTint()
const homeHazeA = new THREE.Color('#7b6cd9')
const homeHazeB = new THREE.Color('#4f6fb8')
const hc = new THREE.Color()

/** Light for one step: the hour's light, or the hour's light dreamed in that step's colour. */
const etherTint = {
  horizon: new THREE.Color('#0b1424'), top: new THREE.Color('#03050c'), glow: new THREE.Color('#bfeaff'),
  key: new THREE.Color('#bfe6ff'), fill: new THREE.Color('#8a7fd8'), hazeA: new THREE.Color('#5f8fd0'), hazeB: new THREE.Color('#7a5fc8'),
}
function tintFor(step: number, out: Tint) {
  if (isEther(step)) {
    const e = etherTint
    out.horizon.copy(e.horizon); out.top.copy(e.top); out.glow.copy(e.glow)
    out.key.copy(e.key); out.fill.copy(e.fill); out.hazeA.copy(e.hazeA); out.hazeB.copy(e.hazeB)
    out.exposure = 1.4
    return
  }
  const sp = spectrumAt(step)
  if (!sp) {
    out.horizon.copy(day.horizon); out.top.copy(day.top); out.glow.copy(day.glow)
    out.key.copy(day.key); out.fill.copy(day.fill)
    out.hazeA.copy(homeHazeA); out.hazeB.copy(homeHazeB)
    out.exposure = day.exposure
    return
  }
  const { h, h2, h3, lum } = sp.hue
  const l2 = lumFor(h2), l3 = lumFor(h3)
  const sh = sp.shade
  // a dream in several colours: the sky in one, the horizon and its haze in another,
  // the glow (and everything lit by it) in a third; the darkness stays
  out.horizon.copy(day.horizon).lerp(hc.setHSL(h2, 0.75, sh.horizonL * l2), 0.85)
  out.top.copy(day.top).lerp(hc.setHSL(h, 0.7, sh.topL * lum), 0.75)
  out.glow.copy(day.glow).lerp(hc.setHSL(h3, 0.85, sh.glowL * (0.5 + 0.5 * l3)), 0.85)
  out.key.copy(day.key).lerp(hc.setHSL(h, 0.7, 0.72), 0.65)
  out.fill.copy(day.fill).lerp(hc.setHSL(h2, 0.5, 0.6), 0.55)
  out.hazeA.setHSL(h2, 0.8, 0.42 * l2)
  out.hazeB.setHSL(h3, 0.7, 0.3 * l3)
  out.exposure = day.exposure + sh.exposure
}

/**
 * Called every frame with the continuous depth (in steps). The colour glides
 * from one shade's tint to the next. A world clamps depth to its own zone, so
 * its colours never bleed toward a neighbouring zone's.
 */
export function applySpectrum(depthInSteps: number, out: LightState = light) {
  const light = out
  light.hour = sharedSky.hour
  light.moonPhase = sharedSky.moonPhase
  light.moonLight = sharedSky.moonLight
  const base = Math.floor(depthInSteps)
  const frac = depthInSteps - base
  const t = THREE.MathUtils.smoothstep(frac, 0.3, 0.7)
  tintFor(base, tA)
  tintFor(base + 1, tB)
  light.horizon.copy(tA.horizon).lerp(tB.horizon, t)
  light.top.copy(tA.top).lerp(tB.top, t)
  light.glow.copy(tA.glow).lerp(tB.glow, t)
  light.key.copy(tA.key).lerp(tB.key, t)
  light.fill.copy(tA.fill).lerp(tB.fill, t)
  light.hazeA.copy(tA.hazeA).lerp(tB.hazeA, t)
  light.hazeB.copy(tA.hazeB).lerp(tB.hazeB, t)
  light.exposure = THREE.MathUtils.lerp(tA.exposure, tB.exposure, t)
  light.keyI = day.keyI
}


/**
 * Where the journey starts: home, unless ?at= names a colour (its light shade)
 * or a step number — handy for visiting a universe directly.
 */
export const START_STEP = (() => {
  const at = params.get('at')
  if (!at) return 0
  const n = Number(at)
  if (Number.isInteger(n)) return n
  const i = HUES.findIndex((h) => h.name === at.toLowerCase())
  return i < 0 ? 0 : 1 + i * SHADES.length
})()

updateLight(arrivedAt)
applySpectrum(START_STEP)
