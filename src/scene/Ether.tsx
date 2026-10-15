import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useWorld } from './world'
import { view } from './state'
import { Motes } from './Particles'
import { BurstField } from './tap'

/**
 * The ether: the space between homes. No ground, no things — a substance you fly through.
 * Mist that moves like a slow liquid, folded over and over on itself, and threaded inside with
 * veins of living light. It is marched as a true volume, so it has depth from every angle:
 * lean and the near swirls slide across the far ones; fly and you pass through them.
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

/**
 * Noise baked once into a small tiling 3D texture: four independent smooth value noises (one per
 * channel), 16 lattice cells across. The volume reads it with single lookups instead of hashing
 * eight corners per sample — the difference between a slideshow and a smooth flight.
 */
const NOISE_SIZE = 64
const NOISE_CELLS = 16
let noiseTex: THREE.Data3DTexture | null = null
function etherNoise() {
  if (noiseTex) return noiseTex
  const N = NOISE_SIZE, C = NOISE_CELLS, per = N / C
  const data = new Uint8Array(N * N * N * 4)
  let s = 0x2545f491
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)), ((s >>> 0) % 65536) / 65536)
  const lattice = Array.from({ length: 4 }, () => Float32Array.from({ length: C * C * C }, rnd))
  const smooth = (f: number) => f * f * (3 - 2 * f)
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = x / per, gy = y / per, gz = z / per
        const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz)
        const fx = smooth(gx - ix), fy = smooth(gy - iy), fz = smooth(gz - iz)
        const x1 = (ix + 1) % C, y1 = (iy + 1) % C, z1 = (iz + 1) % C
        const at = (a: number, b: number, c: number) => a + b * C + c * C * C
        const o = (x + y * N + z * N * N) * 4
        for (let ch = 0; ch < 4; ch++) {
          const L = lattice[ch]
          const v00 = L[at(ix, iy, iz)] + (L[at(x1, iy, iz)] - L[at(ix, iy, iz)]) * fx
          const v10 = L[at(ix, y1, iz)] + (L[at(x1, y1, iz)] - L[at(ix, y1, iz)]) * fx
          const v01 = L[at(ix, iy, z1)] + (L[at(x1, iy, z1)] - L[at(ix, iy, z1)]) * fx
          const v11 = L[at(ix, y1, z1)] + (L[at(x1, y1, z1)] - L[at(ix, y1, z1)]) * fx
          const v0 = v00 + (v10 - v00) * fy
          const v1 = v01 + (v11 - v01) * fy
          data[o + ch] = Math.round((v0 + (v1 - v0) * fz) * 255)
        }
      }
  const tex = new THREE.Data3DTexture(data, N, N, N)
  tex.format = THREE.RGBAFormat
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  noiseTex = tex
  return tex
}

/** Which ether: milky light (default) or dark smoke (?ether=smoke), kept side by side to compare. */
const MILK = new URLSearchParams(location.search).get('ether') !== 'smoke'

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform float uTime, uSurge, uMilk;
  uniform vec3 uDeep, uMist, uVein, uVein2, uGlow;
  varying vec3 vWorld;

  // one lattice unit of noise = 1/16 of the tiling texture
  vec4 nz(vec3 p) { return texture(uNoise, p * 0.0625); }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    // a fixed per-pixel offset hides the march's steps without shimmering
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float T = uTime;

    vec3 col = vec3(0.0);
    float trans = 1.0;
    float t = 0.4 + jitter * 1.4;
    for (int i = 0; i < 16; i++) {
      vec3 q = (ro + rd * t) * 0.075;
      // liquid: the mist is folded by a slower flow of itself, so it swirls rather than scrolls
      vec3 warp = nz(q * 0.6 + vec3(0.0, T * 0.035, T * 0.02)).rgb - 0.5;
      vec3 r = q + warp * 2.6 + vec3(0.0, T * 0.018, 0.0);
      float d = nz(r).r * 0.55 + nz(r * 2.07 + 3.1).g * 0.3 + nz(r * 4.3 + 7.7).b * 0.15;
      float density = smoothstep(0.42, 0.8, d);
      // energy: thin bright seams where the flow folds — veins of light inside the substance
      vec4 sv = nz(r * 1.7 + vec3(T * 0.05, 0.0, -T * 0.04));
      // smoke: only a narrow band around the noise's middle reads as a seam (thin threads of light);
      // milk: a broad band, so the folds become wide soft sheets, like silk drawn through milk
      float seamD = (sv.a - 0.5) * 30.0;
      float thin = exp(-seamD * seamD) * smoothstep(0.55, 0.75, d);
      float silk = pow(1.0 - abs(sv.a * 2.0 - 1.0), 10.0) * smoothstep(0.3, 0.6, d);
      float vein = mix(thin, silk, uMilk);
      // the near swirls thin out as you reach them, so passing through never pops
      float near = smoothstep(0.6, 5.0, t);
      density *= near;
      vein *= near;

      float stepL = 1.3 + t * 0.12;
      vec3 mist = mix(uMist * 0.35, uMist, smoothstep(0.45, 0.85, d));
      vec3 veinCol = mix(uVein, uVein2, sv.g);
      col += trans * (mist * density * density * mix(0.005, 0.011, uMilk) + veinCol * vein * mix(0.03, 0.026, uMilk) * (1.0 + uSurge)) * stepL;
      trans *= exp(-density * 0.05 * stepL);
      t += stepL;
    }

    // beyond the swirls: a deep, faintly luminous field, brighter where the light gathers ahead
    float ahead = max(dot(rd, normalize(vec3(-0.2, 0.08, -1.0))), 0.0);
    vec3 bg = mix(uDeep, uDeep * 2.2, smoothstep(-0.4, 0.6, rd.y)) + uGlow * (pow(ahead, 8.0) * 0.18 + pow(ahead, 2.0) * 0.04);
    col += trans * bg;

    gl_FragColor = vec4(col, 1.0);
  }`


function EtherVolume() {
  const w = useWorld()
  const mesh = useRef<THREE.Mesh>(null!)
  const mat = useMemo(() => {
    // one palette, the same every time. milk (default): creamy white, folds tinted faintly like opal.
    // smoke (?ether=smoke): dark, pearl-blue mist with thin veins of pale cyan, violet and gold
    const p = MILK
      ? { deep: '#34313a', mist: '#e4ddd4', vein: '#fff8f2', vein2: '#e6eeff', glow: '#fff1dc' }
      : { deep: '#05071a', mist: '#9fb4e8', vein: '#a8f0ff', vein2: '#e2c8ff', glow: '#ffe8c4' }
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uNoise: { value: etherNoise() },
        uTime: { value: 0 },
        uSurge: { value: 0 },
        uMilk: { value: MILK ? 1 : 0 },
        uDeep: { value: new THREE.Color(p.deep) },
        uMist: { value: new THREE.Color(p.mist) },
        uVein: { value: new THREE.Color(p.vein) },
        uVein2: { value: new THREE.Color(p.vein2) },
        uGlow: { value: new THREE.Color(p.glow) },
      },
      vertexShader,
      fragmentShader,
    })
  }, [w])
  const surge = useRef(0)
  useFrame((s, dt) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime
    // the substance answers your motion: the veins brighten as you rush through
    const target = Math.min(Math.abs(view.speed) / 8, 1)
    surge.current += (target - surge.current) * Math.min(1, dt * 2)
    // the same seen through the hole as once inside it, so the crossing changes nothing
    mat.uniforms.uSurge.value = surge.current
    // the volume travels with the eye; the substance inside it stays put in the world
    mesh.current.position.copy(w.camera.position)
  })
  return (
    <mesh ref={mesh} material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[50, 32, 16]} />
    </mesh>
  )
}

/** The ether between homes: the volume, sparks of its energy, and touch that stirs out light. */
export function EtherContents() {
  const w = useWorld()
  const seed = useMemo(() => Math.floor(w.rng('ether-sparks')() * 1e6), [w])
  return (
    <>
      <EtherVolume />
      {/* sparks the substance gives off, rising slowly through it */}
      <Motes count={1400} zMin={2} zMax={70} spread={0.7} size={1.1} softness={1} rise={0.12} opacity={0.8} fog={0.02} seed={seed} tints={['#bff4ff', '#e6d4ff', '#fff1d6', '#9fd8ff']} />
      <Motes count={30} zMin={0.6} zMax={3} spread={0.9} size={0.8} softness={2} rise={0.04} opacity={0.5} fog={0} seed={seed + 1} tints={['#d8f6ff', '#efe2ff']} />
      <BurstField defaultBurst={{ color: '#c8f4ff', kind: 'rise', count: 80 }} />
    </>
  )
}
