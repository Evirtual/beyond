import { homeSeed, rngForSeed, spectrumAt, zoneOf } from './moment'

/**
 * Realities: what each leap through a black hole lands you in. Beyond home everything is
 * pattern: the world folded into a mandala around its black hole, with more mandalas
 * appearing in front of it. A reality decides how:
 *
 * - its law of perception (how the world shows itself through the glass — see Glass.tsx)
 * - its mandala: how many folds, which way and how fast it turns, how its arms twist
 * - its mood (how the air and forms move — Field.tsx) and how things come and go (dissolve.ts)
 * - how often mandalas appear, how large, and how dim the field behind them is
 *
 * Every realm is generated fresh — from this visitor's seed and the realm's place in the
 * journey, so it is the same if you go back to it, but no two are alike — and each is kept
 * clearly unlike the one before it.
 */

/** Laws (applied in the glass). */
export const LAW = {
  attention: 1,
  echo: 2,
  mirror: 3,
  edges: 4,
  opposite: 5,
  particles: 6,
  breath: 7,
  liquid: 8,
  strata: 9,
  recursion: 10,
  heat: 11,
  mosaic: 12,
  nautilus: 13,
} as const

export type Reality = {
  name: string
  law: number
  /** mood of the field: 0 warm … 5 veil (see Field.tsx) */
  mood: number
  /** how things come and go: 0 burn … 6 dots (see dissolve.ts) */
  dissolve: number
  folds: number
  spin: number
  twist: number
  /** how often mandalas appear (× the usual rate) */
  bloom: number
  /** how large they grow (× the usual size) */
  scale: number
  /** how bright the folded field stays behind them (0..1) */
  dim: number
  /** the mandala's structure: 0 well, 1 bloom, 2 vortex, 3 inversion, 4 crystal, 5 lattice, 6 twins */
  shape: number
  /** how the mandala moves: 0 dive, 1 sink, 2 from the sides, 3 from above and below, 4 pulse, 5 bloom, 6 vortex, 7 turn */
  motion: number
}

/** How many kinds of motion there are (see MOTIONS in Glass.tsx). */
export const MOTION_COUNT = 8

/** How many mandala structures there are (see realmView in Glass.tsx). */
export const SHAPES = 7

// words for names: what kind of place, and what it is like
const NOUNS = ['bloom', 'garden', 'chamber', 'sea', 'lantern', 'veil', 'well', 'eye', 'shell', 'choir', 'orchard', 'temple', 'tide', 'hive', 'loom', 'lotus', 'mirror', 'gate', 'reef', 'cathedral', 'seed', 'storm', 'river', 'crown']
const WORDS = ['turning', 'hollow', 'golden', 'quiet', 'endless', 'folded', 'sleeping', 'open', 'inward', 'burning', 'drowned', 'woven', 'breathing', 'scattered', 'singing', 'patient', 'unseen', 'returning', 'thousand-fold', 'slow', 'remembered', 'weightless', 'tender', 'vast']

const cache = new Map<number, Reality>()

/** Preview: ?reality=<law name> puts that law in every realm (e.g. ?reality=nautilus). */
const previewLaw = (() => {
  const q = new URLSearchParams(location.search).get('reality')?.toLowerCase()
  return q && q in LAW ? LAW[q as keyof typeof LAW] : null
})()

/** Preview: ?shape=<name or 0–6> gives every realm that mandala structure (e.g. ?shape=crystal). */
const SHAPE_NAMES = ['well', 'bloom', 'vortex', 'inversion', 'crystal', 'lattice', 'twins']
const previewShape = (() => {
  const q = new URLSearchParams(location.search).get('shape')?.toLowerCase()
  if (!q) return null
  const n = SHAPE_NAMES.indexOf(q)
  return n >= 0 ? n : Number.isInteger(Number(q)) ? Math.min(SHAPES - 1, Math.max(0, Number(q))) : null
})()

/** Preview: ?motion=<name or 0–7> gives every realm that motion (e.g. ?motion=sides). */
const MOTION_NAMES = ['dive', 'sink', 'sides', 'vertical', 'pulse', 'bloom', 'vortex', 'turn']
const previewMotion = (() => {
  const q = new URLSearchParams(location.search).get('motion')?.toLowerCase()
  if (!q) return null
  const n = MOTION_NAMES.indexOf(q)
  return n >= 0 ? n : Number.isInteger(Number(q)) ? Math.min(MOTION_COUNT - 1, Math.max(0, Number(q))) : null
})()

function makeReality(start: number): Reality {
  const r = rngForSeed(homeSeed, 'reality' + start)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  // the realm before this one, if it was a pattern realm too: this one must differ from it
  const prevStart = zoneOf(start - 1).start
  const prev = spectrumAt(prevStart) ? realityFor(prevStart) : null

  let law = 1 + Math.floor(r() * 13)
  if (prev && law === prev.law) law = (law % 13) + 1
  if (previewLaw) law = previewLaw
  let folds = 3 + Math.floor(r() * 12)
  if (prev && Math.abs(folds - prev.folds) < 2) folds = folds + 4 > 14 ? folds - 4 : folds + 4
  // every realm is the mandala well; the other structures stay available only to preview (?shape=)
  const shape = previewShape ?? 0
  let motion = Math.floor(r() * MOTION_COUNT)
  if (prev && motion === prev.motion) motion = (motion + 1 + Math.floor(r() * (MOTION_COUNT - 1))) % MOTION_COUNT
  if (previewMotion !== null) motion = previewMotion
  let mood = Math.floor(r() * 6)
  if (prev && mood === prev.mood) mood = (mood + 1 + Math.floor(r() * 5)) % 6
  return {
    name: `the ${pick(WORDS)} ${pick(NOUNS)}`,
    law,
    mood,
    dissolve: Math.floor(r() * 7),
    folds,
    spin: (0.006 + r() * 0.03) * (r() < 0.5 ? -1 : 1),
    twist: r() < 0.4 ? 0.3 + r() * 1.7 : 0,
    bloom: 0.6 + r(),
    scale: 0.7 + r() * 0.7,
    dim: 0.45 + r() * 0.35,
    shape,
    motion,
  }
}

/** The reality a step belongs to (null at home). */
export function realityFor(step: number): Reality | null {
  if (!spectrumAt(step)) return null
  const start = zoneOf(step).start
  let rl = cache.get(start)
  if (!rl) {
    rl = makeReality(start)
    cache.set(start, rl)
  }
  return rl
}
