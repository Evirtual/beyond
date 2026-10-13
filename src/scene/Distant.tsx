import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rockGeometry } from './geometry'
import { range } from './rng'
import { dissolvable, dissolveStyle, type DissolveUniform } from './dissolve'
import { useWorld } from './world'
import type { Form } from './forms'

/**
 * Far layer. These ignore scene fog and are tinted toward the horizon by
 * distance by hand (painterly aerial perspective), so silhouettes stay readable
 * instead of vanishing into exp² fog. The horizon colour follows the real
 * time of day, so the tint is refreshed live.
 */
const dark = new THREE.Color('#030308')
const tmp = new THREE.Color()

export function useSilhouette(dist: number, u?: DissolveUniform) {
  const w = useWorld()
  const { light } = w
  const mat = useMemo(() => {
    const base = new THREE.MeshLambertMaterial({ color: new THREE.Color('#1b1a2a'), emissive: new THREE.Color(), fog: false })
    return u ? dissolvable(base, u, light.glow, dissolveStyle(w)) : base
  }, [u])
  const t = THREE.MathUtils.smoothstep(dist, 70, 420)
  useFrame(() => {
    tmp.copy(dark).lerp(light.horizon, 0.25 + t * 0.7)
    ;(mat as THREE.MeshLambertMaterial).emissive.copy(tmp)
  })
  useEffect(() => () => mat.dispose(), [mat])
  return mat
}

type Placement = { pos: THREE.Vector3Tuple; scale: number; rot: number }
type StructProps = Placement & { u: DissolveUniform }

/** Colossal broken halo. Its gap turns with the real hour, like a clock hand. */
function Halo({ pos, scale, rot, u }: StructProps) {
  const { light } = useWorld()
  const mat = useSilhouette(-pos[2], u)
  const ref = useRef<THREE.Group>(null!)
  useFrame(() => {
    ref.current.rotation.z = -(light.hour / 12) * Math.PI * 2 + rot
  })
  return (
    <group position={pos} rotation={[0.25, 0.5, 0]} scale={scale}>
      <group ref={ref}>
        <mesh material={mat}>
          <torusGeometry args={[95, 3.2, 6, 120, Math.PI * 1.55]} />
        </mesh>
        <mesh material={mat} rotation={[0, 0, Math.PI * 1.62]}>
          <torusGeometry args={[95, 2.4, 6, 30, Math.PI * 0.18]} />
        </mesh>
      </group>
    </group>
  )
}

function Ziggurat({ pos, scale, rot, u }: StructProps) {
  const mat = useSilhouette(-pos[2], u)
  return (
    <group position={pos} rotation={[0, rot, 0]} scale={scale}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[0, i * 9, 0]} material={mat}>
          <boxGeometry args={[70 - i * 13, 9, 70 - i * 13]} />
        </mesh>
      ))}
      <mesh position={[0, 52, 0]} material={mat}>
        <boxGeometry args={[4, 30, 4]} />
      </mesh>
    </group>
  )
}

function MonolithField({ pos, scale, rot, u }: StructProps) {
  const { rng } = useWorld()
  const mat = useSilhouette(-pos[2], u)
  const items = useMemo(() => {
    const r = rng('monoliths' + rot)
    return Array.from({ length: 5 }, (_, i) => ({
      x: (i - 2) * range(r, 22, 34),
      h: range(r, 60, 190),
      w: range(r, 5, 14),
      tilt: range(r, -0.07, 0.07),
      z: range(r, -40, 40),
    }))
  }, [rot])
  return (
    <group position={pos} scale={scale}>
      {items.map((m, i) => (
        <mesh key={i} material={mat} position={[m.x, m.h / 2 - 60, m.z]} rotation={[0, 0.4, m.tilt]}>
          <boxGeometry args={[m.w, m.h, m.w]} />
        </mesh>
      ))}
    </group>
  )
}

/** A standing arch big enough to frame mountains. */
function GreatArch({ pos, scale, rot, u }: StructProps) {
  const mat = useSilhouette(-pos[2], u)
  return (
    <group position={pos} rotation={[0, rot, 0]} scale={scale}>
      <mesh material={mat}>
        <torusGeometry args={[60, 6, 4, 40, Math.PI]} />
      </mesh>
      <mesh material={mat} position={[-60, -40, 0]}>
        <boxGeometry args={[14, 80, 14]} />
      </mesh>
      <mesh material={mat} position={[60, -40, 0]}>
        <boxGeometry args={[14, 80, 14]} />
      </mesh>
    </group>
  )
}

/** A planetoid hanging low, half drowned in haze. */
function Planetoid({ pos, scale, u }: StructProps) {
  const mat = useSilhouette(-pos[2], u)
  const ring = useSilhouette(-pos[2] + 30, u)
  return (
    <group position={pos} scale={scale}>
      <mesh material={mat}>
        <icosahedronGeometry args={[55, 3]} />
      </mesh>
      <mesh material={ring} rotation={[1.3, 0.2, 0.3]}>
        <torusGeometry args={[90, 1.2, 4, 120]} />
      </mesh>
    </group>
  )
}

/** Tapering spire of stacked drums. */
function Spire({ pos, scale, rot, u }: StructProps) {
  const mat = useSilhouette(-pos[2], u)
  const drums = [0, 1, 2, 3, 4, 5, 6]
  return (
    <group position={pos} rotation={[0, 0, rot * 0.04]} scale={scale}>
      {drums.map((i) => (
        <mesh key={i} material={mat} position={[0, i * 26 - 60, 0]}>
          <cylinderGeometry args={[15 - i * 2, 17 - i * 2, 22, 8]} />
        </mesh>
      ))}
      <mesh material={mat} position={[0, 7 * 26 - 60, 0]}>
        <coneGeometry args={[2, 40, 8]} />
      </mesh>
    </group>
  )
}

/** red: a crown of black peaks. */
function SpikeRange({ pos, scale, rot, u }: StructProps) {
  const { rng } = useWorld()
  const mat = useSilhouette(-pos[2], u)
  const peaks = useMemo(() => {
    const r = rng('spikes' + rot)
    return Array.from({ length: 9 }, (_, i) => ({ x: (i - 4) * range(r, 14, 22), h: range(r, 50, 170), w: range(r, 8, 18), tilt: range(r, -0.15, 0.15) }))
  }, [rot])
  return (
    <group position={pos} scale={scale}>
      {peaks.map((p, i) => (
        <mesh key={i} material={mat} position={[p.x, p.h / 2 - 70, 0]} rotation={[0, i, p.tilt]}>
          <coneGeometry args={[p.w, p.h, 4]} />
        </mesh>
      ))}
    </group>
  )
}

/** orange: flat-topped giants, banded by time. */
function MesaRange({ pos, scale, rot, u }: StructProps) {
  const { rng } = useWorld()
  const mat = useSilhouette(-pos[2], u)
  const mesas = useMemo(() => {
    const r = rng('mesas' + rot)
    return Array.from({ length: 4 }, (_, i) => ({ x: (i - 1.5) * range(r, 45, 65), h: range(r, 40, 90), w: range(r, 25, 45) }))
  }, [rot])
  return (
    <group position={pos} scale={scale}>
      {mesas.map((m, i) => (
        <group key={i} position={[m.x, m.h / 2 - 60, 0]}>
          <mesh material={mat}>
            <cylinderGeometry args={[m.w * 0.85, m.w, m.h, 7]} />
          </mesh>
          <mesh material={mat} position={[0, m.h / 2 + 3, 0]}>
            <cylinderGeometry args={[m.w * 0.7, m.w * 0.82, 6, 7]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** yellow: a wheel of rays the size of a sky, turning very slowly. */
function SunWheelFar({ pos, scale, u }: StructProps) {
  const mat = useSilhouette(-pos[2], u)
  const ref = useRef<THREE.Group>(null!)
  useFrame((_, dt) => (ref.current.rotation.z += Math.min(dt, 0.05) * 0.01))
  const rays = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2)
  return (
    <group position={pos} scale={scale}>
      <group ref={ref}>
        <mesh material={mat}>
          <torusGeometry args={[60, 4, 6, 96]} />
        </mesh>
        {rays.map((a, i) => (
          <mesh key={i} material={mat} position={[Math.cos(a) * 82, Math.sin(a) * 82, 0]} rotation={[0, 0, a - Math.PI / 2]}>
            <coneGeometry args={[5, i % 2 ? 26 : 40, 4]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/** green: one tree, larger than mountains. */
function GreatTree({ pos, scale, rot, u }: StructProps) {
  const { rng } = useWorld()
  const mat = useSilhouette(-pos[2], u)
  const crowns = useMemo(() => {
    const r = rng('tree' + rot)
    return Array.from({ length: 7 }, () => ({ x: range(r, -70, 70), y: range(r, 70, 120), s: range(r, 25, 45) }))
  }, [rot])
  return (
    <group position={pos} scale={scale}>
      <mesh material={mat} position={[0, 10, 0]}>
        <cylinderGeometry args={[8, 18, 160, 8]} />
      </mesh>
      {crowns.map((c, i) => (
        <mesh key={i} material={mat} position={[c.x, c.y, 0]} scale={[c.s, c.s * 0.6, c.s]}>
          <icosahedronGeometry args={[1, 1]} />
        </mesh>
      ))}
    </group>
  )
}

/** blue: a serrated wall of ice needles. */
function IceRange({ pos, scale, rot, u }: StructProps) {
  const { rng } = useWorld()
  const mat = useSilhouette(-pos[2], u)
  const needles = useMemo(() => {
    const r = rng('ice' + rot)
    return Array.from({ length: 14 }, (_, i) => ({ x: (i - 7) * range(r, 9, 15), h: range(r, 80, 230), w: range(r, 4, 9) }))
  }, [rot])
  return (
    <group position={pos} scale={scale}>
      {needles.map((n, i) => (
        <mesh key={i} material={mat} position={[n.x, n.h / 2 - 80, 0]}>
          <coneGeometry args={[n.w, n.h, 5]} />
        </mesh>
      ))}
    </group>
  )
}

/** violet: a temple-mountain hanging point-down over nothing. */
function InvertedPyramidFar({ pos, scale, u }: StructProps) {
  const mat = useSilhouette(-pos[2], u)
  return (
    <group position={pos} scale={scale} rotation={[0, 0.5, 0]}>
      <mesh material={mat} rotation={[Math.PI, Math.PI / 4, 0]}>
        <coneGeometry args={[70, 110, 4]} />
      </mesh>
      <mesh material={mat} position={[0, 70, 0]}>
        <boxGeometry args={[40, 25, 40]} />
      </mesh>
      <mesh material={mat} position={[0, 95, 0]}>
        <boxGeometry args={[5, 30, 5]} />
      </mesh>
    </group>
  )
}

const CATALOG = {
  Halo,
  Ziggurat,
  MonolithField,
  GreatArch,
  Planetoid,
  Spire,
  SpikeRange,
  MesaRange,
  SunWheel: SunWheelFar,
  GreatTree,
  IceRange,
  InvertedPyramid: InvertedPyramidFar,
}
type StructKind = keyof typeof CATALOG
const KINDS = Object.keys(CATALOG) as StructKind[]

// three broad zones so structures don't pile up; each zone holds one at a time
const ZONES: { x: [number, number]; y: [number, number]; z: [number, number] }[] = [
  { x: [-170, -60], y: [-20, 40], z: [-380, -230] },
  { x: [-50, 50], y: [10, 50], z: [-420, -300] },
  { x: [60, 170], y: [-40, 20], z: [-380, -230] },
]

type Struct = { id: number; kind: StructKind; zone: number; place: Placement; leaving?: boolean; initial?: boolean }
// survives hot-reload re-execution, so ids never collide with live pieces
let nextId = Math.floor(performance.now() * 1000)

function makeStruct(r: () => number, zone: number, avoid: StructKind[], form: Form): Struct {
  const preferred = form.far.filter((k) => !avoid.includes(k))
  const pool = preferred.length ? preferred : KINDS.filter((k) => !avoid.includes(k))
  const kind = pool[Math.floor(r() * pool.length)]
  const zn = ZONES[zone]
  const z = range(r, zn.z[0], zn.z[1])
  return {
    id: nextId++,
    kind,
    zone,
    place: {
      pos: [range(r, zn.x[0], zn.x[1]) * (-z / 300), range(r, zn.y[0], zn.y[1]), z],
      scale: range(r, 0.8, 1.2),
      rot: range(r, -0.8, 0.8),
    },
  }
}

const FAR_DISSOLVE_SECONDS = 9
const FAR_FIRST = 45
const FAR_MIN = 60
const FAR_MAX = 110

function StructView({ s, onGone }: { s: Struct; onGone: (id: number) => void }) {
  const u = useMemo<DissolveUniform>(() => ({ value: s.initial ? 0 : 1 }), [s.initial])
  const progress = useRef(s.initial ? 0 : 1)
  const gone = useRef(false)
  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05) / FAR_DISSOLVE_SECONDS
    progress.current = THREE.MathUtils.clamp(progress.current + (s.leaving ? step : -step), 0, 1)
    const x = progress.current
    u.value = x * x * (3 - 2 * x)
    if (s.leaving && x >= 1 && !gone.current) {
      gone.current = true
      onGone(s.id)
    }
  })
  const C = CATALOG[s.kind]
  return <C {...s.place} u={u} />
}

function FarIsland({ pos, scale, seed }: { pos: THREE.Vector3Tuple; scale: number; seed: number }) {
  const geo = useMemo(() => rockGeometry(seed, { detail: 2, island: true, rough: 0.35 }), [seed])
  const mat = useSilhouette(-pos[2])
  const ref = useRef<THREE.Mesh>(null!)
  useFrame((s) => {
    ref.current.position.y = pos[1] + Math.sin(s.clock.elapsedTime * 0.05 + seed) * scale * 0.04
  })
  return <mesh ref={ref} position={pos} scale={[scale * 1.6, scale, scale * 1.3]} geometry={geo} material={mat} />
}

export function Distant() {
  const w = useWorld()
  const { form } = w
  const rng = useMemo(() => w.rng('distant'), [w])
  const [structs, setStructs] = useState<Struct[]>(() => {
    const arr: Struct[] = []
    for (let z = 0; z < ZONES.length; z++) arr.push({ ...makeStruct(rng, z, arr.map((a) => a.kind), form), initial: true })
    return arr
  })
  // counted from when this world appeared, not from page load
  const nextShift = useRef<number | null>(null)

  useFrame((st) => {
    if (nextShift.current === null) nextShift.current = st.clock.elapsedTime + FAR_FIRST
    if (st.clock.elapsedTime < nextShift.current) return
    nextShift.current = st.clock.elapsedTime + range(rng, FAR_MIN, FAR_MAX)
    setStructs((cur) => {
      const present = cur.filter((c) => !c.leaving)
      const out = present[Math.floor(rng() * present.length)]
      if (!out) return cur
      const marked = cur.map((c) => (c.id === out.id ? { ...c, leaving: true } : c))
      // avoid what is still standing; the departing one may return elsewhere
      return [...marked, makeStruct(rng, out.zone, marked.filter((m) => !m.leaving).map((m) => m.kind), form)]
    })
  })
  const onGone = useMemo(() => (id: number) => setStructs((cur) => cur.filter((c) => c.id !== id)), [])

  const islands = useMemo(() => {
    const r = w.rng('far-islands')
    return Array.from({ length: 9 }, (_, i) => {
      const z = -range(r, 90, 300)
      return {
        // never in the central corridor: the deepest view stays open
        pos: [(i % 2 ? 1 : -1) * range(r, 0.28, 0.85) * -z, range(r, -14, 28), z] as THREE.Vector3Tuple,
        scale: range(r, 6, 18),
        seed: Math.floor(r() * 1000) + 0.5,
      }
    })
  }, [])

  return (
    <group>
      {structs.map((s) => (
        <StructView key={s.id} s={s} onGone={onGone} />
      ))}
      {islands.map((p, i) => (
        <FarIsland key={i} {...p} />
      ))}
    </group>
  )
}
