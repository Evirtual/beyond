import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, range } from './rng'
import { islandGeo, shard } from './materials'
import { rockSet } from './forms'
import { useWorld } from './world'

/**
 * Every object that can float in the midground, grouped by the realm it
 * belongs to. Each realm has its own vocabulary — nothing is just recoloured.
 */
export type Mats = { stone: THREE.Material; dark: THREE.Material; crystal: THREE.Material }
type BodyProps = { m: Mats; seed: number }

const UP = new THREE.Vector3(0, 1, 0)

function Spin({ speed, axis = 'y', children }: { speed: number; axis?: 'x' | 'y' | 'z'; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame((_, dt) => (ref.current.rotation[axis] += Math.min(dt, 0.05) * speed))
  return <group ref={ref}>{children}</group>
}

/** Evenly spread directions on a sphere. */
function fibonacciDirs(n: number) {
  const out: THREE.Vector3[] = []
  const g = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    out.push(new THREE.Vector3(Math.cos(g * i) * r, y, Math.sin(g * i) * r))
  }
  return out
}

/** A cylinder from a to b (for branches, threads, limbs). */
function Limb({ a, b, r0, r1, mat }: { a: THREE.Vector3; b: THREE.Vector3; r0: number; r1: number; mat: THREE.Material }) {
  const { mid, q, len } = useMemo(() => {
    const dir = b.clone().sub(a)
    const len = dir.length()
    return { mid: a.clone().add(b).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()), len }
  }, [a, b])
  return (
    <mesh material={mat} position={mid} quaternion={q}>
      <cylinderGeometry args={[r1, r0, len, 6]} />
    </mesh>
  )
}

// ── home: the original vocabulary ──────────────────────────────────────────

export function CrystalCluster({ seed, count = 7, mat, base }: { seed: number; count?: number; mat: THREE.Material; base: THREE.Material }) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  const grow = useMemo(() => form.shardStretch, [])
  const shards = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: count }, (_, i) => ({
      rot: [range(r, -0.7, 0.7), range(r, 0, Math.PI * 2), range(r, -0.7, 0.7)] as THREE.Vector3Tuple,
      scale: i === 0 ? 1.5 : range(r, 0.45, 1.1),
    }))
  }, [seed, count])
  return (
    <group>
      {shards.map((s, i) => (
        <mesh key={i} geometry={shard} material={mat} rotation={s.rot} scale={[s.scale, s.scale * grow, s.scale]} />
      ))}
      <mesh geometry={rocks[seed % rocks.length]} material={base} scale={[0.6, 0.35, 0.6]} position={[0, -0.1, 0]} />
    </group>
  )
}

function RockBody({ m, seed }: BodyProps) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  const st = useMemo(() => form.stretch, [])
  return <mesh geometry={rocks[seed % rocks.length]} material={m.stone} scale={st} />
}

function RockPair({ m, seed }: BodyProps) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  const st = useMemo(() => form.stretch, [])
  return (
    <group scale={st}>
      <mesh geometry={rocks[seed % rocks.length]} material={m.stone} />
      <mesh geometry={rocks[(seed + 1) % rocks.length]} material={m.stone} position={[1.5, 0.7, -0.4]} scale={0.45} />
      <mesh geometry={rocks[(seed + 2) % rocks.length]} material={m.stone} position={[-1.1, -0.8, 0.3]} scale={0.25} />
    </group>
  )
}

function CrystalIsland({ m, seed }: BodyProps) {
  return (
    <group>
      <mesh geometry={islandGeo} material={m.stone} scale={[1.5, 1, 1.25]} />
      <group position={[0.3, 0.25, 0.1]} scale={0.6}>
        <CrystalCluster seed={seed % 97} count={6 + (seed % 4)} mat={m.crystal} base={m.dark} />
      </group>
    </group>
  )
}

function Gateway({ m }: BodyProps) {
  return (
    <group rotation={[0.08, -0.5, 0.1]}>
      <mesh material={m.stone} position={[-2.2, 1.6, 0]}>
        <boxGeometry args={[1.3, 7, 1.3]} />
      </mesh>
      <mesh material={m.stone} position={[2.2, 0.6, 0]} rotation={[0, 0, -0.05]}>
        <boxGeometry args={[1.3, 5, 1.3]} />
      </mesh>
      <mesh material={m.stone} position={[0.2, 5.0, 0.3]} rotation={[0.1, 0, -0.22]}>
        <boxGeometry args={[6.4, 1.1, 1.5]} />
      </mesh>
      <mesh material={m.dark} position={[0, -2.4, 0]} scale={[4.6, 1.6, 2.4]} geometry={islandGeo} />
    </group>
  )
}

function Obelisk({ m }: BodyProps) {
  return (
    <group rotation={[0.1, 0.3, -0.18]}>
      <mesh material={m.stone}>
        <boxGeometry args={[1.6, 14, 1.6]} />
      </mesh>
      <mesh material={m.stone} position={[0, 7.6, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.13, 1.4, 4]} />
      </mesh>
      <mesh material={m.dark} position={[0, -8, 0]} scale={[2.6, 1.6, 2.2]} geometry={islandGeo} />
    </group>
  )
}

/** Steps to nowhere, spiralling up and breaking off. */
function Stair({ m, seed }: BodyProps) {
  const steps = useMemo(() => {
    const r = mulberry32(seed)
    const n = 7 + Math.floor(r() * 5)
    return Array.from({ length: n }, (_, i) => ({ a: i * 0.42, y: i * 0.62, drop: i > n - 3 ? range(r, 0.3, 1.2) : 0 }))
  }, [seed])
  return (
    <group rotation={[0.05, 0.6, 0.05]}>
      {steps.map((s, i) => (
        <mesh key={i} material={m.stone} position={[Math.cos(s.a) * 2.6, s.y + s.drop, Math.sin(s.a) * 2.6]} rotation={[s.drop * 0.3, -s.a, s.drop * 0.2]}>
          <boxGeometry args={[2.2, 0.35, 1.0]} />
        </mesh>
      ))}
      <mesh material={m.dark} position={[2.4, -1.2, 0.5]} scale={[2.2, 1.3, 2]} geometry={islandGeo} />
    </group>
  )
}

/** Shards hanging in a slow ring around nothing. */
function ShardRing({ m, seed }: BodyProps) {
  const items = useMemo(() => {
    const r = mulberry32(seed)
    const n = 9 + Math.floor(r() * 5)
    return Array.from({ length: n }, (_, i) => ({
      a: (i / n) * Math.PI * 2 + range(r, -0.15, 0.15),
      rad: range(r, 1.8, 2.3),
      y: range(r, -0.3, 0.3),
      s: range(r, 0.35, 0.8),
      tilt: range(r, -0.5, 0.5),
    }))
  }, [seed])
  return (
    <group rotation={[0.35, 0, 0.15]}>
      <Spin speed={0.05}>
        {items.map((it, i) => (
          <mesh key={i} geometry={shard} material={m.crystal} position={[Math.cos(it.a) * it.rad, it.y, Math.sin(it.a) * it.rad]} rotation={[it.tilt, -it.a, Math.PI / 2]} scale={it.s} />
        ))}
      </Spin>
    </group>
  )
}

// ── red · ember: obsidian, fire under stone, spines ───────────────────────

/** Glassy black blades standing out of a shared root. */
function ObsidianBlades({ m, seed }: BodyProps) {
  const blades = useMemo(() => {
    const r = mulberry32(seed)
    const n = 3 + Math.floor(r() * 3)
    return Array.from({ length: n }, (_, i) => ({
      h: i === 0 ? 7 : range(r, 3, 5.5),
      x: i === 0 ? 0 : range(r, -1.2, 1.2),
      tilt: i === 0 ? range(r, -0.1, 0.1) : range(r, -0.5, 0.5),
      yaw: range(r, 0, Math.PI),
    }))
  }, [seed])
  return (
    <group>
      {blades.map((b, i) => (
        <mesh key={i} material={m.stone} position={[b.x, b.h / 2 - 1, 0]} rotation={[0, b.yaw, b.tilt]} scale={[1, 1, 0.28]}>
          <coneGeometry args={[0.8, b.h, 3]} />
        </mesh>
      ))}
      <mesh material={m.crystal} position={[0, -1, 0]} scale={[0.5, 0.15, 0.5]}>
        <icosahedronGeometry args={[1.2, 0]} />
      </mesh>
      <mesh material={m.dark} position={[0, -1.6, 0]} scale={[1.6, 1.1, 1.3]} geometry={islandGeo} />
    </group>
  )
}

/** A boulder with fire inside: the core shows through every crack. */
function MoltenBoulder({ m, seed }: BodyProps) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  return (
    <group>
      <mesh geometry={rocks[seed % rocks.length]} material={m.stone} />
      <mesh material={m.crystal}>
        <icosahedronGeometry args={[0.86, 1]} />
      </mesh>
    </group>
  )
}

/** A dark core bristling with spines. */
function SpikeUrchin({ m, seed }: BodyProps) {
  const spikes = useMemo(() => {
    const r = mulberry32(seed)
    return fibonacciDirs(18).map((d) => ({
      q: new THREE.Quaternion().setFromUnitVectors(UP, d),
      pos: d.clone().multiplyScalar(0.9),
      len: range(r, 0.9, 1.9),
    }))
  }, [seed])
  return (
    <Spin speed={0.04}>
      <mesh material={m.dark}>
        <icosahedronGeometry args={[0.75, 1]} />
      </mesh>
      {spikes.map((s, i) => (
        <mesh key={i} material={i % 4 === 0 ? m.crystal : m.stone} position={s.pos.clone().add(s.pos.clone().normalize().multiplyScalar(s.len / 2))} quaternion={s.q}>
          <coneGeometry args={[0.13, s.len, 4]} />
        </mesh>
      ))}
    </Spin>
  )
}

// ── orange · dune: strata, wind-carved columns, arches ─────────────────────

function Mesa({ m, seed }: BodyProps) {
  const layers = useMemo(() => {
    const r = mulberry32(seed)
    let y = 0
    return Array.from({ length: 4 + Math.floor(r() * 2) }, (_, i) => {
      const h = range(r, 0.45, 0.9)
      const l = { y: y + h / 2, h, r: 2.3 - i * range(r, 0.05, 0.18), dark: i % 2 === 1 }
      y += h
      return l
    })
  }, [seed])
  return (
    <group>
      {layers.map((l, i) => (
        <mesh key={i} material={l.dark ? m.dark : m.stone} position={[0, l.y, 0]} rotation={[0, i * 0.4, 0]}>
          <cylinderGeometry args={[l.r * 0.96, l.r, l.h, 7]} />
        </mesh>
      ))}
      <mesh material={m.dark} position={[0, -0.9, 0]} scale={[2.3, 2.2, 2.2]} rotation={[Math.PI, 0, 0]} geometry={islandGeo} />
    </group>
  )
}

/** Stacked, wind-worn stones with a wide cap rock. */
function Hoodoo({ m, seed }: BodyProps) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  const stack = useMemo(() => {
    const r = mulberry32(seed)
    let y = 0
    return Array.from({ length: 4 + Math.floor(r() * 2) }, (_, i) => {
      const s = range(r, 0.55, 0.8) * (1 - i * 0.06)
      const p = { y: y + s * 0.5, s, x: range(r, -0.12, 0.12), dark: i % 2 === 0 }
      y += s * 0.85
      return p
    })
  }, [seed])
  const top = stack[stack.length - 1]
  return (
    <group position={[0, -2, 0]}>
      {stack.map((p, i) => (
        <mesh key={i} geometry={rocks[(seed + i) % rocks.length]} material={p.dark ? m.dark : m.stone} position={[p.x, p.y, 0]} scale={[p.s, p.s * 0.6, p.s]} />
      ))}
      <mesh geometry={rocks[(seed + 3) % rocks.length]} material={m.stone} position={[0, top.y + top.s * 0.55, 0]} scale={[1.5, 0.3, 1.3]} />
    </group>
  )
}

function StoneArch({ m }: BodyProps) {
  return (
    <group rotation={[0, 0.5, 0.06]}>
      <mesh material={m.stone} position={[0, 0.2, 0]}>
        <torusGeometry args={[2.4, 0.6, 6, 18, Math.PI]} />
      </mesh>
      <mesh material={m.dark} position={[0, -0.1, 0]}>
        <boxGeometry args={[6.4, 0.6, 1.8]} />
      </mesh>
      <mesh material={m.dark} position={[0, -1.4, 0]} scale={[3.4, 1.4, 1.6]} geometry={islandGeo} />
    </group>
  )
}

// ── yellow · sun: spheres, orbits, wheels, lanterns ────────────────────────

function Orb({ m, seed }: BodyProps) {
  return (
    <group>
      <mesh material={m.crystal}>
        <sphereGeometry args={[1, 32, 16]} />
      </mesh>
      <group rotation={[1.2 + (seed % 7) * 0.05, 0.3, 0.2]}>
        <Spin speed={0.12} axis="z">
          <mesh material={m.stone}>
            <torusGeometry args={[1.6, 0.05, 4, 64]} />
          </mesh>
          <mesh material={m.stone} position={[1.6, 0, 0]}>
            <sphereGeometry args={[0.12, 12, 8]} />
          </mesh>
        </Spin>
      </group>
    </group>
  )
}

/** A small clockwork sky: a body, its rings, its moons. */
function Orrery({ m, seed }: BodyProps) {
  const rings = useMemo(() => {
    const r = mulberry32(seed)
    return [1.3, 1.9, 2.5].map((rad, i) => ({ rad, tilt: range(r, -0.6, 0.6), yaw: range(r, 0, 3), speed: (0.25 - i * 0.06) * (r() < 0.5 ? -1 : 1), moon: range(r, 0.12, 0.26) }))
  }, [seed])
  return (
    <group>
      <mesh material={m.stone}>
        <sphereGeometry args={[0.75, 24, 12]} />
      </mesh>
      {rings.map((g, i) => (
        <group key={i} rotation={[g.tilt, g.yaw, 0]}>
          <Spin speed={g.speed}>
            <mesh material={m.dark} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[g.rad, 0.025, 4, 72]} />
            </mesh>
            <mesh material={m.crystal} position={[g.rad, 0, 0]}>
              <sphereGeometry args={[g.moon, 14, 8]} />
            </mesh>
          </Spin>
        </group>
      ))}
    </group>
  )
}

/** A stone wheel with rays, turning slowly. */
function SunWheel({ m }: BodyProps) {
  const rays = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2)
  return (
    <Spin speed={0.06} axis="z">
      <mesh material={m.stone} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 0.25, 24]} />
      </mesh>
      <mesh material={m.crystal} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.14]}>
        <cylinderGeometry args={[0.55, 0.55, 0.1, 16]} />
      </mesh>
      {rays.map((a, i) => (
        <mesh key={i} material={i % 2 ? m.dark : m.crystal} position={[Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0]} rotation={[0, 0, a - Math.PI / 2]}>
          <coneGeometry args={[0.18, i % 2 ? 0.9 : 1.4, 4]} />
        </mesh>
      ))}
    </Spin>
  )
}

/** Lights hanging on threads from a floating stone. */
function Lanterns({ m, seed }: BodyProps) {
  const lamps = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: 5 + Math.floor(r() * 3) }, () => {
      const a = r() * Math.PI * 2
      const rad = range(r, 0.3, 1.5)
      return { x: Math.cos(a) * rad, z: Math.sin(a) * rad, len: range(r, 0.8, 2.6), s: range(r, 0.18, 0.32) }
    })
  }, [seed])
  return (
    <group position={[0, 1.2, 0]}>
      <mesh material={m.stone}>
        <cylinderGeometry args={[1.9, 1.5, 0.35, 8]} />
      </mesh>
      {lamps.map((l, i) => (
        <group key={i} position={[l.x, -0.2, l.z]}>
          <mesh material={m.dark} position={[0, -l.len / 2, 0]}>
            <cylinderGeometry args={[0.012, 0.012, l.len, 3]} />
          </mesh>
          <mesh material={m.crystal} position={[0, -l.len - l.s, 0]} scale={[l.s, l.s * 1.5, l.s]}>
            <octahedronGeometry args={[1, 0]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ── green · grove: trees of crystal, mushrooms, vines ──────────────────────

function CrystalTree({ m, seed }: BodyProps) {
  const tree = useMemo(() => {
    const r = mulberry32(seed)
    const top = new THREE.Vector3(range(r, -0.3, 0.3), 3, range(r, -0.3, 0.3))
    const branches = Array.from({ length: 4 + Math.floor(r() * 3) }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + r()
      const from = new THREE.Vector3(0, range(r, 1.6, 2.8), 0).lerp(top, 0.3)
      const to = from.clone().add(new THREE.Vector3(Math.cos(a) * range(r, 1, 1.8), range(r, 0.5, 1.4), Math.sin(a) * range(r, 1, 1.8)))
      return { from, to, leaf: range(r, 0.45, 0.8) }
    })
    return { top, branches }
  }, [seed])
  const base = useMemo(() => new THREE.Vector3(0, -0.4, 0), [])
  return (
    <group position={[0, -1.4, 0]}>
      <Limb a={base} b={tree.top} r0={0.32} r1={0.14} mat={m.stone} />
      {tree.branches.map((b, i) => (
        <group key={i}>
          <Limb a={b.from} b={b.to} r0={0.1} r1={0.04} mat={m.stone} />
          <mesh material={m.crystal} position={b.to} scale={b.leaf}>
            <icosahedronGeometry args={[1, 0]} />
          </mesh>
        </group>
      ))}
      <mesh material={m.crystal} position={tree.top} scale={0.7}>
        <icosahedronGeometry args={[1, 0]} />
      </mesh>
      <mesh material={m.dark} position={[0, -0.9, 0]} scale={[1.6, 1.2, 1.4]} geometry={islandGeo} />
    </group>
  )
}

function Mushrooms({ m, seed }: BodyProps) {
  const caps = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({
      x: i === 0 ? 0 : range(r, -1.6, 1.6),
      z: i === 0 ? 0 : range(r, -0.8, 0.8),
      h: i === 0 ? 2.8 : range(r, 1, 2),
      cap: i === 0 ? 1.7 : range(r, 0.6, 1.1),
      lean: range(r, -0.2, 0.2),
    }))
  }, [seed])
  return (
    <group position={[0, -1, 0]}>
      {caps.map((c, i) => (
        <group key={i} position={[c.x, 0, c.z]} rotation={[0, 0, c.lean]}>
          <mesh material={m.stone} position={[0, c.h / 2, 0]}>
            <cylinderGeometry args={[c.cap * 0.16, c.cap * 0.24, c.h, 8]} />
          </mesh>
          <mesh material={m.crystal} position={[0, c.h, 0]}>
            <sphereGeometry args={[c.cap, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh material={m.dark} position={[0, c.h - 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[c.cap * 0.98, 18]} />
          </mesh>
        </group>
      ))}
      <mesh material={m.dark} position={[0, -0.5, 0]} scale={[2.2, 1.2, 1.6]} geometry={islandGeo} />
    </group>
  )
}

/** A vine coiling through empty air, budding crystal. */
function Vine({ m, seed }: BodyProps) {
  const { geo, buds } = useMemo(() => {
    const r = mulberry32(seed)
    const pts = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7
      const a = t * Math.PI * range(r, 2.5, 4)
      return new THREE.Vector3(Math.cos(a) * (1.4 - t * 0.6), t * 5 - 2.5, Math.sin(a) * (1.4 - t * 0.6))
    })
    const curve = new THREE.CatmullRomCurve3(pts)
    const geo = new THREE.TubeGeometry(curve, 64, 0.11, 5)
    const buds = Array.from({ length: 7 }, (_, i) => ({ p: curve.getPoint(0.1 + i * 0.13), s: range(r, 0.18, 0.35) }))
    return { geo, buds }
  }, [seed])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group>
      <mesh geometry={geo} material={m.stone} />
      {buds.map((b, i) => (
        <mesh key={i} material={m.crystal} position={b.p} scale={[b.s, b.s * 1.6, b.s]} rotation={[i, i * 2, 0]}>
          <octahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </group>
  )
}

// ── blue · glacier: ice spires, bergs, snowflakes, icicles ─────────────────

function IceSpires({ m, seed }: BodyProps) {
  const spires = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: 4 + Math.floor(r() * 3) }, (_, i) => {
      const a = r() * Math.PI * 2
      const d = i === 0 ? 0 : range(r, 0.6, 1.6)
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, h: i === 0 ? 9 : range(r, 3, 7), rad: i === 0 ? 0.9 : range(r, 0.35, 0.7), tilt: range(r, -0.12, 0.12) }
    })
  }, [seed])
  return (
    <group position={[0, -3, 0]}>
      {spires.map((s, i) => (
        <mesh key={i} material={m.crystal} position={[s.x, s.h / 2, s.z]} rotation={[s.tilt, 0, s.tilt]}>
          <coneGeometry args={[s.rad, s.h, 5]} />
        </mesh>
      ))}
      <mesh material={m.dark} position={[0, -0.6, 0]} scale={[2.4, 1.4, 2]} geometry={islandGeo} />
    </group>
  )
}

function Iceberg({ m, seed }: BodyProps) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  return (
    <group>
      <mesh geometry={rocks[seed % rocks.length]} material={m.crystal} scale={[1.6, 1.0, 1.3]} />
      <mesh geometry={rocks[(seed + 2) % rocks.length]} material={m.stone} position={[0.2, -0.75, 0]} scale={[1.2, 0.6, 1]} />
    </group>
  )
}

function Snowflake({ m }: BodyProps) {
  const arms = [0, 1, 2, 3, 4, 5].map((i) => (i / 6) * Math.PI * 2)
  return (
    <Spin speed={0.08} axis="z">
      {arms.map((a, i) => (
        <group key={i} rotation={[0, 0, a]}>
          <mesh material={m.crystal} position={[0, 1.2, 0]}>
            <boxGeometry args={[0.14, 2.4, 0.06]} />
          </mesh>
          <mesh material={m.crystal} position={[0.32, 1.55, 0]} rotation={[0, 0, -0.9]}>
            <boxGeometry args={[0.1, 0.8, 0.05]} />
          </mesh>
          <mesh material={m.crystal} position={[-0.32, 1.55, 0]} rotation={[0, 0, 0.9]}>
            <boxGeometry args={[0.1, 0.8, 0.05]} />
          </mesh>
          <mesh material={m.crystal} position={[0, 2.5, 0]} scale={[0.18, 0.3, 0.06]}>
            <octahedronGeometry args={[1, 0]} />
          </mesh>
        </group>
      ))}
      <mesh material={m.crystal}>
        <cylinderGeometry args={[0.35, 0.35, 0.08, 6]} />
      </mesh>
    </Spin>
  )
}

/** A ledge of stone with ice hanging from it. */
function Icicles({ m, seed }: BodyProps) {
  const { form } = useWorld()
  const rocks = useMemo(() => rockSet(form), [])
  const ice = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: 9 + Math.floor(r() * 5) }, () => ({ x: range(r, -2, 2), z: range(r, -0.6, 0.6), len: range(r, 0.8, 3.4), rad: range(r, 0.1, 0.28) }))
  }, [seed])
  return (
    <group position={[0, 1.2, 0]}>
      <mesh geometry={rocks[seed % rocks.length]} material={m.stone} scale={[2.6, 0.55, 1.2]} />
      {ice.map((c, i) => (
        <mesh key={i} material={m.crystal} position={[c.x, -0.35 - c.len / 2, c.z]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[c.rad, c.len, 5]} />
        </mesh>
      ))}
    </group>
  )
}

// ── violet · arcane: runes, orbits, inverted temples ───────────────────────

function RuneMonolith({ m, seed }: BodyProps) {
  const runes = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: 6 }, (_, i) => ({ y: 2.2 - i * 0.85, x: range(r, -0.25, 0.25), w: range(r, 0.18, 0.4), h: range(r, 0.15, 0.4) }))
  }, [seed])
  return (
    <group rotation={[0, 0.4, 0.05]}>
      <mesh material={m.stone}>
        <boxGeometry args={[1.3, 6.5, 0.7]} />
      </mesh>
      {runes.map((r, i) => (
        <mesh key={i} material={m.crystal} position={[r.x, r.y, 0.37]}>
          <boxGeometry args={[r.w, r.h, 0.04]} />
        </mesh>
      ))}
      {[1.6, -1.2].map((y, i) => (
        <group key={i} position={[0, y, 0]} rotation={[Math.PI / 2 + (i ? 0.25 : -0.2), 0, 0]}>
          <Spin speed={i ? -0.3 : 0.25} axis="z">
            <mesh material={m.crystal}>
              <torusGeometry args={[1.5 + i * 0.3, 0.045, 4, 48]} />
            </mesh>
            <mesh material={m.dark} position={[1.5 + i * 0.3, 0, 0]}>
              <boxGeometry args={[0.22, 0.22, 0.22]} />
            </mesh>
          </Spin>
        </group>
      ))}
      <mesh material={m.dark} position={[0, -4, 0]} scale={[1.8, 1.2, 1.4]} geometry={islandGeo} />
    </group>
  )
}

/** Carved stones circling a bright core. */
function Orbiters({ m, seed }: BodyProps) {
  const stones = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2, rad: range(r, 1.7, 2.3), y: range(r, -0.4, 0.4), s: range(r, 0.3, 0.55) }))
  }, [seed])
  return (
    <group rotation={[0.4, 0, 0.2]}>
      <Spin speed={0.5}>
        <mesh material={m.crystal}>
          <octahedronGeometry args={[0.75, 0]} />
        </mesh>
      </Spin>
      <Spin speed={0.15}>
        {stones.map((s, i) => (
          <mesh key={i} material={m.stone} position={[Math.cos(s.a) * s.rad, s.y, Math.sin(s.a) * s.rad]} rotation={[s.a, s.a * 2, 0]}>
            <boxGeometry args={[s.s, s.s, s.s]} />
          </mesh>
        ))}
      </Spin>
    </group>
  )
}

/** A temple standing on the flat base of a pyramid that hangs point-down. */
function InvertedPyramid({ m }: BodyProps) {
  return (
    <group rotation={[0, 0.6, 0]}>
      <mesh material={m.stone} rotation={[Math.PI, Math.PI / 4, 0]}>
        <coneGeometry args={[2.6, 4.2, 4]} />
      </mesh>
      <mesh material={m.dark} position={[0, 2.6, 0]}>
        <boxGeometry args={[1.8, 0.9, 1.8]} />
      </mesh>
      {[
        [-0.75, -0.75],
        [0.75, -0.75],
        [-0.75, 0.75],
        [0.75, 0.75],
      ].map(([x, z], i) => (
        <mesh key={i} material={m.stone} position={[x, 3.6, z]}>
          <boxGeometry args={[0.22, 1.2, 0.22]} />
        </mesh>
      ))}
      <mesh material={m.crystal} position={[0, -2.6, 0]}>
        <octahedronGeometry args={[0.35, 0]} />
      </mesh>
    </group>
  )
}

// ── registry ───────────────────────────────────────────────────────────────

export type PieceDef = {
  /** big pieces are placed further back */
  big?: boolean
  /** scale = range(lo, hi) × distance / div */
  scale: [number, number, number]
  Body: (p: BodyProps) => ReactNode
}

export const PIECES: Record<string, PieceDef> = {
  // home
  rock: { scale: [0.35, 1.0, 16], Body: RockBody },
  rockPair: { scale: [0.3, 0.6, 16], Body: RockPair },
  crystalIsland: { scale: [0.8, 1.2, 19], Body: CrystalIsland },
  shardRing: { scale: [0.8, 1.1, 20], Body: ShardRing },
  gateway: { big: true, scale: [0.9, 1.2, 36], Body: Gateway },
  obelisk: { big: true, scale: [0.9, 1.2, 36], Body: Obelisk },
  stair: { big: true, scale: [0.9, 1.2, 36], Body: Stair },
  // red
  blades: { scale: [0.7, 1.1, 24], Body: ObsidianBlades },
  molten: { scale: [0.5, 1.1, 15], Body: MoltenBoulder },
  urchin: { scale: [0.6, 1.0, 18], Body: SpikeUrchin },
  // orange
  mesa: { big: true, scale: [0.9, 1.3, 26], Body: Mesa },
  hoodoo: { scale: [0.8, 1.2, 18], Body: Hoodoo },
  arch: { big: true, scale: [0.9, 1.3, 28], Body: StoneArch },
  // yellow
  orb: { scale: [0.5, 1.1, 15], Body: Orb },
  orrery: { scale: [0.7, 1.1, 22], Body: Orrery },
  sunWheel: { scale: [0.7, 1.1, 22], Body: SunWheel },
  lanterns: { scale: [0.7, 1.1, 20], Body: Lanterns },
  // green
  tree: { big: true, scale: [0.9, 1.3, 26], Body: CrystalTree },
  mushrooms: { scale: [0.7, 1.2, 20], Body: Mushrooms },
  vine: { scale: [0.7, 1.1, 22], Body: Vine },
  // blue
  iceSpires: { big: true, scale: [0.9, 1.3, 30], Body: IceSpires },
  iceberg: { scale: [0.6, 1.1, 15], Body: Iceberg },
  snowflake: { scale: [0.6, 1.0, 20], Body: Snowflake },
  icicles: { scale: [0.7, 1.1, 22], Body: Icicles },
  // violet
  runeMonolith: { big: true, scale: [0.9, 1.3, 28], Body: RuneMonolith },
  orbiters: { scale: [0.7, 1.1, 20], Body: Orbiters },
  invPyramid: { big: true, scale: [0.9, 1.3, 28], Body: InvertedPyramid },
}
