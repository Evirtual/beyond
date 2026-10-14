import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FORMS, formFor, type Form } from './forms'
import { applySpectrum, formNameFor, makeLightState, rngForSeed, seedForStep, zoneOf, type FormName, type LightState } from './moment'
import { disposeWorldMats, makeWorldMats, type WorldMats } from './materials'
import { view } from './state'
import { DEPTH_STEP, mainCamera } from './WindowRig'

export const FOG_DENSITY = 0.034

/**
 * One zone of the journey (a colour and all its shades), fully self-contained:
 * its own scene, camera, lights, fog, materials and random streams. Several can
 * exist at once — the one you're in, and its neighbours waiting inside the black
 * holes — so crossing into the next is just flying on into a world that's
 * already there.
 */
export type World = {
  start: number
  length: number
  seed: number
  form: Form
  formName: FormName
  rng: (label: string) => () => number
  mats: WorldMats
  light: LightState
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** this world's camera z right now (its own coordinates) */
  camZ: () => number
  /** is this the world you're in? (only it responds to your hand) */
  isHere: () => boolean
}

function makeWorld(start: number): World {
  const zone = zoneOf(start)
  const seed = seedForStep(start)
  // every colour is built from home's elements (islands, crystals, drifting pieces), tinted by the
  // colour; it keeps only its own air: its name, its fog and how dark it runs
  const own = formFor(start)
  const form: Form = { ...FORMS.home, universe: own.universe, fog: own.fog, ambience: own.ambience }
  const rng = (label: string) => rngForSeed(seed, label)
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x000000, FOG_DENSITY)
  scene.background = new THREE.Color()
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1400)
  return {
    start,
    length: zone.length,
    seed,
    form,
    formName: formNameFor(start),
    rng,
    mats: makeWorldMats(start, form, rng('crystals')),
    light: makeLightState(),
    scene,
    camera,
    // one depth axis runs through every world; each measures it from its own start
    camZ: () => -(view.depth - start * DEPTH_STEP),
    isHere: () => view.zoneStart === start,
  }
}

const WorldContext = createContext<World | null>(null)
export function useWorld() {
  const w = useContext(WorldContext)
  if (!w) throw new Error('useWorld outside a world')
  return w
}

/** Every built world, by zone start — the glass renders whichever it needs. */
export const worlds = new Map<number, World>()
if (import.meta.env.DEV) (window as unknown as { __worlds: typeof worlds }).__worlds = worlds

/** Lights, fog, sky colour and camera for one world, kept in step every frame. */
function WorldFrame() {
  const w = useWorld()
  const key = useRef<THREE.DirectionalLight>(null!)
  const fill = useRef<THREE.DirectionalLight>(null!)
  useFrame(() => {
    // this world's light: its own colours, never bleeding into a neighbour's
    const d = THREE.MathUtils.clamp(view.depth / DEPTH_STEP, w.start, w.start + w.length - 1)
    applySpectrum(d, w.light)
    // some universes are darker than their colour's light: night forests, open space
    const amb = w.form.ambience ?? 1
    if (amb !== 1) {
      w.light.horizon.multiplyScalar(amb)
      w.light.top.multiplyScalar(amb)
    }
    key.current.color.copy(w.light.key)
    key.current.intensity = w.light.keyI
    fill.current.color.copy(w.light.fill)
    fill.current.intensity = 0.7 + w.light.moonLight * 0.6
    const fog = w.scene.fog as THREE.FogExp2
    fog.color.copy(w.light.horizon)
    fog.density = w.form.fog ?? FOG_DENSITY
    ;(w.scene.background as THREE.Color).copy(w.light.top)

    // its camera: your eye (lean, projection) placed at this world's depth
    const main = mainCamera.current
    if (main) {
      w.camera.position.set(main.position.x, main.position.y, w.camZ())
      w.camera.quaternion.copy(main.quaternion)
      w.camera.updateMatrixWorld()
      w.camera.projectionMatrix.copy(main.projectionMatrix)
      w.camera.projectionMatrixInverse.copy(main.projectionMatrixInverse)
    }
  })
  return (
    <>
      <hemisphereLight args={['#5a5f9e', '#0c0a12', 0.9]} />
      <directionalLight ref={key} position={[-30, 22, -60]} />
      <directionalLight ref={fill} position={[14, 10, 20]} />
      <ambientLight color="#2a2a48" intensity={0.35} />
    </>
  )
}

/** Mounts one world into its own scene and registers it. */
export function WorldView({ start, children }: { start: number; children: ReactNode }) {
  const w = useMemo(() => makeWorld(start), [start])
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    worlds.set(start, w)
    // compile its shaders in the background (in parallel, where the browser allows), so the first
    // time it's drawn — inside a black hole — costs nothing extra
    const id = setTimeout(() => {
      gl.compileAsync(w.scene, w.camera).catch(() => {})
    }, 50)
    return () => {
      clearTimeout(id)
      worlds.delete(start)
      disposeWorldMats(w.mats)
    }
  }, [start, w, gl])
  return createPortal(
    <WorldContext.Provider value={w}>
      <WorldFrame />
      {children}
    </WorldContext.Provider>,
    w.scene,
    { camera: w.camera },
  )
}
