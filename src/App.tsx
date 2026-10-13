import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { DEPTH_STEP, WindowRig } from './scene/WindowRig'
import { Glass } from './scene/Glass'
import { Sky, HazeLayers, LightShafts } from './scene/Atmosphere'
import { Distant } from './scene/Distant'
import { Foreground, Debris } from './scene/Near'
import { ShiftingMidground, Wisps } from './scene/Shifting'
import { Motes } from './scene/Particles'
import { view } from './scene/state'
import { WorldView, useWorld } from './scene/world'
import { UNIVERSES } from './scene/universes'
import { realityFor } from './scene/reality'
import { BurstField, TapInput, type Burst } from './scene/tap'
import type { FormName } from './scene/moment'

/** What each world throws out when you touch it: its own matter. */
const BURSTS: Record<FormName, Burst> = {
  home: { color: '#d8d4ff', kind: 'spray' },
  jagged: { color: '#ffb0a0', kind: 'spray', count: 60 },
  eroded: { color: '#ffd27a', kind: 'spray', count: 50 },
  radiant: { color: '#fff6dc', kind: 'ring', count: 60 },
  grown: { color: '#c8ff9a', kind: 'rise', count: 70 },
  glacial: { color: '#cff6ff', kind: 'rise', count: 90 },
  arcane: { color: '#e2ccff', kind: 'ring', count: 60 },
}
import {
  applySpectrum,
  arrivedAt,
  dayPeriod,
  DEPTH_CYCLE,
  hourPreviewed,
  light,
  localHour,
  moonName,
  moonPhase,
  seedFromUrl,
  spectrumAt,
  START_STEP,
  updateLight,
  viewId,
  zoneOf,
} from './scene/moment'

/** Keeps the hour's light and the exposure in step with the real clock. */
function MomentLighting() {
  const gl = useThree((s) => s.gl)
  const last = useRef(-10)
  useFrame((s) => {
    if (s.clock.elapsedTime - last.current > 1) {
      last.current = s.clock.elapsedTime
      updateLight()
    }
    applySpectrum(view.depth / DEPTH_STEP)
    gl.toneMappingExposure = light.exposure
  })
  return null
}

/** Tells React when the flight has moved on a shade (or a zone). */
function StepWatcher({ onStep }: { onStep: (step: number) => void }) {
  const last = useRef(START_STEP)
  useFrame(() => {
    if (view.step !== last.current) {
      last.current = view.step
      onStep(view.step)
    }
  })
  return null
}

/** What presses against the glass at the start of every shade, in every world. */
function GlassEdge() {
  const { length } = useWorld()
  return (
    <>
      {/* the same number of lights in every zone (3 foreground slots), so no world ever
          needs its materials recompiled */}
      {Array.from({ length: 3 - length }, (_, i) => (
        <pointLight key={'pad' + i} intensity={0} />
      ))}
      {Array.from({ length }, (_, i) => (
        <group key={i} position={[0, 0, -i * DEPTH_STEP]}>
          <Foreground index={i} />
        </group>
      ))}
    </>
  )
}

/** Everything inside one zone (one colour, all its shades, flown through continuously). */
function WorldContents() {
  const w = useWorld()
  const Universe = UNIVERSES[w.formName]
  if (Universe)
    return (
      <>
        {/* the colour's own air and space around it, and home's elements living in it */}
        <Universe />
        {/* folded into pattern, the world needs less of everything: lighter on a laptop */}
        <HomeContents sky={false} light />
        <BurstField defaultBurst={BURSTS[w.formName]} />
      </>
    )
  return (
    <>
      <HomeContents />
      <BurstField defaultBurst={BURSTS.home} />
    </>
  )
}

/** Home: the floating world you arrive in. */
function HomeContents({ sky = true, light = false }: { sky?: boolean; light?: boolean }) {
  const w = useWorld()
  // dev-only: how long building this zone blocks the page (render → commit)
  const t0 = useMemo(() => performance.now(), [])
  useLayoutEffect(() => {
    if (import.meta.env.DEV) {
      const win = window as unknown as { __mountMs?: number[] }
      ;(win.__mountMs ??= []).push(+(performance.now() - t0).toFixed(1))
    }
  }, [t0])
  const moteSeed = useMemo(() => Math.floor(w.rng('motes')() * 1e6), [w])
  return (
    <>
      {sky && <Sky />}
      <Distant />
      <LightShafts />
      <HazeLayers />
      <ShiftingMidground />
      <Wisps glow={!light} />
      {/* in a pattern realm nothing presses against the glass — so close, it only folds into blobs.
          Its three lights stay (dark), so every world keeps the same light count */}
      {light ? Array.from({ length: 3 }, (_, i) => <pointLight key={'pad' + i} intensity={0} />) : <GlassEdge />}
      {/* as dense as at home: a zone of several shades shows them all at once, so fewer per shade */}
      {/* (folded into a mandala, scattered shards only turn into meaningless specks: home only) */}
      {!light && <Debris perShade={Math.round(90 / w.length)} />}
      {/* deep space motes */}
      <Motes count={light ? 1400 : 3200} zMin={3} zMax={90} spread={0.75} size={1.4} softness={1} rise={0.06} opacity={1} fog={0.018} seed={moteSeed} />
      {/* dust right behind the glass: big, out of focus, slow */}
      {!light && <Motes count={46} zMin={0.6} zMax={3.2} spread={0.9} size={0.7} softness={2} rise={0.025} opacity={0.75} fog={0} seed={moteSeed + 1} />}
    </>
  )
}

/**
 * The worlds that exist right now: the zone you're in, and the two waiting inside
 * its black holes. When you cross, the zone you enter is already built — the new
 * neighbour beyond it is built a moment later, in slices, so the flight never stalls.
 */
function Worlds({ step }: { step: number }) {
  const here = zoneOf(step).start
  const wanted = useMemo(() => {
    const z = zoneOf(here)
    return [zoneOf(here - 1).start, here, z.start + z.length]
  }, [here])
  const [mounted, setMounted] = useState<number[]>(wanted)
  useEffect(() => {
    // the zone you're in must exist now (normally it already does)
    setMounted((cur) => (cur.includes(here) ? cur : [...cur, here]))
    const id = setTimeout(() => startTransition(() => setMounted(wanted)), 700)
    return () => clearTimeout(id)
  }, [here, wanted])
  return (
    <>
      {mounted.map((start) => (
        <WorldView key={start} start={start}>
          <WorldContents />
        </WorldView>
      ))}
    </>
  )
}

function Inscription() {
  const h = localHour(arrivedAt)
  const time = hourPreviewed
    ? `previewing ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
    : arrivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const period = dayPeriod(h)
  return (
    <div className="inscription">
      <div>
        {time} · {period} · {moonName(moonPhase(arrivedAt))}
      </div>
      <div className="dim">
        {seedFromUrl ? `revisiting view ${viewId} · its light is still this moment` : `this view grew from the moment you arrived · ${viewId}`}
      </div>
    </div>
  )
}

/**
 * A quiet hint, once, that the space goes deeper. Leaves as soon as the
 * visitor travels — by scroll or swipe — and doesn't come back this visit.
 */
function ScrollHint() {
  const [gone, setGone] = useState(false)
  const touch = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])
  useEffect(() => {
    const leave = () => setGone(true)
    window.addEventListener('wheel', leave, { passive: true, once: true })
    window.addEventListener('touchmove', leave, { passive: true, once: true })
    return () => {
      window.removeEventListener('wheel', leave)
      window.removeEventListener('touchmove', leave)
    }
  }, [])
  return (
    <div className={'scroll-hint' + (gone ? ' gone' : '')} aria-hidden={gone}>
      <div className="scroll-hint-line"><span /></div>
      <div>{touch ? 'swipe up to go deeper' : 'scroll to go deeper'}</div>
    </div>
  )
}

/** A brief mark on arrival in each world, so the cycle back home can be felt. */
function DepthMarker({ step }: { step: number }) {
  const [shown, setShown] = useState<number | null>(null)
  useEffect(() => {
    if (step === 0 && shown === null) return // the first arrival has its own words
    setShown(step)
  }, [step])
  if (shown === null) return null
  const sp = spectrumAt(shown)
  const reality = realityFor(shown)
  // each reality is named, not coloured: its colours are dealt fresh every journey
  const label = sp ? `${reality?.name ?? ''} · ${sp.shade.name}` : 'home'
  const hint = !sp
    ? 'the world you arrived in'
    : sp.index === DEPTH_CYCLE - 1
      ? 'home lies one veil further'
      : sp.shade.name === 'dark'
        ? `${sp.index} of ${DEPTH_CYCLE - 1} · something waits in the dark ahead`
        : `${sp.index} of ${DEPTH_CYCLE - 1} of this journey`
  return (
    <div className="depth-marker" key={shown}>
      <div>{label}</div>
      {hint && <div className="dim">{hint}</div>}
    </div>
  )
}

/**
 * Drift: let the view fly on by itself. A quiet word in the corner (and the space bar);
 * almost invisible until you reach for it.
 */
// the slider is logarithmic: its middle is the natural pace, each end four times off it
const rateToSlider = (r: number) => Math.log(r / 0.25) / Math.log(16)
const sliderToRate = (v: number) => 0.25 * Math.pow(16, v)

function DriftToggle() {
  const [on, setOn] = useState(view.auto)
  const [rate, setRate] = useState(view.driftRate)
  const setPace = (r: number) => {
    view.driftRate = Math.min(4, Math.max(0.25, r))
    setRate(view.driftRate)
    try {
      localStorage.setItem('driftRate', String(view.driftRate))
    } catch {
      // private window: it just won't be remembered
    }
  }
  const toggle = () => {
    view.auto = !view.auto
    setOn(view.auto)
    try {
      localStorage.setItem('drift', view.auto ? '1' : '0')
    } catch {
      // private window: it just won't be remembered
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        toggle()
      }
      // faster / slower while drifting
      if (view.auto && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
        e.preventDefault()
        setPace(view.driftRate * (e.code === 'ArrowUp' ? 1.2 : 1 / 1.2))
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className={'drift' + (on ? ' on' : '')}>
      {on && (
        <label className="drift-pace" title="pace (↑ / ↓)">
          <span>slow</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={rateToSlider(rate)}
            onChange={(e) => setPace(sliderToRate(Number(e.target.value)))}
            aria-label="drift pace"
          />
          <span>fast</span>
        </label>
      )}
      <button className={'drift-toggle' + (on ? ' on' : '')} onClick={toggle} aria-pressed={on} title="drift on by itself (space)">
        {on ? 'drifting' : 'drift'}
      </button>
    </div>
  )
}

/**
 * Paces drawing to what the moment needs, so a laptop doesn't run flat out: up to 60 frames a
 * second while you move (or a crossing is under way), 40 while drifting, 30 while you're still —
 * the scene moves slowly enough that stillness loses nothing. A 120 Hz screen no longer means 120.
 */
function FrameGovernor() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let raf = 0
    let last = 0
    let inputAt = performance.now()
    const start = performance.now()
    const input = () => (inputAt = performance.now())
    const evs = ['pointermove', 'pointerdown', 'wheel', 'touchstart', 'touchmove', 'keydown'] as const
    evs.forEach((e) => window.addEventListener(e, input, { passive: true }))
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      // smooth when it matters: while you move, through the opening, and through a crossing
      const active = now - inputAt < 1500 || now - start < 5000 || view.hole > 0.6 || view.emerge > 0.01
      const fps = active ? 60 : view.auto ? 40 : 30
      if (now - last >= 1000 / fps - 2) {
        last = now
        invalidate()
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      evs.forEach((e) => window.removeEventListener(e, input))
    }
  }, [invalidate])
  return null
}

/**
 * Keeps the frame rate up on modest machines: when frames run slow for a couple of seconds it
 * renders at a lower resolution, and when there's room again it climbs back (up to 1.25×). Everything else stays the same; only the sharpness gives way.
 */
function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr)
  const max = Math.min(window.devicePixelRatio || 1, 1.25)
  const st = useRef({ dpr: max, avg: 1 / 60, since: 0 })
  useFrame((_, dt) => {
    const a = st.current
    // ignore stalls longer than a quarter second (tab switches, a world being built)
    if (dt > 0.25) return
    a.avg += (dt - a.avg) * 0.05
    a.since += dt
    if (a.since < 2) return
    if (a.avg > 1 / 45 && a.dpr > 0.75) {
      a.dpr = Math.max(0.75, a.dpr - 0.25)
      setDpr(a.dpr)
      a.since = 0
    } else if (a.avg < 1 / 58 && a.dpr < max && a.since > 6) {
      a.dpr = Math.min(max, a.dpr + 0.25)
      setDpr(a.dpr)
      a.since = 0
    }
  })
  if (import.meta.env.DEV) (window as unknown as { __dpr?: () => number }).__dpr = () => st.current.dpr
  return null
}

export default function App() {
  const [step, setStep] = useState(START_STEP)
  return (
    <>
      <Canvas
        dpr={[1, 1.25]}
        // frames are drawn on demand, paced by FrameGovernor; and the browser may use the cooler GPU
        frameloop="demand"
        gl={{ antialias: false, powerPreference: 'default' }}
        camera={{ fov: 50, near: 0.1, far: 1400, position: [0, 0, 3] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
        }}
      >
        <MomentLighting />
        <AdaptiveResolution />
        <FrameGovernor />
        {/* each world lives in its own scene; the glass decides which to show, and where */}
        <Worlds step={step} />

        <WindowRig />
        <StepWatcher onStep={setStep} />
        <TapInput />
        <Glass />
      </Canvas>
      <div className="whisper">Look through.</div>
      <Inscription />
      <DepthMarker step={step} />
      <ScrollHint />
      <DriftToggle />
    </>
  )
}
