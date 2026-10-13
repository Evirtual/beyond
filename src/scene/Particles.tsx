import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from './state'
import { mulberry32, range } from './rng'
import { pointer } from './touch'
import { useWorld } from './world'

type Props = {
  count: number
  zMin: number // nearest distance (positive number)
  zMax: number
  spread: number // lateral spread multiplier per unit depth
  size: number
  softness: number // 1 = crisp mote, higher = blurry bokeh disc
  rise: number
  opacity: number
  fog: number
  seed: number
  /** colours to pick from (default: the original mixed motes) */
  tints?: string[]
  /** sideways drift, world units / s (sand on the wind) */
  wind?: number
  /** 0 → steady glow, 1 → fireflies: long dark gaps, brief flashes */
  blink?: number
  /** vertical band the motes live in: centre and height (default: around the eye, scaling with depth) */
  yCenter?: number
  bandHeight?: number
}

const tints = [palette.gold, palette.violet, '#c9d4ff', palette.blue, '#f4ecdc']

/**
 * GPU-animated motes. All drift happens in the vertex shader, so the CPU just
 * bumps one uniform per frame.
 */
export function Motes({ count, zMin, zMax, spread, size, softness, rise, opacity, fog, seed, tints: tintList = tints, wind = 0, blink = 0, yCenter = 0, bandHeight }: Props) {
  const w = useWorld()
  const dpr = useThree((s) => s.viewport.dpr)
  const { geo, mat } = useMemo(() => {
    const r = mulberry32(seed)
    const pos = new Float32Array(count * 3)
    const seeds = new Float32Array(count)
    const scales = new Float32Array(count)
    const colors = new Float32Array(count * 3)
    const c = new THREE.Color()
    const height = bandHeight ?? (zMax * spread + 4) * 1.2
    for (let i = 0; i < count; i++) {
      // bias toward the near end so density reads evenly on screen
      const z = -(zMin + (zMax - zMin) * Math.pow(r(), 1.6))
      const w = -z * spread + 1.5
      pos[i * 3] = range(r, -w, w)
      pos[i * 3 + 1] = range(r, -height / 2, height / 2)
      pos[i * 3 + 2] = z
      seeds[i] = r()
      scales[i] = range(r, 0.4, 1.4)
      c.set(tintList[Math.floor(r() * tintList.length)])
      colors.set([c.r, c.g, c.b], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: size },
        uPR: { value: dpr },
        uSoft: { value: softness },
        uRise: { value: rise },
        uOpacity: { value: opacity },
        uFog: { value: fog },
        uHeight: { value: height },
        uRayO: { value: new THREE.Vector3() },
        uRayD: { value: new THREE.Vector3(0, 0, -1) },
        uHand: { value: 0 },
        uCamZ: { value: 0 },
        uZMin: { value: zMin },
        uZMax: { value: zMax },
        uSpread: { value: spread },
        uWind: { value: wind },
        uBlink: { value: blink },
        uYCenter: { value: yCenter },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uSize, uPR, uRise, uFog, uHeight, uOpacity, uHand, uCamZ, uZMin, uZMax, uSpread, uWind, uBlink, uYCenter;
        uniform vec3 uRayO, uRayD;
        attribute float aSeed, aScale;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          // motes live in a band ahead of the camera and wrap around it, so flying
          // forward streams through them without end; lateral spread follows the new distance
          float span = uZMax - uZMin;
          float ahead = mod(uCamZ - p.z - uZMin, span) + uZMin;
          p.xy *= (ahead * uSpread + 1.5) / (-position.z * uSpread + 1.5);
          p.z = uCamZ - ahead;
          float t = uTime;
          p.y = mod(p.y + uHeight * 0.5 + t * uRise * (0.4 + aSeed), uHeight) - uHeight * 0.5;
          float bandY = p.y;
          p.y += uYCenter;
          p.x += sin(t * 0.13 + aSeed * 40.0) * 0.6 + sin(t * 0.05 + aSeed * 9.0) * 0.8;
          if (uWind != 0.0) {
            // carried sideways and wrapped, so the wind never runs out of sand
            float wspan = ahead * uSpread * 2.0 + 3.0;
            p.x = mod(p.x + wspan * 0.5 + t * uWind * (0.6 + aSeed * 0.8), wspan) - wspan * 0.5;
          }
          p.z += cos(t * 0.11 + aSeed * 23.0) * 0.4;
          // the hand: motes slip off the cursor ray like dust off a fingertip
          vec3 w = (modelMatrix * vec4(p, 1.0)).xyz;
          float along = max(dot(w - uRayO, uRayD), 0.0);
          vec3 away = w - (uRayO + uRayD * along);
          float dh = length(away);
          float reach = 0.25 + along * 0.03;
          // a soft wake that only exists in the near world, fading with depth
          float nearOnly = smoothstep(0.2, 0.8, along) * (1.0 - smoothstep(25.0, 45.0, along));
          float push = smoothstep(reach, 0.0, dh);
          push = push * push * uHand * nearOnly;
          w += away / max(dh, 1e-3) * push * reach * 0.6;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = min(uSize * aScale * uPR * (10.0 / max(d, 0.05)), 160.0 * uPR);
          float twinkle = 0.55 + 0.45 * sin(t * (0.3 + aSeed * 0.9) + aSeed * 60.0);
          // fireflies: mostly dark, a soft flash now and then
          float flash = pow(max(sin(t * (0.6 + aSeed * 0.9) + aSeed * 91.0), 0.0), 6.0);
          twinkle = mix(twinkle, 0.04 + 1.6 * flash, uBlink);
          float edgeFade = smoothstep(0.0, uHeight * 0.08, uHeight * 0.5 - abs(bandY));
          float wrapFade = smoothstep(uZMax, uZMax - span * 0.15, ahead);
          vAlpha = exp(-pow(d * uFog, 2.0)) * twinkle * smoothstep(0.35, 1.2, d) * edgeFade * wrapFade * uOpacity;
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uSoft;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          // crisp: bright core; soft: wide even disc with a faint rim (lens bokeh)
          float core = pow(1.0 - r, 2.0 * uSoft + 1.0);
          float disc = smoothstep(1.0, 0.75, r) * (0.55 + 0.45 * smoothstep(0.5, 0.95, r));
          float a = mix(core, disc * 0.35, clamp(uSoft - 1.0, 0.0, 1.0));
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`,
    })
    return { geo, mat }
  }, [count, zMin, zMax, spread, size, softness, rise, opacity, fog, seed, dpr, tintList, wind, blink, yCenter, bandHeight])

  useFrame((s) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime
    mat.uniforms.uCamZ.value = w.camZ()
    mat.uniforms.uRayO.value.copy(pointer.ray.origin)
    mat.uniforms.uRayD.value.copy(pointer.ray.direction)
    // only the world you're in feels your hand
    mat.uniforms.uHand.value = w.isHere() ? pointer.active : 0
  })

  return <points geometry={geo} material={mat} frustumCulled={false} />
}
