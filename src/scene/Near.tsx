import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DEPTH_STEP } from './WindowRig'
import { range } from './rng'
import { makeBody, nudge } from './touch'
import { CrystalCluster } from './pieces'
import { bigRockGeo, shard } from './materials'
import { debrisGeometry, rockSet } from './forms'
import { useWorld } from './world'

/**
 * The layer pressed right up behind the glass. Its main mass is always cut off
 * by one edge of the frame (which edge, and what it is, depends on the visit),
 * so leaning is the only way to see past it.
 */
export function Foreground({ index = 0 }: { index?: number }) {
  const w = useWorld()
  const { stone: stoneMat, dark: darkStoneMat, crystal: crystalMat, crystalLight } = w.mats
  const v = useMemo(() => {
    const r = w.rng('foreground' + index)
    return {
      side: r() < 0.5 ? -1 : 1,
      kind: w.form.fg[Math.floor(r() * w.form.fg.length)],
      growth: r() < 0.75,
      phase: r() * 10,
    }
  }, [])
  // a crystal this big and this close needs to read as mass, not as a glowing sheet
  const pillarMat = useMemo(() => {
    const m = crystalMat.clone()
    m.emissiveIntensity = 0.12
    m.color.multiplyScalar(0.5)
    m.roughness = 0.32
    m.metalness = 0.55
    return m
  }, [])
  const rocks = useMemo(() => rockSet(w.form), [])
  const big = useRef<THREE.Group>(null!)
  const chip = useRef<THREE.Group>(null!)
  const chipBody = useMemo(makeBody, [])
  const chipWorld = useMemo(() => new THREE.Vector3(), [])
  const s = v.side

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime + v.phase
    big.current.rotation.y = Math.sin(t * 0.03) * 0.05
    big.current.position.y = Math.sin(t * 0.16) * 0.06
    chip.current.position.set(s * 1.15, 1.55 + Math.sin(t * 0.23 + 1) * 0.08, -3.6)
    // this foreground sits one shade further along the zone; the hand works in world space
    chipWorld.copy(chip.current.position).setZ(chip.current.position.z - index * DEPTH_STEP)
    if (w.isHere()) nudge(chipWorld, 0.25, chipBody, Math.min(dt, 0.05), 1, 0.9)
    chip.current.position.add(chipBody.off)
    // it tumbles in proportion to how far it has been moved — never more
    chip.current.rotation.y = t * 0.04 + chipBody.off.x * 1.5
    chip.current.rotation.x = chipBody.off.y * 1.5
  })

  return (
    <group>
      <group ref={big}>
        {v.kind === 'boulder' && (
          <mesh geometry={bigRockGeo} material={stoneMat} position={[s * 3.55, -0.4, -4.6]} rotation={[0.3, 0.8, 0.2]} scale={[2.0, 2.5, 1.5]} />
        )}
        {v.kind === 'pillar' && (
          // a giant crystal column running out of frame top and bottom
          <group position={[s * 3.3, 0, -5.2]} rotation={[0.05, 0.4, s * -0.12]}>
            <mesh geometry={shard} material={pillarMat} scale={[3.2, 5.5, 3.2]} position={[0, -4.5, 0]} />
            <mesh geometry={bigRockGeo} material={darkStoneMat} scale={[1.6, 1.2, 1.4]} position={[s * 0.3, -2.6, 0]} />
          </group>
        )}
        {v.kind === 'hanging' && (
          // a mass hanging down from above the frame, heavy and close
          <group position={[s * 2.2, 2.9, -4.4]} rotation={[0.2, 0.5, s * 0.25]}>
            <mesh geometry={bigRockGeo} material={stoneMat} scale={[2.6, 1.7, 1.6]} />
            <mesh geometry={shard} material={crystalMat} position={[s * -0.5, -0.9, 0.6]} rotation={[Math.PI, 0, 0.2]} scale={[0.9, 1.3, 0.9]} />
          </group>
        )}
        {v.kind === 'blade' && (
          // red: a sheet of obsidian slicing up past the frame
          <group position={[s * 3.2, -0.5, -5]} rotation={[0, s * 0.6, s * -0.18]}>
            <mesh material={stoneMat} scale={[1, 1, 0.3]}>
              <coneGeometry args={[1.7, 13, 3]} />
            </mesh>
            <mesh material={stoneMat} position={[s * -1.1, -2.5, 0.4]} rotation={[0, 0.8, s * 0.35]} scale={[1, 1, 0.3]}>
              <coneGeometry args={[0.8, 6, 3]} />
            </mesh>
          </group>
        )}
        {v.kind === 'hoodoo' && (
          // orange: a wind-carved column of stacked stone
          <group position={[s * 3.5, 0, -5.3]}>
            {[-3.2, -1.4, 0.4, 2.1, 3.7].map((y, i) => (
              <mesh key={i} geometry={rocks[i % rocks.length]} material={i % 2 ? darkStoneMat : stoneMat} position={[Math.sin(i * 1.7) * 0.25, y, 0]} scale={[1.7 - i * 0.12, 1.0, 1.4 - i * 0.1]} />
            ))}
            <mesh geometry={rocks[4]} material={stoneMat} position={[0, 4.6, 0]} scale={[2.6, 0.45, 2]} />
          </group>
        )}
        {v.kind === 'orb' && (
          // yellow: a great lit sphere drifting half out of view, ringed
          <group position={[s * 4.2, 0.8, -7]}>
            <mesh material={crystalMat}>
              <sphereGeometry args={[2.8, 48, 24]} />
            </mesh>
            <mesh material={stoneMat} rotation={[1.25, 0.2, s * 0.3]}>
              <torusGeometry args={[4.0, 0.09, 6, 96]} />
            </mesh>
          </group>
        )}
        {v.kind === 'mushroom' && (
          // green: a giant cap overhead, its stem running down out of frame
          <group position={[s * 3.1, 2.6, -5.6]} rotation={[0.12, 0, s * -0.12]}>
            <mesh material={crystalMat}>
              <sphereGeometry args={[3.2, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            <mesh material={darkStoneMat} position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[3.15, 28]} />
            </mesh>
            <mesh material={stoneMat} position={[0, -4.5, 0]}>
              <cylinderGeometry args={[0.55, 0.85, 9, 10]} />
            </mesh>
          </group>
        )}
        {v.kind === 'spire' && (
          // blue: a spear of ice rising past the frame
          <group position={[s * 3.4, -1.5, -5.4]} rotation={[0.05, 0.3, s * -0.1]}>
            <mesh material={pillarMat}>
              <coneGeometry args={[1.5, 14, 5]} />
            </mesh>
            <mesh material={pillarMat} position={[s * -1.3, -2, 0.6]} rotation={[0, 0, s * 0.3]}>
              <coneGeometry args={[0.6, 7, 5]} />
            </mesh>
          </group>
        )}
        {v.kind === 'monolith' && (
          // violet: a slab of runes with a slow ring around it
          <group position={[s * 3.5, 0, -5.4]} rotation={[0, s * -0.5, 0]}>
            <mesh material={stoneMat}>
              <boxGeometry args={[2.2, 13, 1.1]} />
            </mesh>
            {[2.8, 1.6, 0.5, -0.8, -2].map((y, i) => (
              <mesh key={i} material={crystalMat} position={[Math.sin(i * 2.3) * 0.4, y, 0.57]}>
                <boxGeometry args={[0.35 + (i % 2) * 0.25, 0.3, 0.04]} />
              </mesh>
            ))}
            <mesh material={crystalMat} position={[0, 1, 0]} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
              <torusGeometry args={[2.3, 0.05, 4, 64]} />
            </mesh>
          </group>
        )}
      </group>

      {/* a chip of stone drifting free */}
      <group ref={chip} position={[s * 1.15, 1.55, -3.6]}>
        <mesh geometry={rocks[2]} material={stoneMat} scale={0.18} />
      </group>

      {/* crystal growth on the opposite lower corner, half below the frame */}
      <group position={[-s * 3.1, -2.55, -5.6]} rotation={[0.2, 0.3, -s * 0.35]} scale={v.growth ? 1.05 : 0.0001}>
        <CrystalCluster seed={77} count={8} mat={crystalMat} base={darkStoneMat} />
        <pointLight color={crystalLight} intensity={v.growth ? 4 : 0} distance={5} decay={1.8} position={[0.3, 1.2, 0.6]} />
      </group>
    </group>
  )
}

/** Hundreds of pebbles through every depth band — the strongest parallax cue. */
export function Debris({ perShade = 150 }: { perShade?: number }) {
  const w = useWorld()
  const { stone: stoneMat, crystal: crystalMat } = w.mats
  // the zone is several shades long; pebbles fill all of it
  const length = useMemo(() => w.length, [])
  const count = perShade * length
  const ref = useRef<THREE.InstancedMesh>(null!)
  const data = useMemo(() => {
    const r = w.rng('debris')
    return Array.from({ length: count }, () => {
      const z = -range(r, 5, 80 + (length - 1) * DEPTH_STEP)
      const spread = Math.min(-z, 45) * 0.8 + 2
      return {
        p: new THREE.Vector3(range(r, -spread, spread), range(r, -spread * 0.55, spread * 0.55), z),
        s: range(r, 0.03, 0.14) * (1 + -z * 0.025),
        rs: new THREE.Vector3(range(r, -0.3, 0.3), range(r, -0.3, 0.3), range(r, -0.3, 0.3)),
        ph: r() * 100,
        body: makeBody(),
      }
    })
  }, [count])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const st = useMemo(() => w.form.stretch, [])
  useFrame((s, rawDt) => {
    const t = s.clock.elapsedTime
    const dt = Math.min(rawDt, 0.05)
    const here = w.isHere()
    for (let i = 0; i < data.length; i++) {
      const d = data[i]
      dummy.position.set(d.p.x, d.p.y + Math.sin(t * 0.2 + d.ph) * 0.15, d.p.z)
      // every pebble keeps its spring running, so none snaps home when the camera moves on
      if (here) nudge(dummy.position, d.s * 1.5, d.body, dt, 1, 0.6 + d.s * 4)
      dummy.position.add(d.body.off)
      dummy.rotation.set(d.rs.x * t + d.ph + d.body.off.y * 2, d.rs.y * t + d.body.off.x * 2, d.rs.z * t)
      dummy.scale.set(d.s * st[0], d.s * st[1], d.s * st[2])
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  })
  // what drifts past belongs to the realm: obsidian chips, flat sandstone, motes of gold, leaves, ice, rune-cubes
  const geo = useMemo(() => debrisGeometry(w.form), [])
  const glows = useMemo(() => w.form.debrisGlows, [])
  return <instancedMesh ref={ref} args={[geo, glows ? crystalMat : stoneMat, count]} frustumCulled={false} />
}
