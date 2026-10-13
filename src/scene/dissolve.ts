import * as THREE from 'three'
import type { Reality } from './reality'

export type DissolveUniform = { value: number }

/**
 * How things come and go — each reality has its own way:
 * 0 burn (home): fragments burn away behind a thin glowing seam
 * 1 smoke (attention): it rises and curls away in soft wisps
 * 2 sand (echo): it erodes grain by grain from one side and blows away
 * 3 shatter (mirror): it breaks into hard shards with bright edges
 * 4 drawing (edges): a bright line draws it in from below, and erases it again
 * 5 melt (the other side): it sags and drips away, top first
 * 6 dots (particles): it breaks into shrinking dots that drift apart
 */
export const dissolveStyle = (w: { reality: Reality | null }) => w.reality?.dissolve ?? 0

const NOISE = /* glsl */ `
  float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`

/** Where the vertices go as it leaves (dv: 0 solid → 1 gone). */
const MOVE: Record<number, string> = {
  0: '',
  // smoke: lifted and curled away, the higher parts first
  1: `transformed += vec3(sin(position.y * 2.3 + position.z) * 0.35, 1.2 + position.y * 0.3, cos(position.x * 2.1) * 0.35) * dv * dv * (0.6 + dNoise(position * 1.3)) * 2.2;`,
  // sand: carried away sideways on a wind, grain by grain
  2: `transformed += vec3(1.6, 0.25, 0.4) * dv * dv * (0.4 + dNoise(position * 4.0)) * 2.5;`,
  // shatter: pieces pushed out along their faces
  3: `transformed += normal * dv * dv * dHash(floor(position * 2.5)) * 1.6;`,
  // drawing: nothing moves; the line does the work
  4: '',
  // melt: it sags, and the bottom spreads as it pools
  5: `float sag = dv * dv * (1.2 + dNoise(position * 2.0) * 1.4);
     transformed.y -= sag * (1.0 + position.y * 0.25);
     transformed.xz *= 1.0 + sag * 0.25 * smoothstep(0.0, -1.0, position.y);`,
  // dots: everything drifts a little apart
  6: `transformed += normal * dv * 0.7 + (vec3(dNoise(position * 3.0), dNoise(position * 3.0 + 5.0), dNoise(position * 3.0 + 9.0)) - 0.5) * dv * 1.2;`,
}

/** Which fragments are already gone, and how the edge of what remains glows. */
const CUT: Record<number, string> = {
  0: `float dn = dNoise(vDisPos * 1.7) * 0.6 + dNoise(vDisPos * 5.3) * 0.4;
      float thr = uDissolve * 1.1 - 0.05;
      if (dn < thr) discard;
      totalEmissiveRadiance += uEdge * smoothstep(thr + 0.07, thr, dn) * 4.0;`,
  // smoke: soft, tall wisps, a dim warm edge
  1: `float dn = dNoise(vDisPos * vec3(1.4, 0.5, 1.4)) * 0.7 + dNoise(vDisPos * 3.1) * 0.3;
      float thr = uDissolve * 1.15 - 0.08;
      if (dn < thr) discard;
      totalEmissiveRadiance += uEdge * smoothstep(thr + 0.18, thr, dn) * 1.6;`,
  // sand: fine grains, eaten from one side
  2: `float dn = dNoise(vDisPos * 14.0) * 0.55 + clamp(0.5 + vDisPos.x * 0.18, 0.0, 1.0) * 0.45;
      float thr = uDissolve * 1.1 - 0.05;
      if (dn < thr) discard;
      totalEmissiveRadiance += uEdge * smoothstep(thr + 0.04, thr, dn) * 2.0;`,
  // shatter: whole shards at once, bright clean edges
  3: `float dn = dHash(floor(vDisPos * 2.5));
      float thr = uDissolve * 1.05 - 0.02;
      if (dn < thr) discard;
      totalEmissiveRadiance += uEdge * step(dn, thr + 0.06) * 6.0;`,
  // drawing: a bright line sweeping up through it; below the line it exists
  4: `float g = clamp((vDisPos.y + 2.5) / 5.0, 0.0, 1.0) + (dNoise(vDisPos * 6.0) - 0.5) * 0.06;
      float lineAt = 1.08 - uDissolve * 1.16;
      if (g > lineAt) discard;
      totalEmissiveRadiance += uEdge * smoothstep(lineAt - 0.05, lineAt, g) * 7.0;`,
  // melt: drips running down from the top
  5: `float g = clamp((vDisPos.y + 2.5) / 5.0, 0.0, 1.0);
      float drip = dNoise(vec3(vDisPos.x * 4.0, 0.0, vDisPos.z * 4.0)) * 0.35;
      float lineAt = 1.15 - uDissolve * 1.4 + drip;
      if (g > lineAt) discard;
      totalEmissiveRadiance += uEdge * smoothstep(lineAt - 0.08, lineAt, g) * 2.5;`,
  // dots: the surface breaks into dots that shrink to nothing
  6: `vec3 cell = fract(vDisPos * 5.0) - 0.5;
      float r = 0.62 * (1.0 - uDissolve) + 0.02;
      if (length(cell) > r) discard;
      totalEmissiveRadiance += uEdge * smoothstep(r - 0.08, r, length(cell)) * 3.0 * step(0.001, uDissolve);`,
}

/**
 * Clone a lit material and let it come into / go out of existence in the given style.
 * uniform.value: 0 = solid, 1 = gone. Several clones can share one uniform.
 */
export function dissolvable<T extends THREE.Material>(base: T, uniform: DissolveUniform, edge: THREE.Color, style = 0) {
  const m = base.clone() as T
  m.onBeforeCompile = (s) => {
    s.uniforms.uDissolve = uniform
    s.uniforms.uEdge = { value: edge }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDisPos;\nuniform float uDissolve;\n' + NOISE)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDisPos = position;
        if (uDissolve > 0.0) {
          float dv = uDissolve;
          ${MOVE[style] ?? ''}
        }`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDissolve;
        uniform vec3 uEdge;
        varying vec3 vDisPos;
        ${NOISE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uDissolve > 0.0) {
          ${CUT[style] ?? CUT[0]}
        }`)
  }
  m.customProgramCacheKey = () => 'dissolve-' + base.type + '-' + style
  return m
}
