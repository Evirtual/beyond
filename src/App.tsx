import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { DEPTH_STEP, WindowRig } from './scene/WindowRig'
import { Glass } from './scene/Glass'
import { Sky, HazeLayers, LightShafts } from './scene/Atmosphere'
import { Distant } from './scene/Distant'
import { Foreground, Debris } from './scene/Near'
import { ShiftingMidground, Wisps } from './scene/Shifting'
import { EtherContents } from './scene/Ether'
import { Motes } from './scene/Particles'
import { pace, view } from './scene/state'
import { WorldView, useWorld } from './scene/world'
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
  isEther,
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

/**
 * The words on the glass fade as the black hole grows. The hole grows with your flight, so the
 * fade keeps pace with you: scroll fast and they're gone fast.
 */
function StageTextFade({ step }: { step: number }) {
  const last = useRef(-1)
  const introOpacity = useRef(1)
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--intro', '1')
    return () => { document.documentElement.style.removeProperty('--intro') }
  }, [])
  useFrame(() => {
    // (a resting hole sits near 0.27, so the words stay whole until you actually move toward it)
    const v = view.step === step
      ? 1 - THREE.MathUtils.smoothstep(view.hole, 0.32, 0.62)
      : 0
    // Intro opacity only decreases: once swallowed by the first hole it can never
    // return, even while the next stage resets its hole and React is still rendering.
    const intro = view.step === START_STEP ? Math.min(introOpacity.current, v) : 0
    if (intro !== introOpacity.current) {
      introOpacity.current = intro
      document.documentElement.style.setProperty('--intro', String(intro))
    }
    if (Math.abs(v - last.current) < 0.004) return
    last.current = v
    document.documentElement.style.setProperty('--stage', v.toFixed(3))
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

/** Everything inside one zone: home, or (every other world) the ether between homes. */
function WorldContents() {
  const w = useWorld()
  if (isEther(w.start)) return <EtherContents />
  return (
    <>
      <HomeContents />
      <BurstField defaultBurst={BURSTS.home} />
    </>
  )
}

/** Home: the floating world you arrive in. */
function HomeContents() {
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
      <Sky />
      <Distant />
      <LightShafts />
      <HazeLayers />
      <ShiftingMidground />
      <Wisps />
      <GlassEdge />
      {/* as dense as at home: a zone of several shades shows them all at once, so fewer per shade */}
      <Debris perShade={Math.round(90 / w.length)} />
      {/* deep space motes */}
      <Motes count={3200} zMin={3} zMax={90} spread={0.75} size={1.4} softness={1} rise={0.06} opacity={1} fog={0.018} seed={moteSeed} />
      {/* dust right behind the glass: big, out of focus, slow */}
      <Motes count={46} zMin={0.6} zMax={3.2} spread={0.9} size={0.7} softness={2} rise={0.025} opacity={0.75} fog={0} seed={moteSeed + 1} />
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
  // a buffer of worlds already built: two behind and two ahead of the one you're in. Arriving
  // anywhere, the next world (and the previous) already exist, so a black hole never opens onto
  // nothing; the ones being built are two steps away, needed long after the arrival settles
  const wanted = useMemo(() => {
    const z = zoneOf(here)
    const prev = zoneOf(here - 1).start
    const next = z.start + z.length
    return [zoneOf(prev - 1).start, prev, here, next, next + zoneOf(next).length]
  }, [here])
  const [mounted, setMounted] = useState<number[]>(wanted)
  useEffect(() => {
    // the zone you're in, and the very next one, must exist now (normally they already do; only
    // racing through holes faster than the buffer refills needs them at once — a small hitch
    // beats a black hole with nothing inside)
    const urgent = [here, wanted[3]]
    setMounted((cur) => (urgent.every((z) => cur.includes(z)) ? cur : [...cur, ...urgent.filter((z) => !cur.includes(z))]))
    // the rest of the buffer is built once the arrival has settled (about 2.5 s), when nothing is
    // moving fast, so building it never lands in the middle of a crossing
    const id = setTimeout(() => startTransition(() => setMounted(wanted)), 2500)
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
  // the ether is bright: the words on the glass get a dark halo there, so they stay readable
  useEffect(() => {
    document.documentElement.toggleAttribute('data-ether', isEther(step))
  }, [step])
  useEffect(() => {
    if (step === 0 && shown === null) return // the first arrival has its own words
    setShown(step)
  }, [step])
  // Never paint the previous label while the arrival effect catches up.
  if (shown === null || shown !== step) return null
  const sp = spectrumAt(shown)
  const ether = isEther(shown)
  const label = ether ? 'the ether' : sp ? `${sp.hue.name} · ${sp.shade.name}` : 'home'
  const hint = ether
    ? 'between worlds · home lies through the next veil'
    : !sp
    ? 'a new home, never the same twice'
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
  // the pill expands in place: its slider and a close button replace its word.
  // Opening it starts the drift; closing it (×) stops the drift.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!on) setOpen(false)
  }, [on])
  useOpenFlag('drift', open)
  return (
    <div className={'pill drift' + (on ? ' on' : '') + (open ? ' open' : '')}>
      {open ? (
        <>
          <label className="pill-slider" title="pace (↑ / ↓)">
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
          <button
            className="pill-close"
            onClick={() => {
              if (view.auto) toggle()
              setOpen(false)
            }}
            aria-label="stop drifting"
            title="stop drifting"
          >
            <CloseIcon />
          </button>
        </>
      ) : (
        <button
          className="pill-label"
          onClick={() => {
            if (!view.auto) toggle()
            setOpen(true)
          }}
          aria-pressed={on}
          title="drift on by itself (space)"
        >
          {on ? 'drifting' : 'drift'}
        </button>
      )}
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
    let tick = 0
    let lastNow = 0
    let due = 0
    let drawn = 0
    let countFrom = performance.now()
    let inputAt = performance.now()
    const start = performance.now()
    const input = () => (inputAt = performance.now())
    const evs = ['pointermove', 'pointerdown', 'wheel', 'touchstart', 'touchmove', 'keydown'] as const
    evs.forEach((e) => window.addEventListener(e, input, { passive: true }))
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      // the screen's own rate, measured from its frames (ignoring stalls and paused tabs)
      const dt = now - lastNow
      lastNow = now
      if (dt > 4 && dt < 50) pace.hz += (1000 / dt - pace.hz) * 0.05
      // full rate whenever anything moves: your hand, scrolling, drifting, the hole's pull, the
      // whole approach to a black hole and the arrival beyond it, and the opening
      pace.full =
        now - inputAt < 1500 ||
        now - start < 5000 ||
        view.auto ||
        Math.abs(view.speed) > 0.8 ||
        view.hole > 0.02 ||
        view.emerge > 0.001 ||
        view.flash > 0.001 ||
        view.veil > 0.001
      let draw: boolean
      if (pace.cap > 0) {
        // a chosen rate: frames due at that rate (never faster than the screen can show them)
        if (now >= due - 1) {
          due = Math.max(due + 1000 / pace.cap, now - 1000 / pace.cap)
          draw = true
        } else draw = false
        pace.full = true
      } else {
        // auto: in even steps of the screen's rate (every frame, or every second one), never a
        // ragged rate like 40 on a 60 Hz screen — and on fast screens, at least 60
        const target = pace.full ? 60 : 30
        const every = Math.max(1, Math.round(pace.hz / target))
        draw = ++tick % every === 0
      }
      if (draw) {
        invalidate()
        drawn++
      }
      // what's really being drawn, for the frame-rate control to show
      if (now - countFrom >= 1000) {
        pace.actual = Math.round((drawn * 1000) / (now - countFrom))
        drawn = 0
        countFrom = now
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
    // only judge while frames are meant to come at full rate (a deliberately slower pace is not
    // slowness), never change it in the middle of a crossing (resizing the buffers would stall
    // it), and ignore stalls longer than a quarter second (tab switches, a world being built)
    const crossing = view.hole > 0.02 || view.emerge > 0.001 || view.veil > 0.001
    if (!pace.full || dt > 0.25) {
      a.since = 0
      return
    }
    const expected = 1 / Math.min(pace.hz, pace.cap > 0 ? pace.cap : 60)
    a.avg += (dt - a.avg) * 0.05
    a.since += dt
    if (a.since < 3 || crossing) return
    if (a.avg > expected * 1.3 && a.dpr > 0.75) {
      a.dpr = Math.max(0.75, a.dpr - 0.25)
      setDpr(a.dpr)
      a.since = 0
    } else if (a.avg < expected * 1.05 && a.dpr < max && a.since > 8) {
      a.dpr = Math.min(max, a.dpr + 0.25)
      setDpr(a.dpr)
      a.since = 0
    }
  })
  if (import.meta.env.DEV) (window as unknown as { __dpr?: () => number }).__dpr = () => st.current.dpr
  return null
}

/** While a corner control is open, the page knows (so the scroll hint can step out of its way). */
function useOpenFlag(name: string, open: boolean) {
  useEffect(() => {
    document.documentElement.toggleAttribute('data-open-' + name, open)
    return () => document.documentElement.removeAttribute('data-open-' + name)
  }, [name, open])
}

/** A drawn cross (not a font glyph, which sits small and off-centre in this italic serif). */
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** The frame-rate choices: auto, then fixed rates. */
const FPS_STOPS = [0, 24, 30, 60, 120, 240]

/**
 * Frame rate: auto (full rate while anything moves, gentler when still) or a fixed rate. The
 * screen is the limit — the label says what is really being drawn, not just what was asked for.
 * Quiet in the corner like drift, almost invisible until you reach for it.
 */
function FpsControl() {
  const [cap, setCap] = useState(pace.cap)
  const [, refresh] = useState(0)
  useEffect(() => {
    const id = setInterval(() => refresh((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const choose = (v: number) => {
    pace.cap = v
    setCap(v)
    try {
      localStorage.setItem('fpsCap', String(v))
    } catch {
      // private window: it just won't be remembered
    }
  }
  const screen = Math.round(pace.hz)
  // your choice shows at once; the measured rate is added only when it tells you something —
  // the screen can't show that many, or this machine can't keep up
  const label =
    cap === 0
      ? `auto · ${pace.actual} fps`
      : cap > screen + 2
        ? `${cap} · screen ${screen}`
        : pace.actual > 0 && pace.actual < cap * 0.85
          ? `${cap} → ${pace.actual} fps`
          : `${cap} fps`
  // like drift: a quiet pill that opens its slider when you click it, and closes it again
  const [open, setOpen] = useState(false)
  useOpenFlag('fps', open)
  // the pill expands in place: the chosen rate, its slider and a close button replace its label
  return (
    <div className={'pill fps' + (open ? ' open' : '')}>
      {open ? (
        <>
          <label className="pill-slider" title="frame rate: auto, or fixed (the screen's own rate is the limit)">
            <span className="pill-value">{cap === 0 ? 'auto' : `${cap}`}</span>
            <input
              type="range"
              min={0}
              max={FPS_STOPS.length - 1}
              step={1}
              value={Math.max(0, FPS_STOPS.indexOf(cap))}
              onChange={(e) => choose(FPS_STOPS[Number(e.target.value)])}
              aria-label="frame rate"
              aria-valuetext={cap === 0 ? 'auto' : `${cap} frames per second`}
            />
          </label>
          <button className="pill-close" onClick={() => setOpen(false)} aria-label="close" title="close">
            <CloseIcon />
          </button>
        </>
      ) : (
        <button className="pill-label" onClick={() => setOpen(true)} aria-expanded={false} title="frame rate">
          {label}
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [step, setStep] = useState(START_STEP)
  const [introFinished, setIntroFinished] = useState(false)
  const handleStep = (nextStep: number) => {
    setStep(nextStep)
    if (nextStep !== START_STEP) setIntroFinished(true)
  }
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
        <StepWatcher onStep={handleStep} />
        <StageTextFade step={step} />
        <TapInput />
        <Glass />
      </Canvas>
      {/* each stage's words belong to it: they fade as you near its black hole, and the opening
          words are gone once you've left the stage you arrived in */}
      <div className="stage-text">
        {!introFinished && step === START_STEP && (
          <div style={{ opacity: 'var(--intro, 1)' }}>
            <div className="whisper">Look through.</div>
            <Inscription />
            <ScrollHint />
          </div>
        )}
        <DepthMarker step={step} />
      </div>
      {/* the corner controls: their pills side by side on the bottom row, each slider opening above its own */}
      <div className="controls">
        <FpsControl />
        <DriftToggle />
      </div>
    </>
  )
}
