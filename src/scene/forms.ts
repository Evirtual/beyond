import * as THREE from 'three'
import { rockGeometry, shardGeometry } from './geometry'
import { formNameFor, type FormName } from './moment'

/**
 * Each colour realm is its own place: what floats there, what its stone is
 * made of, which colossi stand on its horizon, what drifts past the glass.
 * Nothing is shared with the next realm except the darkness.
 */
export type FarKind =
  | 'Halo' | 'Ziggurat' | 'MonolithField' | 'GreatArch' | 'Planetoid' | 'Spire'
  | 'SpikeRange' | 'MesaRange' | 'SunWheel' | 'GreatTree' | 'IceRange' | 'InvertedPyramid'
export type ForegroundKind = 'boulder' | 'pillar' | 'hanging' | 'blade' | 'hoodoo' | 'orb' | 'mushroom' | 'spire' | 'monolith'
export type DebrisKind = 'rock' | 'shard' | 'flat' | 'sphere' | 'leaf' | 'ice' | 'cube'

export type Form = {
  /** how stone is shaped here */
  rock: { detail: number; rough: number }
  /** what stone is made of here */
  stone: { color: string; rough: number; metal: number }
  dark: string
  /** loose stone is squashed or stretched (x, y, z) */
  stretch: THREE.Vector3Tuple
  /** crystals grow longer (>1) or stubbier (<1) */
  shardStretch: number
  /** which midground objects exist here, and how common each is (keys of PIECES) */
  kinds: Record<string, number>
  /** which colossal shapes stand far off */
  far: FarKind[]
  /** what presses against the glass */
  fg: ForegroundKind[]
  /** what drifts past */
  debris: DebrisKind
  debrisGlows: boolean
  /** how thick the air (or water, or void) is */
  fog?: number
  /** the universe's name, shown on arrival */
  universe?: string
  /** how much of the colour's light reaches this universe's sky and air (1 = all; space is dark) */
  ambience?: number
}

export const FORMS: Record<FormName, Form> = {
  home: {
    rock: { detail: 2, rough: 0.42 },
    stone: { color: '#6c6a78', rough: 0.92, metal: 0.05 },
    dark: '#3b3946',
    stretch: [1, 1, 1],
    shardStretch: 1,
    kinds: { rock: 3, rockPair: 2, crystalIsland: 2.6, gateway: 0.9, obelisk: 0.9, shardRing: 1.3, stair: 1 },
    far: ['Halo', 'Ziggurat', 'MonolithField', 'GreatArch', 'Planetoid', 'Spire'],
    fg: ['boulder', 'boulder', 'pillar', 'hanging'],
    debris: 'rock',
    debrisGlows: false,
  },
  // red · ember: obsidian blades, fire under stone, spines
  jagged: {
    universe: 'where you look, it is',
    fog: 0.02,
    ambience: 0.32,
    rock: { detail: 1, rough: 0.8 },
    stone: { color: '#2b2226', rough: 0.3, metal: 0.55 },
    dark: '#160f12',
    stretch: [0.85, 1.3, 0.85],
    shardStretch: 1.6,
    kinds: { blades: 3, molten: 3, urchin: 2.4 },
    far: ['SpikeRange', 'SpikeRange', 'MonolithField', 'Spire'],
    fg: ['blade', 'blade', 'hanging'],
    debris: 'shard',
    debrisGlows: false,
  },
  // orange · dune: strata, wind-carved columns, arches
  eroded: {
    universe: 'nothing passes',
    fog: 0.032,
    ambience: 0.7,
    rock: { detail: 2, rough: 0.28 },
    stone: { color: '#9a7458', rough: 0.95, metal: 0 },
    dark: '#5e4232',
    stretch: [1.55, 0.55, 1.35],
    shardStretch: 0.75,
    kinds: { mesa: 2.6, hoodoo: 3, arch: 2.4 },
    far: ['MesaRange', 'MesaRange', 'Ziggurat', 'GreatArch'],
    fg: ['hoodoo', 'hoodoo', 'boulder'],
    debris: 'flat',
    debrisGlows: false,
  },
  // yellow · sun: spheres, orbits, wheels, lanterns
  radiant: {
    universe: 'all is reflection',
    fog: 0.012,
    ambience: 0.45,
    rock: { detail: 3, rough: 0.14 },
    stone: { color: '#b9ab8a', rough: 0.4, metal: 0.5 },
    dark: '#6e6450',
    stretch: [1, 1, 1],
    shardStretch: 0.9,
    kinds: { orb: 3, orrery: 2.6, sunWheel: 2, lanterns: 2.4 },
    far: ['SunWheel', 'Planetoid', 'Planetoid', 'Halo'],
    fg: ['orb', 'orb', 'boulder'],
    debris: 'sphere',
    debrisGlows: true,
  },
  // green · grove: crystal trees, mushrooms, vines
  grown: {
    universe: 'only edges',
    fog: 0.028,
    ambience: 0.22,
    rock: { detail: 3, rough: 0.32 },
    stone: { color: '#5b6648', rough: 0.9, metal: 0 },
    dark: '#30382a',
    stretch: [1.15, 0.85, 1.15],
    shardStretch: 1.3,
    kinds: { tree: 3, mushrooms: 3.2, vine: 2.4 },
    far: ['GreatTree', 'GreatTree', 'Planetoid', 'GreatArch'],
    fg: ['mushroom', 'mushroom', 'pillar'],
    debris: 'leaf',
    debrisGlows: true,
  },
  // blue · glacier: ice spires, bergs, snowflakes, icicles
  glacial: {
    universe: 'the other side',
    fog: 0.05,
    rock: { detail: 1, rough: 0.32 },
    stone: { color: '#8fa3b8', rough: 0.45, metal: 0.15 },
    dark: '#46566a',
    stretch: [0.65, 1.8, 0.65],
    shardStretch: 1.8,
    kinds: { iceSpires: 3, iceberg: 2.6, snowflake: 2, icicles: 2.4 },
    far: ['IceRange', 'IceRange', 'Spire', 'MonolithField'],
    fg: ['spire', 'spire', 'hanging'],
    debris: 'ice',
    debrisGlows: true,
  },
  // violet · arcane: runes, orbits, inverted temples, gates
  arcane: {
    universe: 'held by light',
    fog: 0.006,
    ambience: 0.07,
    rock: { detail: 2, rough: 0.4 },
    stone: { color: '#4a4458', rough: 0.65, metal: 0.25 },
    dark: '#26222f',
    stretch: [1, 1, 1],
    shardStretch: 1,
    kinds: { runeMonolith: 2.6, orbiters: 2.4, invPyramid: 2.2, gateway: 1.2, stair: 1.2 },
    far: ['InvertedPyramid', 'InvertedPyramid', 'Halo', 'Ziggurat'],
    fg: ['monolith', 'monolith', 'hanging'],
    debris: 'cube',
    debrisGlows: false,
  },
}

/** The form of the zone a step belongs to. */
export function formFor(step: number): Form {
  return FORMS[formNameFor(step)]
}

const rockCache = new Map<string, THREE.BufferGeometry[]>()
/** Six stone shapes, weathered the way this realm weathers them. Cached per form. */
export function rockSet(form: Form) {
  const key = `${form.rock.detail}:${form.rock.rough}`
  let set = rockCache.get(key)
  if (!set) {
    set = Array.from({ length: 6 }, (_, i) => rockGeometry(i * 3.17 + 1, form.rock))
    rockCache.set(key, set)
  }
  return set
}

const debrisCache = new Map<DebrisKind, THREE.BufferGeometry>()
/** What drifts past the glass in this realm. */
export function debrisGeometry(form: Form) {
  let g = debrisCache.get(form.debris)
  if (g) return g
  switch (form.debris) {
    case 'shard': g = new THREE.TetrahedronGeometry(1, 0).scale(0.6, 1.6, 0.6); break
    case 'flat': g = rockGeometry(2.2, { detail: 1, rough: 0.3 }).scale(1.4, 0.4, 1.2); break
    case 'sphere': g = new THREE.IcosahedronGeometry(0.8, 2); break
    case 'leaf': g = new THREE.OctahedronGeometry(1, 0).scale(1, 0.12, 0.55); break
    case 'ice': g = shardGeometry().translate(0, -0.85, 0).scale(1.2, 1, 1.2); break
    case 'cube': g = new THREE.BoxGeometry(1.1, 1.1, 1.1); break
    default: g = rockSet(form)[1]
  }
  debrisCache.set(form.debris, g)
  return g
}
