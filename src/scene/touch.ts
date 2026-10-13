import * as THREE from 'three'

/**
 * The visitor's hand reaching through the glass: the cursor (or finger) is a
 * ray into the world. Things near the ray drift off it, and moving the hand
 * carries them a little way along. Every body has a soft spring home.
 *
 * Everything here is bounded on purpose: bodies are *pulled toward* a capped
 * speed (never accelerated without limit), and can only stray a capped
 * distance — a flick of the mouse nudges, it never flings.
 */
export const pointer = {
  /** raw cursor, NDC */
  ndc: new THREE.Vector2(),
  /** lightly smoothed cursor, NDC */
  smooth: new THREE.Vector2(),
  /** smoothed cursor velocity, NDC per second (capped) */
  vel: new THREE.Vector2(),
  /** 0 → hand withdrawn (cursor left / finger lifted), 1 → present */
  active: 0,
  /** target for `active` */
  present: false,
  ray: new THREE.Ray(),
  aspect: 1,
  tanHalfFov: Math.tan(THREE.MathUtils.degToRad(25)),
}

const MAX_NDC_SPEED = 2.5 // a fast flick, not a teleport
const raycaster = new THREE.Raycaster()
const prev = new THREE.Vector2()
let wasPresent = false

/** Called by the rig once the camera is placed for this frame. */
export function updatePointer(camera: THREE.PerspectiveCamera, dt: number) {
  if (pointer.present && !wasPresent) {
    // the hand arrives where it is; it doesn't streak in from the centre
    pointer.smooth.copy(pointer.ndc)
    pointer.vel.set(0, 0)
  }
  wasPresent = pointer.present

  prev.copy(pointer.smooth)
  pointer.smooth.lerp(pointer.ndc, 1 - Math.exp(-14 * dt))
  const inv = 1 / Math.max(dt, 1e-3)
  const vx = (pointer.smooth.x - prev.x) * inv
  const vy = (pointer.smooth.y - prev.y) * inv
  const k = 1 - Math.exp(-8 * dt)
  pointer.vel.x += (vx - pointer.vel.x) * k
  pointer.vel.y += (vy - pointer.vel.y) * k
  if (pointer.vel.length() > MAX_NDC_SPEED) pointer.vel.setLength(MAX_NDC_SPEED)

  pointer.active += ((pointer.present ? 1 : 0) - pointer.active) * (1 - Math.exp(-3 * dt))
  pointer.aspect = camera.aspect
  pointer.tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  raycaster.setFromCamera(pointer.smooth, camera)
  pointer.ray.copy(raycaster.ray)
}

export type Body = { off: THREE.Vector3; vel: THREE.Vector3 }
export const makeBody = (): Body => ({ off: new THREE.Vector3(), vel: new THREE.Vector3() })

/** Beyond this distance along the ray the hand fades out: it reaches into the near world. */
const HAND_DEPTH = 45

const closest = new THREE.Vector3()
const here = new THREE.Vector3()
const desired = new THREE.Vector3()
const sweep = new THREE.Vector3()

/**
 * Let the hand act on one body resting at `rest` this frame.
 * - radius: how big the body is (world units)
 * - mobility: 1 = light pebble, ~0.3 = heavy island
 * - maxOff: furthest it may drift from rest (defaults to its own size)
 * Returns how strongly it is being touched (0..1).
 */
export function nudge(rest: THREE.Vector3, radius: number, b: Body, dt: number, mobility = 1, maxOff = radius * 1.2) {
  here.copy(rest).add(b.off)
  let f = 0
  desired.set(0, 0, 0)

  if (pointer.active > 0.01) {
    pointer.ray.closestPointToPoint(here, closest)
    const along = closest.distanceTo(pointer.ray.origin)
    const reach = radius + 0.25 + along * 0.03
    const depthFade = 1 - THREE.MathUtils.smoothstep(along, HAND_DEPTH * 0.6, HAND_DEPTH)
    desired.subVectors(here, closest)
    const d = desired.length()
    if (along > 0.3 && d < reach && depthFade > 0) {
      f = (1 - d / reach) ** 2 * pointer.active * depthFade
      // drift off the ray, at a speed that scales with how big the reach looks
      if (d > 1e-4) desired.multiplyScalar((reach * 1.4 * (1 - d / reach)) / d)
      else desired.set(0, reach * 1.4, 0)
      // moving the hand carries it along — capped so a flick can't fling
      sweep.set(
        pointer.vel.x * along * pointer.tanHalfFov * pointer.aspect,
        pointer.vel.y * along * pointer.tanHalfFov,
        0,
      ).multiplyScalar(0.45)
      if (sweep.length() > reach * 2) sweep.setLength(reach * 2)
      desired.add(sweep)
    }
  }

  // touched: velocity eases toward the desired drift (never beyond it)
  if (f > 0) b.vel.lerp(desired, 1 - Math.exp(-5 * f * mobility * dt))
  // always: soft spring home, gentle damping
  b.vel.addScaledVector(b.off, -1.5 * dt)
  b.vel.multiplyScalar(Math.exp(-1.6 * dt))
  b.off.addScaledVector(b.vel, dt)
  if (b.off.length() > maxOff) {
    b.off.setLength(maxOff)
    b.vel.multiplyScalar(0.5)
  }
  return f
}
