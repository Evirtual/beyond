import * as THREE from 'three'

function hash(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  const l = (a: number, b: number, t: number) => a + (b - a) * t
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  )
}

function fbm(x: number, y: number, z: number) {
  let a = 0.5, f = 1, s = 0
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x * f, y * f, z * f)
    f *= 2.03
    a *= 0.5
  }
  return s
}

/** Faceted stone: displaced icosahedron, flat-shaded via non-indexed normals. */
export function rockGeometry(seed: number, opts: { detail?: number; rough?: number; island?: boolean } = {}) {
  const { detail = 2, rough = 0.42, island = false } = opts
  const g = new THREE.IcosahedronGeometry(1, detail)
  const p = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm(v.x * 1.4 + seed * 7.1, v.y * 1.4 + seed * 3.3, v.z * 1.4 - seed * 5.7)
    v.multiplyScalar(1 + (n - 0.5) * rough * 2)
    if (island) {
      // flat-ish top, long hanging root below: a floating island
      if (v.y > 0.15) v.y = 0.15 + (v.y - 0.15) * 0.25
      else v.y *= 1.9 - Math.abs(v.x) * 0.6
    }
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

/** Elongated bipyramid shard. */
export function shardGeometry() {
  const g = new THREE.OctahedronGeometry(1, 0)
  g.scale(0.22, 1, 0.22)
  g.translate(0, 0.85, 0)
  return g
}
