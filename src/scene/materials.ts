import * as THREE from 'three'
import { rockGeometry, shardGeometry } from './geometry'
import { spectrumAt } from './moment'
import type { Form } from './forms'

const CRYSTALS = [
  { name: 'violet', color: '#cfc8ff', emissive: '#5b4fd0' },
  { name: 'ice', color: '#c8f2ff', emissive: '#2a86ad' },
  { name: 'rose', color: '#ffd2e2', emissive: '#a8456f' },
  { name: 'amber', color: '#ffe2b8', emissive: '#b07a35' },
]

const crystalMaterial = () =>
  new THREE.MeshStandardMaterial({
    emissiveIntensity: 0.6,
    roughness: 0.18,
    metalness: 0.28,
    flatShading: true,
  })

export type WorldMats = {
  stone: THREE.MeshStandardMaterial
  dark: THREE.MeshStandardMaterial
  crystal: THREE.MeshStandardMaterial
  accent: THREE.MeshStandardMaterial
  /** the colour crystal light casts (wisps, dissolve seams) */
  crystalLight: THREE.Color
}

/**
 * Each world's own materials: its stone (obsidian, sandstone, gilt, moss, frost,
 * slate…) and its mineral, a dominant hue and a rarer accent. Every world owns
 * its set, so two worlds can exist at once without repainting each other.
 * (Same material types everywhere, so the GPU programs are shared and nothing recompiles.)
 */
export function makeWorldMats(step: number, form: Form, rng: () => number): WorldMats {
  const stone = new THREE.MeshStandardMaterial({
    color: form.stone.color,
    roughness: form.stone.rough,
    metalness: form.stone.metal,
    flatShading: true,
  })
  const dark = new THREE.MeshStandardMaterial({ color: form.dark, roughness: 0.95, flatShading: true })
  const crystal = crystalMaterial()
  const accent = crystalMaterial()
  const crystalLight = new THREE.Color()

  const sp = spectrumAt(step)
  if (sp) {
    // in the spectrum, the mineral grows in the colour of the place
    // crystals glow in the palette's third colour, their accents in its second
    const { h2, h3 } = sp.hue
    crystal.color.setHSL(h3, 0.75, 0.84)
    crystal.emissive.setHSL(h3, 0.8, 0.32)
    accent.color.setHSL(h2, 0.7, 0.84)
    accent.emissive.setHSL(h2, 0.8, 0.3)
  } else {
    const primary = CRYSTALS[Math.floor(rng() * CRYSTALS.length)]
    const rest = CRYSTALS.filter((c) => c !== primary)
    const second = rest[Math.floor(rng() * rest.length)]
    crystal.color.set(primary.color)
    crystal.emissive.set(primary.emissive)
    accent.color.set(second.color)
    accent.emissive.set(second.emissive)
  }
  crystalLight.copy(crystal.emissive).lerp(new THREE.Color('#ffffff'), 0.25)
  return { stone, dark, crystal, accent, crystalLight }
}

export function disposeWorldMats(m: WorldMats) {
  m.stone.dispose()
  m.dark.dispose()
  m.crystal.dispose()
  m.accent.dispose()
}

export const islandGeo = rockGeometry(9.3, { island: true, detail: 3, rough: 0.38 })
export const bigRockGeo = rockGeometry(4.21, { detail: 3, rough: 0.5 })
export const shard = shardGeometry()
