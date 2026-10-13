import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { range } from './rng'
import { rngFor } from './moment'
import { useWorld } from './world'

/**
 * Gradient dome whose colours follow the visitor's real time of day, one low
 * glow far beyond everything, and the moon in its real current phase.
 */
export function Sky() {
  const { light } = useWorld()
  const mat = useMemo(() => {
    const r = rngFor('moon')
    const moonDir = new THREE.Vector3(range(r, -0.75, 0.75), range(r, 0.2, 0.42), -1).normalize()
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: light.top },
        uHorizon: { value: light.horizon },
        uGlow: { value: light.glow },
        uViolet: { value: light.hazeA },
        uMoonDir: { value: moonDir },
        uPhase: { value: 0 },
        uMoonLight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uGlow, uViolet, uMoonDir;
        uniform float uPhase, uMoonLight;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));
          col = mix(col, uTop * 0.6, smoothstep(-0.02, -0.6, h));
          // low source somewhere beyond everything; its colour is the hour's
          float g = max(dot(d, normalize(vec3(-0.25, 0.03, -1.0))), 0.0);
          col += uGlow * (pow(g, 40.0) * 0.09 + pow(g, 6.0) * 0.02);
          float v = max(dot(d, normalize(vec3(0.5, 0.35, -1.0))), 0.0);
          col += uViolet * pow(v, 5.0) * 0.012;

          // the moon, lit according to its real phase (0 new → 0.5 full)
          vec3 f = uMoonDir;
          vec3 rt = normalize(cross(f, vec3(0.0, 1.0, 0.0)));
          vec3 up = cross(rt, f);
          float R = 0.04;
          vec2 q = vec2(dot(d, rt), dot(d, up)) / R;
          float rr = dot(q, q);
          float facing = dot(d, f);
          if (facing > 0.95 && rr < 1.0) {
            vec3 n = vec3(q, sqrt(1.0 - rr));
            float a = uPhase * 6.2831853;
            vec3 sun = vec3(sin(a), 0.0, -cos(a));
            float lit = smoothstep(-0.03, 0.08, dot(n, sun));
            float mott = 0.82 + 0.18 * sin(q.x * 6.0 + q.y * 3.1) * sin(q.y * 4.7 - q.x * 2.3);
            vec3 moon = vec3(0.62, 0.6, 0.56) * lit * mott * (0.35 + 0.65 * uMoonLight) + uHorizon * 1.3;
            col = mix(col, moon, smoothstep(1.0, 0.93, rr));
          }
          float md = max(facing, 0.0);
          col += vec3(0.55, 0.6, 0.8) * (pow(md, 900.0) * 0.12 + pow(md, 90.0) * 0.025) * uMoonLight;

          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  }, [light])
  useFrame(() => {
    mat.uniforms.uPhase.value = light.moonPhase
    mat.uniforms.uMoonLight.value = light.moonLight
  })
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[600, 48, 24]} />
    </mesh>
  )
}

const hazeMaterial = (color: THREE.Color, opacity: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);
        // thin out as you fly into it, so passing through a bank never pops
        a *= smoothstep(1.0, 14.0, vDepth);
        gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
      }`,
  })

/**
 * Soft additive glow banks at many depths. Because each one sits at a different
 * distance, they slide against each other under parallax — cheap volumetrics.
 */
export function HazeLayers() {
  const { light, rng } = useWorld()
  const items = useMemo(() => {
    const r = rng('haze')
    // the warm banks take the colour of the hour, and keep following it
    // haze tones follow the light: violet and blue at home, the hue of the spectrum elsewhere
    const colors = [light.hazeA, light.hazeB, light.glow, light.hazeB, light.hazeA]
    return Array.from({ length: 16 }, (_, i) => {
      const z = -range(r, 14, 260)
      const spread = -z * 0.75
      const size = -z * range(r, 0.5, 1.1)
      const color = colors[i % colors.length]
      const opacity = (color === light.glow ? 0.035 : 0.045) * range(r, 0.6, 1.2)
      return {
        pos: [range(r, -spread, spread), range(r, -spread * 0.35, spread * 0.25), z] as const,
        size,
        mat: hazeMaterial(color, opacity),
      }
    })
  }, [light, rng])
  return (
    <group>
      {items.map((h, i) => (
        <mesh key={i} position={h.pos} material={h.mat} renderOrder={-5}>
          <planeGeometry args={[h.size * 1.6, h.size]} />
        </mesh>
      ))}
    </group>
  )
}

/** A few tilted shafts of light falling from somewhere above. */
export function LightShafts() {
  const { light } = useWorld()
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uColor: { value: light.glow } },
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vWorld;
          void main() { vUv = uv; vWorld = (modelMatrix * vec4(position,1.0)).xyz;
            gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor;
          varying vec2 vUv; varying vec3 vWorld;
          void main() {
            float across = sin(vUv.x * 3.14159);
            across = pow(across, 3.0);
            float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            float flicker = 0.75 + 0.25 * sin(uTime * 0.2 + vWorld.x * 0.05);
            float streak = 0.7 + 0.3 * sin(vUv.x * 23.0 + uTime * 0.07);
            gl_FragColor = vec4(uColor * across * along * flicker * streak * 0.05, 1.0);
          }`,
      }),
    [light],
  )
  useFrame((s) => (mat.uniforms.uTime.value = s.clock.elapsedTime))
  const shafts = [
    { p: [-34, 18, -120], r: 0.32, w: 14, h: 120 },
    { p: [-18, 20, -150], r: 0.28, w: 7, h: 120 },
    { p: [12, 26, -95], r: 0.36, w: 5, h: 90 },
  ] as const
  return (
    <group>
      {shafts.map((s, i) => (
        <mesh key={i} position={s.p} rotation={[0, 0, s.r]} material={mat} renderOrder={-4}>
          <planeGeometry args={[s.w, s.h]} />
        </mesh>
      ))}
    </group>
  )
}
