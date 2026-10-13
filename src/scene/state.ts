// Mutable per-frame state shared between the rig, the scene and the glass pass.
// Kept outside React so nothing re-renders at 60fps.
/** whether drifting was on last time (kept in this browser only) */
const driftSaved = (() => {
  try {
    return localStorage.getItem('drift') === '1'
  } catch {
    return false
  }
})()

/** how fast drifting goes, as a multiple of its natural pace (kept in this browser only) */
const driftRateSaved = (() => {
  try {
    const v = Number(localStorage.getItem('driftRate'))
    return v >= 0.25 && v <= 4 ? v : 1
  } catch {
    return 1
  }
})()

export const view = {
  /** drift pace: 0.25 (a minute a shade) … 4 (a few seconds a shade) */
  driftRate: driftRateSaved,
  /** drift: the view flies on by itself, no scrolling needed */
  auto: driftSaved,
  /** 0..1: how still you've been lately (grows slowly, falls fast when you move) */
  still: 0,
  /** 0..1: after long stillness, the boundaries between screen, world and you dissolve */
  oneness: 0,
  /** where your attention rests on the screen (0..1, y up) */
  px: 0.5,
  py: 0.55,
  /** smoothed viewpoint offset, -1..1 on each axis */
  x: 0,
  y: 0,
  /** smoothed total depth travelled, world units (unbounded, signed) */
  depth: 0,
  /** which world we're in: round(depth / DEPTH_STEP) */
  step: 0,
  /** position inside the current world, -DEPTH_STEP/2 … +DEPTH_STEP/2 */
  local: 0,
  /** 0 → clear, 1 → fully inside the veil between worlds */
  veil: 0,
  /** the crossing ahead (or behind) changes colour: a black hole instead of a bright veil */
  holeBoundary: false,
  /** 0 → no hole, 1 → swallowed */
  hole: 0,
  /** the step on the far side of the nearest crossing */
  across: 0,
  /** first step and length of the current zone (one colour, flown through continuously) */
  zoneStart: 0,
  zoneLength: 1,
  /** camera z inside the current zone's space */
  camZ: 0,
  /** 0 → travelling forward: the hole grows from the centre; 1 → travelling back: darkness closes in from the edges */
  holeBehind: 0,
  /** 1 → just thrown out of a black hole, easing to 0 as the new zone opens around you */
  emerge: 0,
  /** white-hole flash on arrival, 1 → 0 */
  flash: 0,
  /** spiral: how far the view is wound into the centre (0..1), and which way it turns */
  spiral: 0,
  spiralDir: 1,
  /** wormhole: how present the tunnel is (0..1), how far through it you are (0..1), its scroll */
  tunnel: 0,
  tunnelP: 1,
  tunnelPhase: 0,
  /** the zones the tunnel runs between (their colours tint it) */
  tunnelFrom: 0,
  tunnelTo: 0,
  /** smoothed travel speed through depth (world units / s) */
  speed: 0,
  /** 0 → screen closed (black), 1 → fully open */
  open: 0,
}

export const palette = {
  void: '#04050a',
  horizon: '#121226',
  fog: '#121226',
  gold: '#e0b57a',
  violet: '#7b6cd9',
  blue: '#4f6fb8',
  stone: '#6c6a78',
}
