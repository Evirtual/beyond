import * as THREE from 'three'

export type DissolveUniform = { value: number }

/**
 * Clone a lit material and let it burn in / out of existence: fragments are
 * discarded below a noise threshold, with a thin glowing seam at the edge.
 * uniform.value: 0 = solid, 1 = gone. Several clones can share one uniform.
 */
export function dissolvable<T extends THREE.Material>(base: T, uniform: DissolveUniform, edge: THREE.Color) {
  const m = base.clone() as T
  m.onBeforeCompile = (s) => {
    s.uniforms.uDissolve = uniform
    s.uniforms.uEdge = { value: edge }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDisPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDisPos = position;')
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uDissolve;
        uniform vec3 uEdge;
        varying vec3 vDisPos;
        float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float dNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        if (uDissolve > 0.0) {
          float dn = dNoise(vDisPos * 1.7) * 0.6 + dNoise(vDisPos * 5.3) * 0.4;
          float thr = uDissolve * 1.1 - 0.05;
          if (dn < thr) discard;
          totalEmissiveRadiance += uEdge * smoothstep(thr + 0.07, thr, dn) * 4.0;
        }`,
      )
  }
  m.customProgramCacheKey = () => 'dissolve-' + base.type
  return m
}
