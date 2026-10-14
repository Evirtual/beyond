import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { view } from './state'
import { mainCamera } from './WindowRig'
import { worlds, useWorld } from './world'

/**
 * Touch: everything marked touchable answers a click or a tap. It wobbles like
 * something struck, the world throws a burst of its own matter (embers, sand,
 * sparks, fireflies, bubbles, stars), glowing ground ripples outward from the
 * spot — and some things do more (onTap).
 */

export type BurstKind = 'rise' | 'fall' | 'spray' | 'ring'
export type Burst = { color: string; kind: BurstKind; count?: number }

type Touchable = { group: THREE.Group; burst?: Burst; onTap?: (point: THREE.Vector3) => void; jiggle: number; asleep?: () => boolean }

/** Per-world touch registry: what can be touched, and how the world bursts. */
export type TouchRegistry = {
  items: Set<Touchable>
  burst?: (at: THREE.Vector3, b: Burst) => void
  defaultBurst: Burst
}

export const touchRegistries = new WeakMap<object, TouchRegistry>()
export function registryFor(world: object, defaultBurst: Burst) {
  let r = touchRegistries.get(world)
  if (!r) touchRegistries.set(world, (r = { items: new Set(), defaultBurst }))
  return r
}

const DefaultBurst = createContext<Burst>({ color: '#d8d4ff', kind: 'spray' })
/** Sets how this world bursts when touched (its own matter). */
export function TouchStyle({ burst, children }: { burst: Burst; children: ReactNode }) {
  return <DefaultBurst.Provider value={burst}>{children}</DefaultBurst.Provider>
}

/** Glowing ground ripples: one ripple at a time, shared by every glowing material. */
export const ripple = { pos: { value: new THREE.Vector3(0, -1e4, 0) }, time: { value: -100 } }

/**
 * Wrap anything to make it touchable. The wrapper owns its own transform, so the
 * wobble never fights the child's own animation.
 */
/** asleep: while it returns true the thing ignores touches entirely (e.g. while it lies in pieces) */
export function Touchable({ children, burst, onTap, asleep }: { children: ReactNode; burst?: Burst; onTap?: (point: THREE.Vector3) => void; asleep?: () => boolean }) {
  const w = useWorld()
  const def = useContext(DefaultBurst)
  const ref = useRef<THREE.Group>(null!)
  const item = useRef<Touchable | null>(null)
  useEffect(() => {
    const reg = registryFor(w, def)
    const it: Touchable = { group: ref.current, burst, onTap, jiggle: -100, asleep }
    item.current = it
    reg.items.add(it)
    return () => void reg.items.delete(it)
  }, [w, def, burst, onTap, asleep])
  useFrame((s) => {
    const it = item.current
    if (!it) return
    // struck: a quick damped wobble and swell, then still again
    const age = s.clock.elapsedTime - it.jiggle
    const g = ref.current
    if (age >= 0 && age < 2.2) {
      const k = Math.exp(-age * 3.2)
      g.rotation.z = Math.sin(age * 18) * 0.06 * k
      g.rotation.x = Math.sin(age * 14 + 1) * 0.035 * k
      g.scale.setScalar(1 + Math.sin(age * 12) * 0.05 * k)
    } else if (g.scale.x !== 1) {
      g.rotation.set(0, 0, 0)
      g.scale.setScalar(1)
    }
  })
  return <group ref={ref}>{children}</group>
}

// ── bursts ──────────────────────────────────────────────────────────────────

const POOL = 1500
const LIFE = 1.8

/** A pool of burst particles for one world; registers the world's burst() function. */
export function BurstField({ defaultBurst }: { defaultBurst: Burst }) {
  const w = useWorld()
  const cursor = useRef(0)
  const clock = useThree((s) => s.clock)
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL * 3), 3))
    geo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(POOL * 3), 3))
    geo.setAttribute('aStart', new THREE.BufferAttribute(new Float32Array(POOL).fill(-100), 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(POOL * 3), 3))
    geo.setAttribute('aGrav', new THREE.BufferAttribute(new Float32Array(POOL), 1))
    geo.setAttribute('aScale', new THREE.BufferAttribute(new Float32Array(POOL).fill(1), 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uLife: { value: LIFE } },
      vertexShader: /* glsl */ `
        uniform float uTime, uLife;
        attribute vec3 aVel, aColor;
        attribute float aStart, aGrav, aScale;
        varying vec3 vColor; varying float vA;
        void main() {
          float age = uTime - aStart;
          float live = step(0.0, age) * step(age, uLife);
          float drag = (1.0 - exp(-age * 1.6)) / 1.6;     // fast out, slowing
          vec3 p = position + aVel * drag + vec3(0.0, aGrav * aScale * age * age, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = live * 4.0 * aScale * (10.0 / max(-mv.z, 0.1)) * (1.0 - age / uLife * 0.6);
          vA = live * (1.0 - smoothstep(uLife * 0.35, uLife, age));
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0 || vA <= 0.0) discard;
          gl_FragColor = vec4(vColor * pow(1.0 - r, 1.6) * vA * 1.6, 1.0);
        }`,
    })
    return { geo, mat }
  }, [])
  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])

  useEffect(() => {
    const reg = registryFor(w, defaultBurst)
    reg.defaultBurst = defaultBurst
    const c = new THREE.Color()
    const v = new THREE.Vector3()
    reg.burst = (at, b) => {
      const pos = geo.attributes.position as THREE.BufferAttribute
      const vel = geo.attributes.aVel as THREE.BufferAttribute
      const start = geo.attributes.aStart as THREE.BufferAttribute
      const col = geo.attributes.aColor as THREE.BufferAttribute
      const grav = geo.attributes.aGrav as THREE.BufferAttribute
      const scl = geo.attributes.aScale as THREE.BufferAttribute
      // a touch reads the same near or far: far bursts are bigger, so they look the same size
      const far = THREE.MathUtils.clamp(at.distanceTo(w.camera.position) / 12, 1, 7)
      const n = b.count ?? 90
      const now = clock.elapsedTime
      c.set(b.color)
      for (let k = 0; k < n; k++) {
        const i = cursor.current
        cursor.current = (cursor.current + 1) % POOL
        // each kind of burst has its own shape
        v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        let g = 0
        if (b.kind === 'rise') { v.y = Math.abs(v.y) * 1.6 + 0.4; v.multiplyScalar(2 + Math.random() * 4); g = 0.6 }
        else if (b.kind === 'fall') { v.multiplyScalar(2 + Math.random() * 3); g = -3 }
        else if (b.kind === 'ring') { v.y *= 0.15; v.normalize().multiplyScalar(4 + Math.random() * 3) }
        else v.multiplyScalar(1.5 + Math.random() * 4.5)
        pos.setXYZ(i, at.x, at.y, at.z)
        vel.setXYZ(i, v.x * far, v.y * far, v.z * far)
        scl.setX(i, far)
        start.setX(i, now + Math.random() * 0.08)
        const tint = 0.75 + Math.random() * 0.5
        col.setXYZ(i, c.r * tint, c.g * tint, c.b * tint)
        grav.setX(i, g)
      }
      ;[pos, vel, start, col, grav, scl].forEach((a) => (a.needsUpdate = true))
    }
    return () => {
      reg.burst = undefined
    }
  }, [w, geo, clock, defaultBurst])

  useFrame((s) => (mat.uniforms.uTime.value = s.clock.elapsedTime))
  return <points geometry={geo} material={mat} frustumCulled={false} />
}

// ── input: taps and hover, aimed through the window ─────────────────────────

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()

function hitTest(clientX: number, clientY: number) {
  const w = worlds.get(view.zoneStart)
  const cam = mainCamera.current
  if (!w || !cam) return null
  const reg = touchRegistries.get(w)
  if (!reg || reg.items.size === 0) return null
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1)
  // the world's own camera: same eye and projection, at that world's depth
  raycaster.setFromCamera(ndc, w.camera)
  raycaster.far = 140
  const awake = [...reg.items].filter((i) => !i.asleep?.())
  const groups = awake.map((i) => i.group)
  const hits = raycaster.intersectObjects(groups, true)
  if (!hits.length) return null
  const hit = hits[0]
  // which touchable owns the hit?
  let o: THREE.Object3D | null = hit.object
  while (o) {
    for (const it of awake) if (it.group === o) return { reg, it, point: hit.point.clone() }
    o = o.parent
  }
  return null
}

/** Listens for taps and hover on the canvas, and routes them into the world you're in. */
export function TapInput() {
  const gl = useThree((s) => s.gl)
  const clock = useThree((s) => s.clock)
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number; t: number } | null = null
    let lastHover = 0
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY, t: performance.now() })
    const onUp = (e: PointerEvent) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      const quick = performance.now() - down.t < 450
      down = null
      if (moved > 10 || !quick) return // a drag, not a tap
      const h = hitTest(e.clientX, e.clientY)
      if (!h) return
      h.it.jiggle = clock.elapsedTime
      h.reg.burst?.(h.point, h.it.burst ?? h.reg.defaultBurst)
      ripple.pos.value.copy(h.point)
      ripple.time.value = clock.elapsedTime
      h.it.onTap?.(h.point)
      if (import.meta.env.DEV) (window as unknown as { __lastTap: unknown }).__lastTap = { at: h.point.toArray().map((n) => +n.toFixed(1)), t: +clock.elapsedTime.toFixed(2) }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const now = performance.now()
      if (now - lastHover < 80) return
      lastHover = now
      el.style.cursor = hitTest(e.clientX, e.clientY) ? 'pointer' : ''
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
    }
  }, [gl, clock])
  return null
}
