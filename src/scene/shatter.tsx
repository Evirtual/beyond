import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * A piece that breaks when you touch it: it bursts into small fragments of its own matter
 * that fly apart, tumbling and slowing as they drift in the weightless air — and after a while
 * drift back together, and it is whole again. While it lies in pieces it can't be touched.
 *
 * Fragments are drawn as one instanced batch per material, so a shattering costs a few draw
 * calls, not dozens.
 */

const FRAGMENTS = 54
const APART_SECONDS = 13
const RETURN_SECONDS = 3.5
const fragGeo = new THREE.IcosahedronGeometry(1, 0)

type Frag = {
  home: THREE.Vector3
  pos: THREE.Vector3
  vel: THREE.Vector3
  rot: THREE.Euler
  spin: THREE.Vector3
  size: number
  mat: number
  slot: number
}

/** The handle between a piece and its shattering: how to break it, and whether it lies in pieces. */
export type ShatterHandle = { tap: ((point: THREE.Vector3) => void) | null; broken: boolean }
export function useShatter() {
  return useRef<ShatterHandle>({ tap: null, broken: false })
}

export function Shatterable({ materials, seed, children, handle }: { materials: THREE.Material[]; seed: number; children: ReactNode; handle: React.MutableRefObject<ShatterHandle> }) {
  const root = useRef<THREE.Group>(null!)
  const whole = useRef<THREE.Group>(null!)
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([])
  const st = useRef({ phase: 'whole' as 'whole' | 'apart' | 'return', since: 0, clock: 0, scale: 1 })
  const frags = useRef<Frag[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])

  // how many fragments each material gets (so each instanced batch is sized once)
  const perMat = useMemo(() => {
    const n = materials.length
    return materials.map((_, i) => Math.floor(FRAGMENTS / n) + (i < FRAGMENTS % n ? 1 : 0))
  }, [materials])

  /** the piece's extent in its own frame: where fragments can come from */
  const extent = () => {
    const box = new THREE.Box3()
    whole.current.updateWorldMatrix(true, true)
    const inv = new THREE.Matrix4().copy(whole.current.matrixWorld).invert()
    whole.current.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.geometry) return
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      const b = m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))
      box.union(b)
    })
    return box
  }

  const breakApart = () => {
    let r = (Math.floor(seed * 9973) ^ Math.floor(st.current.clock * 1000)) >>> 0 || 1
    const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0), (r % 100000) / 100000)
    const box = extent()
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const scale = (size.x + size.y + size.z) / 3
    const out: Frag[] = []
    const used = materials.map(() => 0)
    for (let i = 0; i < FRAGMENTS; i++) {
      let mat = i % materials.length
      if (used[mat] >= perMat[mat]) mat = used.findIndex((u, k) => u < perMat[k])
      const home = new THREE.Vector3(box.min.x + rnd() * size.x, box.min.y + rnd() * size.y, box.min.z + rnd() * size.z)
      // a gentle burst: they spread to about one and a half times the piece, not across the sky
      const away = home.clone().sub(centre).normalize().multiplyScalar(scale * (0.35 + rnd() * 0.55))
      away.add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(scale * 0.25))
      out.push({
        home,
        pos: home.clone(),
        vel: away,
        rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(4),
        size: scale * (0.035 + rnd() * rnd() * 0.12),
        mat,
        slot: used[mat]++,
      })
    }
    frags.current = out
    st.current.scale = scale
    whole.current.visible = false
    meshes.current.forEach((m, i) => m && (m.count = perMat[i]))
    st.current.phase = 'apart'
    st.current.since = st.current.clock
    handle.current.broken = true
  }

  // a touch breaks it; while it lies in pieces it ignores touches (see ShatterHandle.broken)
  useEffect(() => {
    handle.current.tap = () => {
      if (st.current.phase === 'whole') breakApart()
    }
    return () => void (handle.current.tap = null)
  })

  useFrame((state, delta) => {
    const s = st.current
    s.clock = state.clock.elapsedTime
    if (s.phase === 'whole') return
    const d = Math.min(delta, 0.05)
    const age = s.clock - s.since
    if (s.phase === 'apart' && age > APART_SECONDS) {
      s.phase = 'return'
      s.since = s.clock
    }
    const back = s.phase === 'return' ? Math.min((s.clock - s.since) / RETURN_SECONDS, 1) : 0
    const ease = back * back * (3 - 2 * back)
    for (const f of frags.current) {
      if (s.phase === 'apart') {
        // weightless: they drift on, tumbling, slowly losing speed
        f.pos.addScaledVector(f.vel, d)
        f.vel.multiplyScalar(Math.exp(-d * 0.6))
        // never far: a fragment pushed beyond about twice the piece's size eases back
        tmp.copy(f.pos).sub(f.home)
        const far = tmp.length() - s.scale * 2
        if (far > 0) {
          f.pos.addScaledVector(tmp.normalize(), -far * Math.min(1, d * 4))
          f.vel.multiplyScalar(0.9)
        }
        f.rot.x += f.spin.x * d
        f.rot.y += f.spin.y * d
        f.rot.z += f.spin.z * d
      } else {
        // drawn back together
        f.pos.lerp(f.home, Math.min(1, ease * 0.35 + d * 2.5 * ease))
        f.rot.x *= 1 - ease * 0.08
        f.rot.y *= 1 - ease * 0.08
        f.rot.z *= 1 - ease * 0.08
      }
      dummy.position.copy(f.pos)
      dummy.rotation.copy(f.rot)
      // as they rejoin they shrink into the whole that reappears
      dummy.scale.setScalar(f.size * (1 - ease * 0.7))
      dummy.updateMatrix()
      meshes.current[f.mat]?.setMatrixAt(f.slot, dummy.matrix)
    }
    meshes.current.forEach((m) => m && (m.instanceMatrix.needsUpdate = true))
    if (s.phase === 'return' && back >= 1) {
      s.phase = 'whole'
      handle.current.broken = false
      whole.current.visible = true
      meshes.current.forEach((m) => m && (m.count = 0))
    }
  })

  return (
    <group ref={root}>
      <group ref={whole}>{children}</group>
      {materials.map((m, i) => (
        <instancedMesh
          key={i}
          ref={(el) => void (meshes.current[i] = el)}
          args={[fragGeo, m, perMat[i]]}
          frustumCulled={false}
          // visible but empty until it breaks: drawn as nothing, yet compiled in the background with
          // the rest of the world (hidden objects aren't), so the first shattering doesn't stutter
          count={0}
        />
      ))}
    </group>
  )
}
