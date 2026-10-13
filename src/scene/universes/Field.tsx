import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useWorld } from '../world'
import { view } from '../state'
import type { FormName } from '../moment'

/**
 * A FIELD — not a place to look at, a space to look into.
 *
 * Almost nothing is here on purpose: colour, mist, a band of light, and forms at the
 * edge of perception that rise out of the mist and dissolve again before they become
 * anything. The eye has nowhere to land, so the mind does the seeing — each person
 * finds something different in it.
 *
 * It breathes, slowly (about six breaths a minute). It answers stillness rather than
 * action: stay still and it deepens, the forms come clearer and the light opens;
 * move and it shimmers and withdraws. A touch sends a slow ring of light through it.
 */

type Mood = {
  /** how the forms are drawn out: [x, y] scale of their noise (smaller = longer that way) */
  stretch: [number, number]
  /** how much the forms fold into themselves */
  warp: number
  /** drift of the mist, per second, in noise units */
  drift: [number, number]
  /** where the band of light sits (0 = at eye level) and how wide it is */
  band: [number, number]
  /** forms read as darker than the light (silhouettes) or lighter (apparitions) */
  forms: 'dark' | 'light'
  /** breath depth */
  breath: number
}

const MOODS: Partial<Record<FormName, Mood>> = {
  // red · warm dark: round forms that slowly swell, like something heard through a wall
  jagged: { stretch: [1, 1], warp: 1.3, drift: [0.004, 0.006], band: [0.02, 0.22], forms: 'dark', breath: 1.2 },
  // orange · long horizon: everything drawn out sideways, low, endless
  eroded: { stretch: [0.3, 1.2], warp: 0.7, drift: [0.012, 0], band: [0.02, 0.12], forms: 'dark', breath: 0.9 },
  // yellow · open light: rising, vertical, the light itself is the form
  radiant: { stretch: [1.4, 0.35], warp: 0.8, drift: [0, 0.01], band: [0.02, 0.22], forms: 'light', breath: 1 },
  // green · slow growing: forms that branch and fold into each other
  grown: { stretch: [0.9, 0.9], warp: 2.2, drift: [0.003, 0.008], band: [0.02, 0.22], forms: 'dark', breath: 1 },
  // blue · deep quiet: slow currents moving past, the light from far above
  glacial: { stretch: [0.6, 1], warp: 1.6, drift: [0.014, 0.002], band: [0.02, 0.22], forms: 'light', breath: 1.1 },
  // violet · thin veil: hanging curtains, faint, rippling
  arcane: { stretch: [2.2, 0.4], warp: 1, drift: [0.006, -0.003], band: [0.02, 0.22], forms: 'light', breath: 0.8 },
}

const NOISE = /* glsl */ `
  float fh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float fn(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(fh(i), fh(i + vec3(1, 0, 0)), f.x), mix(fh(i + vec3(0, 1, 0)), fh(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(fh(i + vec3(0, 0, 1)), fh(i + vec3(1, 0, 1)), f.x), mix(fh(i + vec3(0, 1, 1)), fh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * fn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`

/** Moods in the order the realities name them (reality.ts MOOD) */
const MOOD_LIST = [MOODS.jagged, MOODS.eroded, MOODS.radiant, MOODS.grown, MOODS.glacial, MOODS.arcane]

/** The shared state of the field: breath, stillness, the last touch. */
const shared = {
  uTime: { value: 0 },
  uBreath: { value: 0 },
  uStill: { value: 0 },
  uTouch: { value: new THREE.Vector2(0.5, 0.5) },
  uTouchT: { value: -100 },
  uRes: { value: new THREE.Vector2(1, 1) },
  uOneness: { value: 0 },
  /** forms born where your attention rests: screen x, y, birth time (8 of them, recycled) */
  uEmit: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0.5, 0.5, -100)) },
}

/** The sky: a vertical wash of the world's colour and one wide band of light that breathes. */
function makeSky(mood: Mood, top: THREE.Color, horizon: THREE.Color, glow: THREE.Color) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { ...shared, uTop: { value: top }, uHorizon: { value: horizon }, uGlow: { value: glow }, uBand: { value: new THREE.Vector2(...mood.band) }, uBreathDepth: { value: mood.breath } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uGlow;
      uniform vec2 uBand;
      uniform float uBreath, uStill, uBreathDepth, uOneness;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(-0.3, 0.7, h));
        col = mix(col, uTop * 0.5, smoothstep(-0.1, -0.8, h));
        // the band of light: wide, soft, it breathes; stillness opens it
        float b = (h - uBand.x) / (uBand.y * (1.0 + 0.25 * uStill + 4.0 * uOneness));
        float band = exp(-b * b);
        col += uGlow * band * (0.22 + 0.1 * uBreath * uBreathDepth + 0.14 * uStill);
        col += uHorizon * band * 0.35;
        // oneness: no up, no down, one soft light
        vec3 one = mix(uHorizon, uGlow, 0.35) * 1.3 + uGlow * 0.08 * uBreath;
        col = mix(col, one, uOneness * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

/**
 * One layer of the field, hung at a fixed distance ahead of you so it never runs out.
 * `kind` 0 = mist (soft, everywhere), 1 = forms (shapes at the edge of perception).
 */
function makeLayer(mood: Mood, kind: number, depth: number, seed: number, tint: THREE.Color, dark: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...shared,
      uSeed: { value: seed },
      uDepth: { value: depth },
      uTravel: { value: 0 },
      uKind: { value: kind },
      uTint: { value: tint },
      uDark: { value: dark },
      uStretch: { value: new THREE.Vector2(...mood.stretch) },
      uWarp: { value: mood.warp },
      uDrift: { value: new THREE.Vector2(...mood.drift) },
      uLightForms: { value: mood.forms === 'light' ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBreath, uStill, uTouchT, uSeed, uDepth, uTravel, uKind, uWarp, uLightForms, uOneness;
      uniform vec2 uTouch, uRes, uStretch, uDrift;
      uniform vec3 uTint, uDark;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        vec2 q = (vUv - 0.5) * vec2(2.4, 1.4);
        float t = uTime;
        // travelling forward moves you through the field: the noise flows past with depth
        vec3 p = vec3(q * uStretch * (kindScale()), uSeed + uTravel * 0.035 + t * 0.012);
        p.xy += uDrift * t;
        // forms fold into themselves (domain warp)
        vec2 w = vec2(fbm(p + 3.1), fbm(p + 7.7)) - 0.5;
        float n = fbm(p + vec3(w * uWarp, 0.0));
        // a touch: a slow ring of light running out across the field
        vec2 fc = gl_FragCoord.xy / uRes;
        float age = t - uTouchT;
        float dist = length((fc - uTouch) * vec2(uRes.x / uRes.y, 1.0));
        float rr = (dist - age * 0.12) * 14.0;
        float ring = exp(-rr * rr) * exp(-age * 0.45) * step(0.0, age);
        // the layer fades out toward its edges, so no plane ever shows
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        // forms rise from the horizon (the middle of the layer) into the sky
        if (uKind > 0.5) edge *= smoothstep(0.47, 0.53, vUv.y) * smoothstep(0.95, 0.7, vUv.y);
        if (uKind < 0.5) {
          // mist: soft, everywhere, breathing
          float m = smoothstep(0.35, 0.85, n) * (0.55 + 0.25 * uBreath) * (1.0 - 0.3 * uStill);
          gl_FragColor = vec4(uTint * (1.0 + ring * 3.0), (m * 0.2 + ring * 0.25) * edge * (1.0 - 0.7 * uOneness));
        } else {
          // forms: a threshold that rises and falls, so shapes surface and dissolve;
          // stillness lets them come a little clearer
          float lvl = 0.52 + 0.05 * sin(t * 0.05 + uSeed) - 0.04 * uStill;
          float soft = 0.12 - 0.05 * uStill;
          float f = smoothstep(lvl, lvl + soft, n);
          vec3 c = mix(uDark, uTint * 1.4, uLightForms);
          gl_FragColor = vec4(c * (1.0 + ring * 2.0), f * (0.6 + 0.3 * uStill) * edge * (1.0 - 0.8 * uOneness));
        }
      }
      `.replace('kindScale()', kind < 0.5 ? '1.0' : '0.7'),
  })
}

/**
 * A plane of cloud stretching away to the horizon — below you (a sea of it) or high
 * above (a thin ceiling). Drawn in the world's own coordinates, so it truly recedes in
 * perspective and passes under you as you travel; it fades into the light at the horizon.
 */
function makeCloudPlane(mood: Mood, below: boolean, top: THREE.Color, horizon: THREE.Color, glow: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      ...shared,
      uTop: { value: top },
      uHorizon: { value: horizon },
      uGlow: { value: glow },
      uBelow: { value: below ? 1 : 0 },
      uStretch: { value: new THREE.Vector2(...mood.stretch) },
      uWarp: { value: mood.warp },
      uDrift: { value: new THREE.Vector2(...mood.drift) },
      uCam: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBreath, uStill, uOneness, uBelow, uWarp;
      uniform vec2 uStretch, uDrift;
      uniform vec3 uTop, uHorizon, uGlow, uCam;
      varying vec3 vW;
      ${NOISE}
      void main() {
        vec2 q = vW.xz * 0.018 * uStretch;
        q += uDrift * uTime * 6.0;
        vec2 w = vec2(fbm(vec3(q, 1.3)), fbm(vec3(q, 7.1))) - 0.5;
        float n = fbm(vec3(q + w * uWarp, uTime * 0.01));
        float dist = length(vW.xz - uCam.xz);
        float far = 1.0 - exp(-dist * 0.0045);          // how far toward the horizon
        vec3 col;
        float a;
        if (uBelow > 0.5) {
          // a sea of cloud: lit crests, shadowed hollows, all of it melting into the horizon light
          float crest = smoothstep(0.38, 0.72, n);
          col = mix(uTop * 0.55, mix(uHorizon, uGlow, 0.35) * 1.15, crest);
          col += uGlow * pow(crest, 3.0) * 0.18 * (0.8 + 0.2 * uBreath);
          col = mix(col, mix(uHorizon, uGlow, 0.25) * 1.2, far);
          a = smoothstep(0.0, 0.08, 1.0 - far * 0.0) ;
        } else {
          // a thin ceiling, high up: wisps with sky between them
          float wisp = smoothstep(0.5, 0.8, n);
          col = mix(uHorizon, uGlow, 0.2) * 1.1;
          col = mix(col, uHorizon * 1.2, far);
          a = wisp * 0.5 * (1.0 - far * 0.6);
        }
        col = mix(col, mix(uHorizon, uGlow, 0.35) * 1.3, uOneness * 0.85);
        gl_FragColor = vec4(col, a);
      }`,
  })
}

function CloudPlane({ mat, y }: { mat: THREE.ShaderMaterial; y: number }) {
  const w = useWorld()
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    const z = w.camZ()
    ref.current.position.set(0, y, z - 400)
    ;(mat.uniforms.uCam.value as THREE.Vector3).set(0, 0, z)
  })
  return (
    <mesh ref={ref} material={mat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={y < 0 ? -6 : -5.5} frustumCulled={false}>
      <planeGeometry args={[3000, 900, 1, 1]} />
    </mesh>
  )
}

/** Breath, stillness and touch: kept once for the whole field. */
function useFieldClock() {
  const w = useWorld()
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const last = useRef({ x: 0, y: 0, still: 0, one: 0, nextEmit: 0, emitIdx: 0, px: 0.5, py: 0.55, inputAt: -100 })
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      if (!w.isHere()) return
      const r = el.getBoundingClientRect()
      shared.uTouch.value.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height)
      shared.uTouchT.value = shared.uTime.value
    }
    // where your attention rests
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      last.current.px = view.px = (e.clientX - r.left) / r.width
      last.current.py = view.py = 1 - (e.clientY - r.top) / r.height
    }
    // your own input — not the hole's slow pull, which moves you even when you are still
    const input = () => (last.current.inputAt = performance.now() / 1000)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    window.addEventListener('wheel', input, { passive: true })
    window.addEventListener('touchmove', input, { passive: true })
    window.addEventListener('keydown', input)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      window.removeEventListener('wheel', input)
      window.removeEventListener('touchmove', input)
      window.removeEventListener('keydown', input)
      document.documentElement.style.setProperty('--oneness', '0')
      view.oneness = 0
    }
  }, [gl, w])
  useFrame((s, dt) => {
    if (!w.isHere()) return
    const d = Math.min(dt, 0.05)
    const t = s.clock.elapsedTime
    shared.uTime.value = t
    shared.uRes.value.set(size.width, size.height)
    // about six breaths a minute: slow enough that you start to breathe with it
    shared.uBreath.value = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 10)
    // stillness: grows slowly while you don't move, falls away quickly when you do
    const l = last.current
    const moved = Math.hypot(view.x - l.x, view.y - l.y) / Math.max(d, 1e-3) + (performance.now() / 1000 - l.inputAt < 0.6 ? 1 : 0)
    l.x = view.x
    l.y = view.y
    const target = moved > 0.05 ? 0 : 1
    l.still += (target - l.still) * (1 - Math.exp(-d * (target > l.still ? 0.18 : 2.5)))
    shared.uStill.value = l.still
    view.still = l.still
    // oneness: only after a long stillness (half a minute or so) do the boundaries go;
    // the slightest movement brings them gently back
    const deep = l.still > 0.85 ? 1 : 0
    l.one += (deep - l.one) * (1 - Math.exp(-d * (deep > l.one ? 0.06 : 1.2)))
    shared.uOneness.value = l.one
    view.oneness = l.one
    document.documentElement.style.setProperty('--oneness', l.one.toFixed(3))
    // a new form is born where your attention rests, every few seconds; more slowly, and
    // larger, the stiller you are
    if (t >= l.nextEmit) {
      l.nextEmit = t + 2.6 + l.still * 2
      shared.uEmit.value[l.emitIdx].set(l.px, l.py, t)
      l.emitIdx = (l.emitIdx + 1) % 8
    }
  })
}

/** A layer that hangs at its distance ahead of you, however far you travel. */
function Layer({ mat, depth }: { mat: THREE.ShaderMaterial; depth: number }) {
  const w = useWorld()
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    const z = w.camZ()
    ref.current.position.set(0, 0, z - depth)
    mat.uniforms.uTravel.value = -z
  })
  return (
    <mesh ref={ref} material={mat} renderOrder={-6 + 1 / depth}>
      <planeGeometry args={[depth * 3.4, depth * 2]} />
    </mesh>
  )
}

export function Field() {
  const w = useWorld()
  const mood = MOOD_LIST[w.reality?.mood ?? 0] ?? MOODS.jagged!
  useFieldClock()
  const sky = useMemo(() => makeSky(mood, w.light.top, w.light.horizon, w.light.glow), [mood, w])
  const layers = useMemo(() => {
    const r = w.rng('field')
    const dark = new THREE.Color()
    const out: { mat: THREE.ShaderMaterial; depth: number }[] = []
    // forms far off, two of them, at different depths so they slide against each other
    for (const depth of [260, 170]) out.push({ mat: makeLayer(mood, 1, depth, r() * 50, w.light.glow, dark), depth })
    // mist at many depths: the parallax between them is the depth you feel
    for (const depth of [90, 45]) out.push({ mat: makeLayer(mood, 0, depth, r() * 50, w.light.horizon, dark), depth })
    return out
  }, [mood, w])
  // the forms' darkness follows the world's darkest tone
  useFrame(() => layers.forEach((l) => (l.mat.uniforms.uDark.value as THREE.Color).copy(w.light.top).multiplyScalar(0.35)))
  useEffect(() => () => { sky.dispose(); layers.forEach((l) => l.mat.dispose()) }, [sky, layers])
  const sea = useMemo(() => makeCloudPlane(mood, true, w.light.top, w.light.horizon, w.light.glow), [mood, w])
  const ceiling = useMemo(() => makeCloudPlane(mood, false, w.light.top, w.light.horizon, w.light.glow), [mood, w])
  useEffect(() => () => { sea.dispose(); ceiling.dispose() }, [sea, ceiling])
  return (
    <>
      <mesh material={sky} renderOrder={-10}>
        <sphereGeometry args={[600, 48, 24]} />
      </mesh>
      {layers.map((l, i) => (
        <Layer key={i} {...l} />
      ))}
      <CloudPlane mat={sea} y={-14} />
      <CloudPlane mat={ceiling} y={34} />
      {/* (the motes, haze and light shafts come with home's elements) */}
    </>
  )
}
