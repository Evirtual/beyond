import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { dissolvable, type DissolveUniform } from './dissolve'
import { DEPTH_STEP } from './WindowRig'
import { mulberry32, range } from './rng'
import { makeBody, nudge } from './touch'
import type { Form } from './forms'
import { useWorld } from './world'
import { PIECES, type Mats } from './pieces'
import { Touchable } from './tap'
import { Shatterable, useShatter } from './shatter'

/** Seconds for a piece to burn away or condense out of nothing. */
const DISSOLVE_SECONDS = 4.5
/** Gap between shifts, seconds. The first one comes early so it gets noticed. */
const FIRST_SHIFT = 11
const SHIFT_MIN = 14
const SHIFT_MAX = 28
/** Pieces per shade's stretch of a zone. */
const PIECE_COUNT = 8

// ── pieces ──────────────────────────────────────────────────────────────────

type Kind = string

type Piece = {
  id: number
  kind: Kind
  pos: THREE.Vector3Tuple
  scale: number
  seed: number
  accent: boolean
  leaving?: boolean
  initial?: boolean
}

// survives hot-reload re-execution, so ids never collide with live pieces
let nextId = Math.floor(performance.now() * 1000)

/** Weighted by the realm: glacial worlds favour spires, arcane worlds gates and stairs… */
function pickKind(r: () => number, form: Form): Kind {
  const kinds = Object.entries(form.kinds).filter(([k]) => k in PIECES)
  const total = kinds.reduce((s, [, w]) => s + w, 0)
  let x = r() * total
  for (const [k, w] of kinds) if ((x -= w) <= 0) return k
  return 'rock'
}

/** A new piece somewhere ahead of a viewpoint at depth `anchor` (camera z). */
function makePiece(r: () => number, others: Piece[], anchor: number, form: Form): Piece {
  const kind = pickKind(r, form)
  const def = PIECES[kind]
  const big = !!def.big
  let best: THREE.Vector3Tuple = [0, 0, -20]
  let bestGap = -Infinity
  // a few tries; keep the spot farthest from everything else (in screen-ish terms)
  for (let t = 0; t < 10; t++) {
    const rel = big ? range(r, 28, 50) : range(r, 10, 40)
    const z = anchor - rel
    const side = r() < 0.5 ? -1 : 1
    // a clear corridor down the middle keeps the deepest view open
    const x = side * range(r, 0.2, 0.66) * rel
    const y = range(r, -rel * 0.27, rel * 0.27)
    let gap = Infinity
    for (const o of others) {
      if (o.leaving) continue
      const oRel = anchor - o.pos[2]
      if (oRel < 4) continue
      const dx = x / rel - o.pos[0] / oRel
      const dy = y / rel - o.pos[1] / oRel
      gap = Math.min(gap, Math.hypot(dx, dy) + Math.abs(z - o.pos[2]) * 0.004)
    }
    if (gap > bestGap) {
      bestGap = gap
      best = [x, y, z]
    }
    if (gap > 0.3) break
  }
  const d = anchor - best[2]
  const [lo, hi, div] = def.scale
  const scale = range(r, lo, hi) * (d / div)
  return { id: nextId++, kind, pos: best, scale, seed: Math.floor(r() * 1e6), accent: r() < 0.3 }
}

function PieceBody({ p, m }: { p: Piece; m: Mats }) {
  const { Body } = PIECES[p.kind] ?? PIECES.rock
  return <Body m={m} seed={p.seed} />
}

function PieceView({ p, onGone }: { p: Piece; onGone: (id: number) => void }) {
  const w = useWorld()
  const group = useRef<THREE.Group>(null!)
  const u = useMemo<DissolveUniform>(() => ({ value: p.initial ? 0 : 1 }), [p.initial])
  const mats = useMemo<Mats>(
    () => ({
      stone: dissolvable(w.mats.stone, u, w.mats.crystalLight),
      dark: dissolvable(w.mats.dark, u, w.mats.crystalLight),
      crystal: dissolvable(p.accent ? w.mats.accent : w.mats.crystal, u, w.mats.crystalLight),
    }),
    [u, p.accent, w],
  )
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])

  const progress = useRef(p.initial ? 0 : 1)
  const gone = useRef(false)
  const phase = (p.seed % 1000) / 159
  const body = useMemo(makeBody, [])

  useFrame((s, dt) => {
    const step = Math.min(dt, 0.05) / DISSOLVE_SECONDS
    progress.current = THREE.MathUtils.clamp(progress.current + (p.leaving ? step : -step), 0, 1)
    const x = progress.current
    u.value = x * x * (3 - 2 * x)
    if (p.leaving && x >= 1 && !gone.current) {
      gone.current = true
      onGone(p.id)
    }
    const t = s.clock.elapsedTime
    const g = group.current
    g.position.set(
      p.pos[0] + Math.sin(t * 0.07 + phase) * 0.3,
      p.pos[1] + Math.sin(t * 0.19 + phase * 2.1) * 0.25,
      p.pos[2],
    )
    // heavy things: they give way to the hand, and turn a little as they do
    // only the world you're in feels your hand
    if (w.isHere()) nudge(g.position, p.scale * 1.6, body, Math.min(dt, 0.05), 0.35, p.scale * 1.5)
    g.position.add(body.off)
    // turns a little in proportion to how far it has been moved
    const turn = body.off.x / Math.max(p.scale, 1)
    g.rotation.y = phase + t * 0.012 + turn * 0.25
    g.rotation.x = Math.sin(t * 0.05 + phase) * 0.06 + (body.off.y / Math.max(p.scale, 1)) * 0.15
  })

  // about half the pieces break apart when touched (which ones is part of each piece's nature)
  const breakable = useMemo(() => (((Math.sin(p.seed * 12.9898) * 43758.5453) % 1) + 1) % 1 < 0.5, [p.seed])
  const shatter = useShatter()
  const onTap = useMemo(() => (pt: THREE.Vector3) => shatter.current.tap?.(pt), [shatter])
  const asleep = useMemo(() => () => shatter.current.broken, [shatter])
  const matList = useMemo(() => [mats.stone, mats.dark, mats.crystal], [mats])

  return (
    <group ref={group} scale={p.scale}>
      <Touchable onTap={breakable ? onTap : undefined} asleep={breakable ? asleep : undefined}>
        {breakable ? (
          <Shatterable materials={matList} seed={p.seed} handle={shatter}>
            <PieceBody p={p} m={mats} />
          </Shatterable>
        ) : (
          <PieceBody p={p} m={mats} />
        )}
      </Touchable>
    </group>
  )
}

/** The midground slowly rearranges itself: one piece leaves while another condenses. */
export function ShiftingMidground() {
  const w = useWorld()
  const rng = useMemo(() => w.rng('midground'), [w])
  const [pieces, setPieces] = useState<Piece[]>(() => {
    // spread along the whole zone: a full midground ahead of every shade
    const arr: Piece[] = []
    for (let k = 0; k < w.length; k++)
      for (let i = 0; i < PIECE_COUNT; i++) arr.push({ ...makePiece(rng, arr, -k * DEPTH_STEP, w.form), initial: true })
    return arr
  })
  // counted from when this world appeared, not from page load
  const nextShift = useRef<number | null>(null)

  useFrame((s) => {
    if (nextShift.current === null) nextShift.current = s.clock.elapsedTime + FIRST_SHIFT
    if (s.clock.elapsedTime < nextShift.current) return
    nextShift.current = s.clock.elapsedTime + range(rng, SHIFT_MIN, SHIFT_MAX)
    setPieces((cur) => {
      const present = cur.filter((p) => !p.leaving)
      if (!present.length) return cur
      // recycle something already flown past if there is one; otherwise anything
      const camZ = w.camZ()
      const passed = present.filter((p) => p.pos[2] > camZ + 3)
      const pool = passed.length ? passed : present
      const out = pool[Math.floor(rng() * pool.length)]
      const marked = cur.map((p) => (p.id === out.id ? { ...p, leaving: true } : p))
      return [...marked, makePiece(rng, marked, camZ, w.form)]
    })
  })

  const onGone = useMemo(() => (id: number) => setPieces((cur) => cur.filter((p) => p.id !== id)), [])

  return (
    <group>
      {pieces.map((p) => (
        <PieceView key={p.id} p={p} onGone={onGone} />
      ))}
    </group>
  )
}

// ── wandering lights ───────────────────────────────────────────────────────

let glowTex: THREE.Texture | null = null
function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.2, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

function Wisp({ color, seed }: { color: THREE.Color; seed: number }) {
  const w = useWorld()
  const ref = useRef<THREE.Group>(null!)
  const mat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      }),
    [color],
  )
  const path = useMemo(() => {
    const r = mulberry32(seed)
    return { a: range(r, 0.02, 0.04), b: range(r, 0.03, 0.05), c: range(r, 0.015, 0.03), ph: r() * 100 }
  }, [seed])
  useFrame((s) => {
    const t = s.clock.elapsedTime + path.ph
    ref.current.position.set(
      Math.sin(t * path.a * 2.3) * 11 + Math.sin(t * path.c * 5) * 3,
      Math.sin(t * path.b * 1.7) * 4 + 0.5,
      w.camZ() - 20 + Math.sin(t * path.c * 3.1) * 9,
    )
  })
  return (
    <group ref={ref}>
      <pointLight color={color} intensity={16} distance={18} decay={1.5} />
      <sprite material={mat} scale={1.6} />
    </group>
  )
}

export function Wisps() {
  const w = useWorld()
  const r = useMemo(() => w.rng('wisps'), [w])
  const seeds = useMemo(() => [Math.floor(r() * 1e6), Math.floor(r() * 1e6)], [r])
  return (
    <>
      <Wisp color={w.mats.crystalLight} seed={seeds[0]} />
      <Wisp color={w.light.glow} seed={seeds[1]} />
    </>
  )
}
