import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { view } from './state'
import { light, ringColorFor, TRANSITION, zoneOf } from './moment'
import { worlds } from './world'
import { MOTION_COUNT } from './reality'

/**
 * How a pattern realm's mandala moves (reality.motion):
 * 0 dive — rings flow out from the centre toward you
 * 1 sink — rings flow in from the edges toward the centre
 * 2 from the sides — the pattern sweeps in from left and right
 * 3 from above and below — the pattern sweeps in vertically
 * 4 pulse — it breathes in and out, like a heartbeat
 * 5 bloom — its petals open and close in waves around the circle
 * 6 vortex — its arms wind into a spiral that pulls inward, turning
 * 7 turn — the rings turning, each its own way
 * Only bloom, vortex and turn rotate; the rest move without turning, so each reads as itself.
 */
const MOTIONS = [
  { speed: 0.12, pulse: 0, bloom: 0, vortex: 0, sx: 0, sy: 0, spin: 0 },
  { speed: -0.12, pulse: 0, bloom: 0, vortex: 0, sx: 0, sy: 0, spin: 0 },
  { speed: 0.0, pulse: 0, bloom: 0, vortex: 0, sx: 0.32, sy: 0, spin: 0 },
  { speed: 0.0, pulse: 0, bloom: 0, vortex: 0, sx: 0, sy: 0.26, spin: 0 },
  { speed: 0, pulse: 0.9, bloom: 0, vortex: 0, sx: 0, sy: 0, spin: 0 },
  { speed: 0.02, pulse: 0, bloom: 0.35, vortex: 0, sx: 0, sy: 0, spin: 0.3 },
  { speed: 0.09, pulse: 0, bloom: 0, vortex: 2.2, sx: 0, sy: 0, spin: 1 },
  { speed: 0.03, pulse: 0, bloom: 0, vortex: 0, sx: 0, sy: 0, spin: 1.6 },
]
import type { FormName } from './moment'

/**
 * What each universe is made of, felt through the glass:
 * x — liquid: slow rolling refraction, as if the window were full of water
 * y — heat: fine shimmer rising from below
 * z — caustics: dancing light from a surface above
 * w — gas: a lazy, curling swirl
 * A world of hard things (the Orrery) gets none of it: crisp, still, exact.
 */
const MEDIA: Partial<Record<FormName, [number, number, number, number]>> = {}
/**
 * The law of each reality — how it is perceived — applied as you look through the glass
 * (and, inside a black hole, the law of the reality beyond it, so crossing changes nothing):
 * 1 attention — only what you look at exists; the rest sinks into colourless shadow
 * 2 echo — nothing passes: every movement leaves afterimages, slowly fading
 * 3 mirror — all is reflection: space folds into a six-fold kaleidoscope, turning
 * 4 edges — only boundaries exist: the world as glowing contour lines
 * 5 the other side — everything is its opposite: up is down, light is dark
 * 6 particles — matter is only points of light, scattering as you move, gathering as you rest
 * 7 breath — the whole world swells and settles, slowly
 * 8 liquid — seen through moving water, netted with caustic light
 * 9 strata — the world cut into layers that drift past each other
 * 10 recursion — the view repeats inward forever
 * 11 heat — things seen by their warmth
 * 12 mosaic — stained-glass cells of light, leaded in dark
 * 13 nautilus — mandalas arranged by the golden angle, each smaller than the last
 * (each world's law comes from the reality it was dealt — see reality.ts)
 */
const lawFor = (w: { reality: { law: number; folds: number; spin: number; twist: number } | null } | undefined, out: THREE.Vector4) => {
  const r = w?.reality
  return r ? out.set(r.law, r.folds, r.spin, r.twist) : out.set(0, 0, 0, 0)
}


const mediumFor = (name: FormName | undefined, out: THREE.Vector4) => out.set(...(MEDIA[name as FormName] ?? [0, 0, 0, 0]))

const glowTmp = new THREE.Color()
const black = new THREE.Color(0, 0, 0)
const white = new THREE.Color(1, 1, 1)
const holePoint = new THREE.Vector3()
const OPEN_DELAY = 0.35
const OPEN_DURATION = 3.0

/**
 * Takes over rendering: draws the world into an offscreen target, then
 * composites it through the "glass" — faint refraction wobble, edge darkening,
 * a reflection sheen that moves against the world, grain, and the opening.
 */
export function Glass() {
  const { gl, scene, camera, size } = useThree()
  // 2× smoothing, not 4×: most of the edge work for half the cost (laptops stay cooler)
  const fbo = useFBO({ samples: 2, type: THREE.HalfFloatType })
  // the world waiting inside the black hole
  const portalFbo = useFBO({ samples: 2, type: THREE.HalfFloatType })
  // echo: two buffers taking turns holding the world's memory
  const echoA = useFBO({ type: THREE.HalfFloatType })
  const echoB = useFBO({ type: THREE.HalfFloatType })
  const echo = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { tNew: { value: null }, tOld: { value: null }, uKeep: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tNew, tOld;
        uniform float uKeep;
        varying vec2 vUv;
        void main() {
          vec3 now = texture2D(tNew, vUv).rgb;
          vec3 was = texture2D(tOld, vUv).rgb;
          gl_FragColor = vec4(mix(now, was, uKeep), 1.0);
        }`,
    })
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m))
    return { m, scene, read: 0, active: false }
  }, [])

  const tricks = useRef({ zone: Number.NaN, folds: 0, to: 0, shape: 0, shapeTo: 0, mix: 0, next: 0, n: 0, motion: 0 })
  // the motion right now, easing toward its kind's preset (see MOTIONS)
  const motion = useRef({ flow: 0, speed: 0, pulse: 0, bloom: 0, vortex: 0, sx: 0, sy: 0, spin: 0, turn: 0, phase: 0 })
  const { quadScene, quadCam, mat } = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tPortal: { value: null },
        uPortal: { value: 0 },
        uTime: { value: 0 },
        uOpen: { value: 0 },
        uAspect: { value: 1 },
        uView: { value: new THREE.Vector2() },
        uRes: { value: new THREE.Vector2(1, 1) },
        uVeil: { value: 0 },
        uVeilColor: { value: new THREE.Color() },
        uHole: { value: 0 },
        uEdge: { value: 0 },
        uEmerge: { value: 0 },
        uSpeed: { value: 0 },
        uFlash: { value: 0 },
        uTunnel: { value: 0 },
        uSpiral: { value: 0 },
        uSpiralDir: { value: 1 },
        uTunnelP: { value: 0 },
        uTunnelPhase: { value: 0 },
        uTunA: { value: new THREE.Color() },
        uTunB: { value: new THREE.Color() },
        uFlashColor: { value: new THREE.Color() },
        uHoleC: { value: new THREE.Vector2(0.5, 0.5) },
        uRing: { value: new THREE.Color() },
        uMedHere: { value: new THREE.Vector4() },
        uOneness: { value: 0 },
        uLawHere: { value: new THREE.Vector4() },
        uLawBeyond: { value: new THREE.Vector4() },
        uPointer: { value: new THREE.Vector2(0.5, 0.55) },
        uStillG: { value: 0 },
        uFall: { value: 0 },
        uDim: { value: 0.62 },
        uTravel: { value: 0 },
        // the mandala's tricks: it changes its number of folds now and then, crossfading (folds to, 0..1)
        uFoldTo: { value: 6 },
        uFoldMix: { value: 0 },
        uShape: { value: 0 },
        uShapeTo: { value: 0 },
        uShapeBeyond: { value: 0 },
        // how the mandala moves right now (eased between kinds, never switched): flow position,
        // pulse, bloom, vortex … and the sweep offset of its chamber
        uMotion: { value: new THREE.Vector4() },
        uSweep: { value: new THREE.Vector2() },
        // the rings' turning, integrated time × the motion's spin (0 for motions that don't turn)
        uTurn: { value: 0 },
        uHereGlow: { value: new THREE.Color() },
        tEcho: { value: null },
        uMedBeyond: { value: new THREE.Vector4() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tPortal;
        uniform float uPortal;
        uniform float uTime, uOpen, uAspect, uVeil, uHole, uEdge, uEmerge, uSpeed, uFlash;
        uniform vec3 uFlashColor, uTunA, uTunB;
        uniform float uTunnel, uTunnelP, uTunnelPhase, uSpiral, uSpiralDir;
        uniform vec3 uVeilColor, uRing;
        uniform vec2 uView, uRes, uHoleC;
        uniform vec4 uMedHere, uMedBeyond;
        uniform float uOneness;
        uniform vec4 uLawHere, uLawBeyond;
        uniform vec2 uPointer;
        uniform float uStillG, uFall, uDim, uTravel, uFoldTo, uFoldMix, uShape, uShapeTo, uShapeBeyond;
        uniform vec4 uMotion;
        uniform vec2 uSweep;
        uniform float uTurn;
        uniform vec3 uHereGlow;
        // the centre the current law turns around (set before each law is applied)
        vec2 gCtr = vec2(0.5);
        // the kaleidoscope's chamber: in a pattern realm, the part of the world it mirrors drifts
        // all the time, so the pattern inside the petals keeps re-forming (set in main)
        vec2 gDrift = vec2(0.0);
        uniform sampler2D tEcho;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        // rotate a colour's hue (around the grey axis)
        vec3 hueShift(vec3 c, float a) {
          const vec3 k = vec3(0.57735);
          float ca = cos(a);
          return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }

        // the wormhole: a tunnel of light rings and wall-streaks rushing past, from the
        // colour you left (A) to the colour you're entering (B), with the exit glowing ahead
        vec3 wormhole(vec2 p2, float prog, float phase) {
          float rr = length(p2) + 1e-3;
          float a = atan(p2.y, p2.x);
          float z = 0.32 / rr;                 // depth into the tunnel: centre = far away
          float zz = z + phase;
          vec2 around = vec2(cos(a), sin(a));
          float rings = pow(0.5 + 0.5 * sin(zz * 7.5), 8.0);
          float streak = smoothstep(0.5, 0.95, noise(around * 6.0 + vec2(0.0, zz * 1.6)));
          float fine = noise(around * 18.0 + vec2(zz * 4.0, 0.0));
          float twist = 0.6 + 0.4 * sin(a * 3.0 + zz * 1.3);
          // colour runs from A near you to B deep ahead, and the whole tunnel shifts to B as you go
          float k = clamp(prog * 1.3 + (z - 0.6) * 0.12, 0.0, 1.0);
          vec3 tint = mix(uTunA, uTunB, k);
          float far = smoothstep(0.0, 0.3, rr);   // the far end dims into distance…
          vec3 wall = tint * (0.18 + 1.3 * rings + 1.4 * streak * (0.6 + 0.4 * fine)) * twist * far;
          // …except the exit, a light ahead that grows as you near it
          float exitR = mix(0.03, 0.4, prog * prog);
          wall += mix(uTunB, vec3(1.0), 0.45) * smoothstep(exitR, 0.0, rr) * (0.5 + 1.8 * prog);
          return wall;
        }

        // the medium a world is made of, bending what you see through it (see MEDIA)
        vec2 mediumOffset(vec2 ca, vec4 m) {
          vec2 o = vec2(0.0);
          if (m.x > 0.0) {
            // water: broad swells rolling through, each bending the next
            vec2 p = ca * 3.0;
            float t = uTime * 0.55;
            o += vec2(
              sin(p.y * 2.3 + t + sin(p.x * 1.7 - t * 0.8) * 1.4),
              cos(p.x * 2.0 - t * 0.9 + sin(p.y * 1.5 + t * 0.6) * 1.4)
            ) * 0.0065 * m.x;
          }
          if (m.y > 0.0) {
            // heat: fine ripples climbing, strongest low in the frame where the fire is
            vec2 p = vec2(ca.x * 10.0, ca.y * 7.0 - uTime * 0.9);
            o += (vec2(noise(p), noise(p + 9.1)) - 0.5) * 0.006 * m.y * (0.45 + smoothstep(0.4, -0.5, ca.y));
          }
          if (m.w > 0.0) {
            // gas: slow curls, drifting
            vec2 p = ca * 1.6 + vec2(uTime * 0.03, 0.0);
            float a = noise(p) * 6.2831 + uTime * 0.12;
            o += vec2(cos(a), sin(a)) * 0.004 * m.w;
          }
          return o;
        }
        // light from a rippling surface above, netted across everything below it
        float caustic(vec2 ca) {
          vec2 p = ca * 7.0 + uView * 0.6;
          float t = uTime * 0.7;
          float a = sin(p.x * 1.3 + sin(p.y * 1.1 + t) * 1.6 + t * 0.6);
          float b = sin(p.y * 1.5 + sin(p.x * 0.9 - t * 0.8) * 1.6 - t * 0.5);
          float net = pow(1.0 - abs(a * b), 6.0);
          return net * smoothstep(-0.6, 0.5, ca.y); // brighter toward the surface
        }

        vec3 rgbSplit(sampler2D t, vec2 uv, vec2 dir) {
          return vec3(texture2D(t, uv + dir).r, texture2D(t, uv).g, texture2D(t, uv - dir).b);
        }
        float lawHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        // the mandala: the world folded around the centre of the glass into mirrored petals,
        // turning, its arms wound into spirals (m = folds, spin, twist; fewer than 2 folds: none)
        vec2 mandala(vec2 uv, vec3 m, vec2 ctr) {
          if (m.x < 1.5) return uv;
          vec2 p = (uv - ctr) * vec2(uAspect, 1.0);
          float r = length(p);
          float a = atan(p.y, p.x) + uTurn * m.y + r * m.z; // it turns only as the motion turns
          float seg = 6.2831853 / m.x;
          a = mod(a, seg);
          a = abs(a - seg * 0.5);
          return ctr + vec2(cos(a), sin(a)) * r / vec2(uAspect, 1.0);
        }
        // the black hole in a reality's own colours: its law tints the light around it
        vec3 lawTint(vec3 c, float k) {
          if (k > 4.5 && k < 5.5) return hueShift(c, 3.14159);
          if (k > 10.5 && k < 11.5) {
            float l = 1.0 - exp(-dot(c, vec3(0.299, 0.587, 0.114)) * 1.6);
            return vec3(smoothstep(0.1, 0.45, l), smoothstep(0.4, 0.75, l), smoothstep(0.7, 1.0, l)) * 1.4 + vec3(0.05, 0.02, 0.18) * (1.0 - l);
          }
          return c;
        }
        // where a reality's law looks for what is at this point of the glass
        vec2 lawUv(vec2 uv, float k) {
          if (k > 4.5 && k < 5.5) return vec2(uv.x, 1.0 - uv.y); // the other side: up is down
          if (k > 6.5 && k < 7.5) {
            // breath: the world swells from the centre and settles, with a slight sway
            vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
            float b = sin(uTime * 0.628);
            p *= 1.0 - 0.07 * b * (1.0 - min(length(p), 1.0));
            float a = 0.025 * sin(uTime * 0.31);
            p = vec2(cos(a) * p.x - sin(a) * p.y, sin(a) * p.x + cos(a) * p.y);
            return 0.5 + p / vec2(uAspect, 1.0);
          }
          if (k > 7.5 && k < 8.5) {
            // liquid: everything bent by slow water
            float t = uTime * 0.6;
            return uv + vec2(sin(uv.y * 13.0 + t + sin(uv.x * 9.0 + t * 0.7) * 1.3), cos(uv.x * 11.0 - t * 0.8 + sin(uv.y * 7.0 - t) * 1.3)) * 0.009;
          }
          if (k > 8.5 && k < 9.5) {
            // strata: layers sliding against each other
            float band = floor(uv.y * 14.0);
            return uv + vec2((lawHash(vec2(band, 3.0)) - 0.5) * 0.07 * sin(uTime * 0.15 + band * 1.7), 0.0);
          }
          if (k > 9.5 && k < 10.5) {
            // recursion: each ring of the view holds the whole view again, drifting inward
            vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
            float r = max(length(p), 1e-4);
            float L = 0.85;
            float lr = mod(log(r) + uTime * 0.035, L) - L + log(0.62);
            return 0.5 + (p / r) * exp(lr) / vec2(uAspect, 1.0);
          }
          if (k > 11.5) {
            // mosaic: each cell takes the colour at its seed
            vec2 cs = uRes / 34.0;
            vec2 g = uv * cs;
            vec2 id = floor(g);
            vec2 best = vec2(0.0);
            float d1 = 9.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 c = id + vec2(float(i), float(j));
              vec2 pnt = c + 0.5 + 0.4 * sin(vec2(lawHash(c), lawHash(c + 3.3)) * 6.28 + uTime * 0.15);
              float d = length(g - pnt);
              if (d < d1) { d1 = d; best = pnt; }
            }
            return best / cs;
          }
          if (k > 5.5 && k < 6.5) {
            // particles: each dot carries the colour at its own centre
            vec2 cell = uRes / 7.0;
            return (floor(uv * cell) + 0.5) / cell;
          }
          return uv;
        }
        // and how it shows what it finds there
        vec3 lawColor(vec3 col, vec2 su, vec2 uv, float k, sampler2D t) {
          if (k > 0.5 && k < 1.5) {
            // attention: it exists where you look; stillness widens what you can hold
            vec2 d = (vUv - uPointer) * vec2(uAspect, 1.0);
            float rad = 0.2 + 0.2 * uStillG;
            float m = smoothstep(rad, rad * 0.2, length(d));
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            return mix(vec3(l) * 0.12, col * 1.15, m);
          }
          if (k > 3.5 && k < 4.5) {
            // edges: only boundaries, drawn in their own colour
            vec2 px = 1.5 / uRes;
            vec3 e = abs(texture2D(t, su + vec2(px.x, 0.0)).rgb - texture2D(t, su - vec2(px.x, 0.0)).rgb)
                   + abs(texture2D(t, su + vec2(0.0, px.y)).rgb - texture2D(t, su - vec2(0.0, px.y)).rgb);
            float m = clamp(dot(e, vec3(0.333)) * 7.0, 0.0, 1.0);
            vec3 tint = col / max(max(col.r, max(col.g, col.b)), 0.04);
            return tint * m * 1.3 + col * 0.05;
          }
          if (k > 4.5 && k < 5.5) {
            // the other side: light is dark, every colour its complement
            return hueShift(exp(-col * 2.2) * 0.8, 3.14159);
          }
          if (k > 7.5 && k < 8.5) {
            vec2 ca2 = (vUv - 0.5) * vec2(uAspect, 1.0);
            return col * (1.0 + caustic(ca2) * 0.55);
          }
          if (k > 8.5 && k < 9.5) {
            // a faint seam between layers
            return col * (0.82 + 0.18 * smoothstep(0.0, 0.1, fract(uv.y * 14.0)));
          }
          if (k > 10.5 && k < 11.5) {
            // heat: dark is cold blue, warmth climbs through red and gold to white
            float l = 1.0 - exp(-dot(col, vec3(0.299, 0.587, 0.114)) * 1.6);
            vec3 h = vec3(0.05, 0.02, 0.18) * (1.0 - l);
            h += vec3(smoothstep(0.15, 0.5, l), smoothstep(0.45, 0.8, l), smoothstep(0.75, 1.0, l)) * 1.3;
            return h;
          }
          if (k > 11.5) {
            // mosaic: dark leading between the cells
            vec2 cs = uRes / 34.0;
            vec2 g = uv * cs;
            vec2 id = floor(g);
            float d1 = 9.0, d2 = 9.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 c = id + vec2(float(i), float(j));
              vec2 pnt = c + 0.5 + 0.4 * sin(vec2(lawHash(c), lawHash(c + 3.3)) * 6.28 + uTime * 0.15);
              float d = length(g - pnt);
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
            }
            return col * 1.15 * smoothstep(0.02, 0.1, d2 - d1);
          }
          if (k > 5.5 && k < 6.5) {
            // particles: a dot per cell, as large as its light; restless when you move, settled when still
            vec2 cell = uRes / 7.0;
            vec2 id = floor(uv * cell);
            vec2 f = fract(uv * cell) - 0.5;
            vec2 jit = (vec2(lawHash(id), lawHash(id + 7.1)) - 0.5) * (1.0 - uStillG) * 0.6 * (0.6 + 0.4 * sin(uTime * 2.0 + lawHash(id) * 6.28));
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            float r = 0.12 + 0.42 * sqrt(clamp(l, 0.0, 1.0));
            float m = smoothstep(r, r - 0.12, length(f - jit));
            return col * m * 1.9;
          }
          return col;
        }
        vec3 sampleLaw(sampler2D t, vec2 uv, vec2 dir, vec4 law, vec2 ctr) {
          gCtr = ctr;
          vec2 mu = mandala(uv, law.yzw, ctr);
          if (law.y > 1.5) mu += gDrift;
          vec2 su = lawUv(mu, law.x);
          return lawColor(rgbSplit(t, su, dir), su, mu, law.x, t);
        }

        vec2 rot2(vec2 p, float a) { float c = cos(a), sn = sin(a); return vec2(c * p.x - sn * p.y, sn * p.x + c * p.y); }

        // one sample of the realm through its mandala fold (or, for the tilings, unfolded: the tiling
        // is their fold)
        vec3 realmAt(sampler2D t, bool echo, vec2 suv, vec2 dir, vec4 law, vec2 ctr) {
          return echo ? rgbSplit(t, mandala(suv, law.yzw, ctr) + gDrift, dir) : sampleLaw(t, suv, dir, law, ctr);
        }

        // A pattern realm's mandala. Seven structures, each moving in its own way:
        // 0 well      ring within ring, receding to the black hole at its eye; travelling carries you down
        // 1 bloom     the well, its petals swelling and shrinking in waves around the circle
        // 2 vortex    the well wound into a spiral that tightens and loosens, flowing inward
        // 3 inversion the pattern turning itself inside out (circle inversion) and back again
        // 4 crystal   the classic three-mirror kaleidoscope: a lattice of mirrored triangles, turning, zooming
        // 5 lattice   square mirror tiles, an endless carpet, rotating and zooming
        // 6 twins     two mandalas orbiting each other, turning opposite ways, merging where they meet
        // Drawn the same way for the realm you're in and for the realm seen through the hole, so
        // arriving changes nothing.
        vec3 realmView(sampler2D t, bool echo, vec2 uv, vec2 dir, vec4 law, vec2 ctr, vec3 tint, float shape) {
          vec2 asp = vec2(uAspect, 1.0);
          vec2 p = (uv - ctr) * asp;
          float rr = max(length(p), 1e-4);
          // flat structures: darker toward the eye, so they still fall away into depth
          float sink = mix(0.5, 1.0, smoothstep(0.0, 0.55, rr));
          if (shape > 2.5 && shape < 3.5) {
            // inversion: breathing between the pattern and its inside-out
            float k = 0.5 + 0.5 * sin(uTime * 0.12 + uTravel * 0.04);
            vec2 q = mix(p, p * (0.09 / (rr * rr)), k);
            q = rot2(q, uTime * law.z * 2.0);
            return realmAt(t, echo, ctr + q / asp, dir, law, ctr) * mix(sink, 1.0, 0.4);
          }
          if (shape > 3.5 && shape < 4.5) {
            // crystal: fold the plane into one equilateral triangle by mirrors (a hexagonal kaleidoscope)
            float cell = 0.2 * (1.0 + 0.35 * sin(uTime * 0.09 + uTravel * 0.05));
            vec2 q = rot2(p, uTime * law.z) / cell;
            vec2 h = vec2(q.x - q.y * 0.57735, q.y * 1.1547);
            vec2 fr = fract(h);
            if (fr.x + fr.y > 1.0) fr = 1.0 - fr;
            vec2 tq = vec2(fr.x + fr.y * 0.5, fr.y * 0.8660254) - vec2(0.5, 0.2887);
            vec2 suv = ctr + gDrift + rot2(tq, uTime * 0.03) * cell * 1.8 / asp;
            vec3 c = echo ? rgbSplit(t, suv, dir) : sampleLaw(t, suv, dir, vec4(law.x, 0.0, 0.0, 0.0), ctr);
            return c * sink;
          }
          if (shape > 4.5 && shape < 5.5) {
            // lattice: square mirror tiles, mirrored again across the diagonal
            float cell = 0.24 * (1.0 + 0.35 * sin(uTime * 0.08 + uTravel * 0.05));
            vec2 q = rot2(p, uTime * law.z * 0.7) / cell;
            vec2 fr = abs(fract(q * 0.5) * 2.0 - 1.0);
            if (fr.y > fr.x) fr = fr.yx;
            vec2 suv = ctr + gDrift + rot2(fr - 0.5, -uTime * 0.02) * cell * 1.6 / asp;
            vec3 c = echo ? rgbSplit(t, suv, dir) : sampleLaw(t, suv, dir, vec4(law.x, 0.0, 0.0, 0.0), ctr);
            return c * sink;
          }
          if (shape > 5.5) {
            // twins: two mandalas circling each other, turning opposite ways
            float oa = uTime * 0.05 + uTravel * 0.02;
            vec2 o = vec2(cos(oa), sin(oa)) * 0.2;
            float d1 = length(p - o), d2 = length(p + o);
            float w1 = smoothstep(-0.08, 0.08, d2 - d1);
            vec3 m1 = realmAt(t, echo, uv, dir, law, ctr + o / asp);
            vec3 m2 = realmAt(t, echo, uv, dir, vec4(law.x, law.y + 2.0, -law.z, law.w), ctr - o / asp);
            return mix(m2, m1, w1) * mix(0.7, 1.0, smoothstep(0.0, 0.2, min(d1, d2)));
          }
          // the well, moving as the realm moves (uMotion: flow position, pulse, bloom, vortex)
          // bloom: petals swelling and shrinking in waves around the circle
          float bloomA = uMotion.z + (shape > 0.5 && shape < 1.5 ? 0.22 : 0.0);
          if (bloomA > 0.001) {
            float a0 = atan(p.y, p.x);
            p *= 1.0 + bloomA * sin(law.y * a0 + uTime * 0.9) * (0.5 + 0.5 * sin(uTime * 0.31));
          }
          float r = max(length(p), 1e-4);
          float L = log(2.2);                                  // each ring 2.2× deeper than the last
          // flow: dive (outward to you), sink (inward), or a pulse breathing in and out
          float flow = uMotion.x + uTravel * 0.03 + uMotion.y * sin(uTime * 0.55);
          float dd = -log(r / 0.95) / L + flow;                // ring coordinate: 0 at the rim, growing inward
          float kk = floor(dd);
          float fr = fract(dd);
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          for (int j = 0; j < 2; j++) {
            float layer = kk - float(j);                       // this ring, and the one just outside it
            float depthL = max(layer - flow + 1.0, 0.0);       // how far down the well it lies
            float scl = exp((layer - flow) * L);
            float alt = mod(layer, 2.0) < 0.5 ? 1.0 : -1.0;
            float rot = layer * 0.7 + uTurn * law.z * (2.0 / (1.0 + depthL * 0.6)) + alt * (uTurn * 0.02 + uTravel * 0.06);
            // vortex: wound into a spiral that tightens and loosens
            // vortex: wound into a spiral that tightens and loosens
            float vort = uMotion.w + (shape > 1.5 ? 1.6 : 0.0);
            if (vort > 0.001) rot += log(r) * vort * (1.0 + 0.6 * sin(uTime * 0.17));
            vec2 q = rot2(p * scl, rot);
            q += uView * vec2(0.05, 0.035) / (1.0 + depthL);   // parallax: deep rings barely move
            vec2 suv = ctr + q / asp;
            vec4 lawL = vec4(law.xyz, law.w + 0.9 * sin(uTime * 0.06 + layer * 1.7));
            vec3 cL = realmAt(t, echo, suv, dir, lawL, ctr);
            // aerial perspective: deeper rings dim and melt toward the realm's glow
            cL = mix(cL, tint * 0.35, 1.0 - exp(-depthL * 0.28)) * exp(-depthL * 0.22);
            float w = j == 0 ? smoothstep(0.0, 0.22, fr) : 1.0 - smoothstep(0.0, 0.22, fr);
            acc += cL * w;
            wsum += w;
          }
          return acc / max(wsum, 1e-4);
        }

        void main() {
          // a pattern realm turns around its black hole, near or far — the hole is its eye. (The
          // hole's place is a point a fixed distance ahead, moved only by your lean, so it carries
          // straight on through the crossing: centring on it never jumps.)
          // the chamber drift is the same for every view of a realm (here, or seen through the hole)
          gDrift = vec2(sin(uTime * 0.05), cos(uTime * 0.041)) * 0.06 + vec2(sin(uTime * 0.13), sin(uTime * 0.11 + 1.3)) * 0.025;
          // a sweep: the pattern sliding in from the sides, or from above and below
          gDrift += uSweep;
          vec2 cMain = uHoleC;
          vec2 cPortal = uHoleC;
          vec3 ringC = lawTint(uRing, uLawHere.x);
          float fH = uLawHere.y;
          vec2 c = vUv - 0.5;
          vec2 ca = c * vec2(uAspect, 1.0);
          float r = length(ca) / length(vec2(uAspect, 1.0) * 0.5); // 0 centre → 1 corner
          float closed = 1.0 - uOpen;

          // glass imperfection: very low-frequency ripple, slightly stronger at the rim,
          // much stronger while the surface is still "opening"
          vec2 q = ca * 2.2 + vec2(uTime * 0.012, -uTime * 0.009);
          vec2 wob = vec2(noise(q), noise(q + 17.3)) - 0.5;
          float amp = 0.0016 * (0.35 + r * r) + closed * closed * 0.02;
          vec2 uvGlass = vUv + wob * amp;
          vec2 uv = uvGlass + mediumOffset(ca, uMedHere);
          // the same glass (ripple + edge dispersion) for the world seen through the hole,
          // so nothing shifts when it becomes the world you're in — with that world's own medium
          vec2 medBeyond = mediumOffset(ca, uMedBeyond);
          vec2 dirGlass = c * r * 0.0035;

          // the black hole: where it sits, how big its horizon has grown
          vec2 hc = (vUv - uHoleC) * vec2(uAspect, 1.0);
          float hr = length(hc);
          // stays small for most of the approach, then rushes up to fill the view
          // at full strength the horizon reaches past the corners of the frame
          float rs = 0.0045 + 1.2 * pow(uHole, 3.2); // far away: a small black dot
          // at the very end the edge must sweep past the farthest corner of the frame before
          // you cross — wherever the hole sits (it's off-centre, and moves as you lean) —
          // so nothing of it is left to vanish at once
          vec2 farCorner = vec2(max(uHoleC.x, 1.0 - uHoleC.x) * uAspect, max(uHoleC.y, 1.0 - uHoleC.y));
          rs = mix(rs, max(rs, length(farCorner) * 1.08), smoothstep(0.82, 0.96, uHole));
          // the glass and the medium ride along with the lensing, so nothing jumps when the hole appears
          vec2 pre = uv - vUv;
          if (uHole > 0.001) {
            // space spirals in: a twist that tightens toward the horizon
            float twist = uHole * (1.0 * rs / max(hr, 1e-3) * (1.0 - uEdge) + uEdge * 0.6 * hr);
            float cs = cos(twist), sn = sin(twist);
            vec2 rd = vec2(cs * hc.x - sn * hc.y, sn * hc.x + cs * hc.y);
            // lensing: light from behind is bent around the rim
            float lens = 1.5 + 0.18 * sin(uTime * 1.1) + 0.1 * sin(uTime * 2.7 + hr * 20.0);
            rd *= mix(1.0 + lens * rs * rs / max(hr * hr, 1e-4), 1.0 + 0.5 * uHole, uEdge);
            uv = uHoleC + rd / vec2(uAspect, 1.0) + pre;
          }
          // falling in: the last of the world rushes toward the hole
          float pushIn = pow(uHole, 5.0) * (1.0 - uEdge);
          uv = uHoleC + (uv - uHoleC) * (1.0 - 0.4 * pushIn);
          // spiral: the whole view wound into (or unwound out of) a single point
          float spiralMask = 1.0;
          if (uSpiral > 0.001) {
            vec2 sc = (uv - 0.5) * vec2(uAspect, 1.0);
            float sr = length(sc);
            float shrink = 1.0 - uSpiral * 0.985;                       // down to a point
            float ang = uSpiralDir * uSpiral * (2.2 + 2.6 / (sr + 0.2)); // whirlpool: tighter near the centre
            float cs = cos(ang), sn = sin(ang);
            sc = vec2(cs * sc.x - sn * sc.y, sn * sc.x + cs * sc.y) / shrink;
            uv = 0.5 + sc / vec2(uAspect, 1.0);
            // past the edge of the shrinking image there is only the dark it's draining into
            float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
            spiralMask = smoothstep(0.5, 0.38, edge);
          }
          // thrown out: the new world starts magnified and rushes outward into place
          uv = 0.5 + (uv - 0.5) * (1.0 - 0.55 * uEmerge * uEmerge);

          // the trip: a brief psychedelic surge on the way through — strongest as you burst
          // out the far side, gone within a second; a hint of it as the hole closes over you
          float trip = max(uEmerge * uEmerge * uEmerge, pushIn * 0.35);
          if (trip > 0.001) {
            // concentric ripples running outward
            float rip = sin(r * 38.0 - uTime * 14.0);
            uv += normalize(c + 1e-5) * rip * 0.009 * trip;
          }

          // dispersion: a whisper at the edges normally, colour-split during the trip
          vec2 dir = c * r * (0.0035 + 0.045 * trip);
          vec3 col;
          // the world you're in, seen under its own law (echo: through what it remembers)
          // (home: the world as it is; a pattern realm draws its well below instead)
          if (uLawHere.x < 0.5) col = sampleLaw(tScene, uv, dir, uLawHere, cMain);
          // a pattern realm: the mandala as a well of itself (see realmWell)
          if (uLawHere.x > 0.5) {
            bool echoH = abs(uLawHere.x - 2.0) < 0.5;
            if (echoH) col = realmView(tEcho, true, uv, dir, uLawHere, cMain, uHereGlow, uShape);
            else col = realmView(tScene, false, uv, dir, uLawHere, cMain, uHereGlow, uShape);
            // a trick under way: the new fold count spreads out from the eye as a soft ring, so it is
            // always one mandala transforming — never two laid over each other
            if (uFoldMix > 0.001) {
              float reach = uFoldMix * 1.35;
              float rd = length((vUv - cMain) * vec2(uAspect, 1.0));
              float inside = 1.0 - smoothstep(reach - 0.06, reach, rd);
              if (inside > 0.001) {
                vec4 lawT = vec4(uLawHere.x, uFoldTo, uLawHere.zw);
                vec3 cT = echoH ? realmView(tEcho, true, uv, dir, lawT, cMain, uHereGlow, uShapeTo) : realmView(tScene, false, uv, dir, lawT, cMain, uHereGlow, uShapeTo);
                col = mix(col, cT, inside);
              }
            }
          }
          col *= 1.0 + caustic(ca) * 0.35 * uMedHere.z;

          // the veil between worlds: a radial speed-streak dissolving into luminous fog
          // speed of the fall shows as a streak toward the hole
          // colours cycling in rings
          if (trip > 0.001) col = mix(col, hueShift(col, (r * 7.0 - uTime * 5.0) * 1.2), trip * 0.85);

          float streak = max(max(uVeil, uSpeed), max(pushIn, uEmerge));
          if (streak > 0.001) {
            // every sample seen under this reality's law, so falling in never shows the plain world
            vec3 acc = col;
            bool echoing = abs(uLawHere.x - 2.0) < 0.5;
            for (int i = 1; i < 7; i++) {
              float k = float(i) / 7.0;
              vec2 su = mix(uv, uHoleC, k * 0.1 * streak);
              acc += echoing ? texture2D(tEcho, mandala(su, uLawHere.yzw, cMain)).rgb : sampleLaw(tScene, su, vec2(0.0), uLawHere, cMain);
            }
            // and the blur fades in with the fall instead of switching on
            col = mix(col, acc / 7.0, smoothstep(0.0, 0.05, streak));
          }
          if (uVeil > 0.001) {
            float v = uVeil * uVeil * (3.0 - 2.0 * uVeil);
            col = mix(col, uVeilColor * (1.0 - r * 0.45), v * 0.94);
          }
          // thrown out of a white hole: a white-hot burst, brightest at the centre, then the
          // world rushing outward with warp streaks (the streak above, driven by uEmerge)
          if (uSpiral > 0.001) {
            // what surrounds the swirl: darkness with a faint trace of the hole's light circling it
            float a2 = atan(ca.y, ca.x);
            float swirlGlow = 0.5 + 0.5 * sin(a2 * 3.0 - length(ca) * 9.0 * uSpiralDir + uTime * 2.0 * uSpiralDir);
            vec3 around = uRing * 0.12 * swirlGlow * uSpiral * smoothstep(1.2, 0.0, length(ca));
            col = col * spiralMask + around * (1.0 - spiralMask);
          }
          if (uTunnel > 0.001) {
            vec3 tun = wormhole(ca, uTunnelP, uTunnelPhase);
            // leaving: the walls thin away, centre first, through streaky gaps
            float gone = smoothstep(0.55, 1.0, uTunnelP);
            float rr = length(ca);
            float n = noise(vec2(atan(ca.y, ca.x) * 2.5, rr * 6.0 - uTunnelPhase * 0.5)) * 0.55 + rr * 0.6;
            // solid until it starts thinning (both thresholds below 0 while gone = 0)
            float keep = smoothstep(gone * 1.4 - 0.2, gone * 1.4 - 0.05, n);
            col = mix(col, tun, uTunnel * keep);
          }
          if (uEmerge > 0.001) {
            // the exit of the hole: an opening dead ahead, the new zone seen through it.
            // it grows faster and faster as you rush at it, until it's wider than the frame
            float p = 1.0 - uEmerge;
            vec2 ec = (vUv - 0.5) * vec2(uAspect, 1.0);
            float er = length(ec);
            float ap = 0.01 + 1.75 * pow(p, 2.2);
            float inside = smoothstep(ap, ap * 0.9, er);
            // its rim: light that skimmed the horizon, swirling, in the new zone's colour
            float ang = atan(ec.y, ec.x);
            float rimW = ap * 0.07 + 0.003;
            float rim = exp(-pow((er - ap) / rimW, 2.0));
            float swirl = 0.55 + 0.45 * sin(ang * 6.0 + uTime * 5.0 - er * 25.0);
            // outside the opening it's still the inside of the hole: dark, with light dragged outward
            // irregular streaks, not spokes: noise around the circle, stretched outward
            vec2 around = vec2(cos(ang), sin(ang));
            float drag = smoothstep(0.62, 0.95, noise(around * 9.0 + vec2(uTime * 0.6, -er * 1.5))) * smoothstep(ap, ap * 2.5 + 0.1, er);
            col = col * inside
              + uFlashColor * rim * swirl * 1.4
              + uFlashColor * drag * 0.05 * uEmerge * (1.0 - inside);
          }
          // the first instant: a white-hot point where the opening is born
          if (uFlash > 0.001) col += uFlashColor * uFlash * 1.5 * exp(-r * r / 0.02);

          if (uHole > 0.001) {
            // A black hole as it would actually look: a small dark shadow inside a much
            // larger lit structure. A thin disk of hot matter orbits it, seen nearly
            // edge-on; its near side crosses in front of the shadow, while gravity bends
            // the light of its far side up over the top (and a sliver under the bottom).
            float show = smoothstep(0.0, 0.12, uHole) * (1.0 - uEdge);
            // home has a black hole; every reality beyond it opens in its own mandala's form
            // the black hole is home's everywhere; in the pattern realms its light takes their colours
            bool inRealm = uLawHere.x > 0.5;
            bool mandalaGate = false;
            bool spiralGate = abs(uLawHere.x - 13.0) < 0.5;
            fH = max(fH, spiralGate ? 5.0 : 6.0);
            float th = atan(hc.y, hc.x);
            vec3 glowN = uHereGlow / max(max(uHereGlow.r, max(uHereGlow.g, uHereGlow.b)), 0.01);
            vec3 holeTone = inRealm ? mix(ringC, glowN * max(max(ringC.r, max(ringC.g, ringC.b)), 0.2), 0.45) : uRing;
            // odd laws open in soft petals, even laws in sharp star points
            bool starry = mod(uLawHere.x, 2.0) < 0.5;
            // the gate turns with its mandala — and quicker the nearer you come
            float turn = uTime * uLawHere.z * 3.0 * (1.0 + 2.5 * uHole);
            float twistG = uLawHere.w;

            // where the opening's edge is, at this angle: the mandala's own flower (its folds, its
            // twist), breathing, opening wider as you near — and relaxing into a clean circle just
            // before you cross (so it still sweeps past every corner)
            float edgeR = rs;
            if (mandalaGate) {
              float bloom = 0.22 + 0.16 * smoothstep(0.1, 0.6, uHole);
              float amp = bloom * (0.85 + 0.15 * sin(uTime * 0.628)) * (1.0 - smoothstep(0.72, 0.92, uHole));
              float ang = th + turn + twistG * log(max(hr / max(rs, 1e-4), 0.05));
              float pc = abs(cos(ang * fH * 0.5));
              float petal = starry ? pow(pc, 8.0) : pc * pc;
              edgeR = rs * (1.0 - amp + amp * 1.6 * petal);
            }

            // inside the opening: the next world, already there — lens-curved while far,
            // exactly undistorted by the time it fills the frame, so crossing changes nothing
            float insideH = 1.0 - smoothstep(edgeR * 0.98, edgeR * 1.02, hr);
            vec3 beyond = vec3(0.0);
            if (uPortal > 0.5) {
              // the lens curve is gone well before the crossing, not still fading at it
              float fk = 1.0 - smoothstep(0.55, 0.9, uHole);
              float sc = mix(1.0, 0.6 + 0.4 * clamp(hr / max(edgeR, 1e-4), 0.0, 1.0), fk);
              vec2 puv = uHoleC + (uvGlass - uHoleC) * sc + medBeyond;
              beyond = uLawBeyond.x > 0.5 ? realmView(tPortal, false, puv, dirGlass, uLawBeyond, cPortal, uRing, uShapeBeyond) : sampleLaw(tPortal, puv, dirGlass, uLawBeyond, cPortal);
              beyond *= 1.0 + caustic(ca) * 0.35 * uMedBeyond.z;
            }
            col = mix(col, beyond, insideH * (1.0 - uEdge));
            // everything lit sits outside the opening — inside, only the world beyond
            float outside = smoothstep(edgeR * 0.98, edgeR * 1.02, hr);

            if (mandalaGate) {
              // around it: rings streaming out of the gate without end — each the mandala's flower
              // (its folds, its twist), beaded with light, born bright at the edge and fading as it
              // widens, so you seem to fly down a tunnel of them; quicker as you near
              float fade = 1.0 - smoothstep(0.3, 0.75, rs);
              float speed = 0.07 + 0.25 * uHole;
              vec3 orn = vec3(0.0);
              for (int i = 0; i < 6; i++) {
                float fi = float(i);
                float ph = fract(fi / 6.0 + uTime * speed);
                float dirn = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
                float ang = th + turn * (1.0 + fi * 0.3) * dirn + twistG * ph * 2.0;
                float pcs = abs(cos(ang * fH * 0.5));
                float shape = 1.0 + 0.16 * (starry ? pow(pcs, 8.0) : pcs * pcs);
                float R = rs * (1.08 + 3.2 * pow(ph, 1.5)) * shape;
                // a nautilus streams out in golden-spiral arcs instead of closed rings
                if (spiralGate) R *= pow(1.618, fract(ang / 6.2831853 + fi * 0.25) * 1.2);
                float w = (rs * 0.014 + 0.0006) * (1.0 + 2.0 * ph);
                float lr = (hr - R) / w;
                float line = exp(-lr * lr);
                // beads: fH × (ring + 1) points of light riding each ring
                float nb = fH * (1.0 + mod(fi, 3.0));
                float bf = (fract(ang / 6.2831853 * nb) - 0.5) * 6.2831853 / nb * hr / (w * 2.4);
                float br = (hr - R * 1.06) / (w * 2.2);
                float bead = exp(-bf * bf - br * br);
                float life = smoothstep(0.0, 0.08, ph) * (1.0 - ph);
                orn += (ringC * line * 0.9 + mix(ringC, vec3(1.0), 0.5) * bead * 1.2) * life;
              }
              float er = (hr - edgeR) / (rs * 0.03 + 0.0008);
              float rim = exp(-er * er) * (0.85 + 0.15 * sin(uTime * 0.628));
              vec3 halo = mix(ringC, vec3(1.0), 0.4) * 0.07 * exp(-(hr - edgeR) / (rs * 3.0 + 0.002));
              col += (orn * fade + ringC * rim * 1.3 + halo) * show * outside;
            } else {
              // HOME — a black hole as it would actually look: a small dark shadow inside a much
              // larger lit structure. A thin disk of hot matter orbits it, seen nearly edge-on; its
              // near side crosses in front of the shadow, while gravity bends the light of its far
              // side up over the top (and a sliver under the bottom).
              float roll = -0.18 + 0.06 * sin(uTime * 0.13);
              vec2 qd = vec2(cos(roll) * hc.x - sin(roll) * hc.y, sin(roll) * hc.x + cos(roll) * hc.y);
              float tilt = 0.17 + 0.035 * sin(uTime * 0.09); // how open the disk looks; it slowly precesses
              float dr = length(vec2(qd.x, qd.y / tilt)); // radius within the disk's own plane
              float inner = rs * 1.5, outer = rs * 5.0;
              float diskBand = smoothstep(inner * 0.92, inner * 1.08, dr) * smoothstep(outer, outer * 0.55, dr);
              // brighter toward the inside, white-hot at the inner edge, cooling into the next zone's colour
              float heat = pow(inner / max(dr, inner), 1.6);
              vec3 hot = mix(holeTone, vec3(1.0, 0.94, 0.84), smoothstep(0.55, 1.0, heat) * 0.8);
              // orbiting streaks, and the approaching side (left) beamed brighter
              float orbit = atan(qd.y / tilt, qd.x);
              // inner matter orbits faster than outer (Kepler), so the disk shears into flowing streaks
              float spin = orbit + uTime * 1.6 * pow(inner / max(dr, inner), 1.5);
              vec2 around = vec2(cos(spin), sin(spin));
              float turb = noise(around * 2.5 + dr / max(rs, 0.01) * 0.9) * 0.6 + noise(around * 6.0 - dr / max(rs, 0.01) * 1.7 + uTime * 0.2) * 0.4;
              float clumps = smoothstep(0.62, 0.9, noise(around * 4.0 + vec2(dr / max(rs, 0.01) * 1.3, uTime * 0.15)));
              float streaks = 0.35 + 0.9 * turb + 0.8 * clumps;
              float beaming = 1.0 + 0.75 * (-qd.x / max(dr, 1e-4));
              vec3 disk = hot * heat * streaks * beaming * diskBand * 1.6;
              // the far side of the disk, lensed into an arc hugging the shadow — thick on top, thin below
              float above = smoothstep(-0.2, 0.7, qd.y / max(hr, 1e-4));
              float arcW = rs * mix(0.12, 0.32, above);
              float ad = (hr - rs * 1.22) / arcW;
              float arc = exp(-ad * ad) * mix(0.35, 1.0, above);
              vec3 lensedArc = hot * arc * (0.7 + 0.3 * beaming) * (0.75 + 0.5 * turb) * 1.2;
              // as you fall in the disk sweeps past you; only the shadow and its ring remain
              float diskFade = 1.0 - smoothstep(0.22, 0.6, rs);
              disk *= diskFade;
              lensedArc *= diskFade;
              // the photon ring: light that has circled the hole, razor-thin at the shadow's edge
              float pd = (hr - rs * 1.03) / (rs * 0.035 + 0.0008);
              float photon = exp(-pd * pd) * (0.8 + 0.2 * sin(uTime * 2.3 + th * 2.0));
              col += (lensedArc + holeTone * photon * 1.3 + mix(holeTone, vec3(1.0), 0.4) * 0.06 * exp(-(hr - rs) / (rs * 3.0 + 0.002))) * show * outside;
              float nearSide = smoothstep(0.02, -0.02, qd.y);   // the half of the disk between you and the hole
              // the near side of the disk shades what is behind it — and fades out with the disk,
              // instead of leaving a dark band over the world beyond until the crossing
              col = mix(col, col * 0.15 + disk, nearSide * diskBand * show * 0.9 * diskFade);
              col += disk * (1.0 - nearSide) * 0.35 * show;      // far half, seen past the shadow's sides
            }
          }
          if (uHole > 0.001 && uEdge > 0.001) {
            // backwards: the dark closes in from every edge, the world shrinking to a lit circle
            float ri = (1.0 - pow(uHole, 1.4)) * 1.15;
            float ang = atan(hc.y, hc.x);
            float swirl = 0.5 + 0.5 * sin(ang * 5.0 + uTime * 1.6 - hr * 12.0);
            float rim = exp(-pow((hr - ri * 0.93) / (0.025 + ri * 0.05), 2.0));
            vec3 behindEdge = uPortal > 0.5
              ? sampleLaw(tPortal, uvGlass + medBeyond, dirGlass, uLawBeyond, cPortal) * (1.0 + caustic(ca) * 0.35 * uMedBeyond.z)
              : vec3(0.0);
            vec3 edged = mix(behindEdge, col, smoothstep(ri, ri * 0.9, hr)) + ringC * rim * (0.35 + 0.65 * swirl) * 1.1 * smoothstep(0.0, 0.12, uHole);
            col = mix(col, edged, uEdge);
          }

          // opening: an iris of light growing from the centre, plus global exposure
          float edge = uOpen * 1.7;
          float iris = smoothstep(edge, edge - 0.75, r);
          col *= iris * smoothstep(0.0, 1.0, uOpen);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>

          vec3 outc = gl_FragColor.rgb;

          // reflection on the glass: a broad, nearly invisible diagonal sheen that
          // slides *against* the world when you lean — sells the surface
          float s = (ca.x + ca.y * 0.55) - uView.x * 0.22 + uView.y * 0.08;
          float sheen = smoothstep(0.35, 0.0, abs(s - 0.18)) * 0.012 + smoothstep(0.12, 0.0, abs(s + 0.42)) * 0.006;
          outc += vec3(0.75, 0.78, 0.95) * sheen * uOpen * (1.0 - uOneness);

          // edge darkening (like looking through a thick pane)
          float vig = smoothstep(1.15, 0.35, r);
          // ...unless the boundaries have dissolved: then there is no pane, no edge
          outc *= mix(mix(0.25, 1.0, vig), 1.0, uOneness);

          // grain
          float g = hash(vUv * uRes + fract(uTime * 7.13) * 91.0) - 0.5;
          outc += g * 0.022 * (1.0 - uOneness);

          gl_FragColor = vec4(max(outc, 0.0), 1.0);
        }`,
    })
    const quadScene = new THREE.Scene()
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    quad.frustumCulled = false
    quadScene.add(quad)
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    return { quadScene, quadCam, mat }
  }, [])

  useEffect(() => {
    mat.uniforms.uAspect.value = size.width / size.height
    mat.uniforms.uRes.value.set(size.width, size.height)
  }, [size, mat])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const p = THREE.MathUtils.clamp((t - OPEN_DELAY) / OPEN_DURATION, 0, 1)
    view.open = p * p * (3 - 2 * p) // smoothstep ease

    mat.uniforms.uTime.value = t
    mat.uniforms.uOneness.value = view.oneness
    mat.uniforms.uOpen.value = view.open
    mat.uniforms.uView.value.set(view.x, view.y)
    mat.uniforms.tScene.value = fbo.texture
    mat.uniforms.uVeil.value = view.veil
    mat.uniforms.uVeilColor.value.copy(light.horizon).multiplyScalar(2.2).add(glowTmp.copy(light.glow).multiplyScalar(0.05))
    // a colour change is crossed in darkness: the veil becomes the inside of the hole
    if (view.holeBoundary) mat.uniforms.uVeilColor.value.copy(black)
    mat.uniforms.uHole.value = view.hole
    ringColorFor(view.across, mat.uniforms.uRing.value)
    // the hole hangs far beyond everything; leaning shifts it a little, like any distant thing
    holePoint.set(0, 0.8, camera.position.z - 140).project(camera)
    // edges mode closes around the middle of the frame
    mat.uniforms.uHoleC.value.set(
      THREE.MathUtils.lerp(holePoint.x * 0.5 + 0.5, 0.5, view.holeBehind),
      THREE.MathUtils.lerp(holePoint.y * 0.5 + 0.5, 0.5, view.holeBehind),
    )
    mat.uniforms.uEdge.value = view.holeBehind
    mat.uniforms.uEmerge.value = view.emerge
    // (no speed streak in portal mode: it would differ between the two worlds at the crossing)
    mat.uniforms.uSpeed.value = TRANSITION === 'portal' ? 0 : THREE.MathUtils.clamp((Math.abs(view.speed) - 1.5) / 12, 0, 0.45)
    mat.uniforms.uFlash.value = view.flash
    mat.uniforms.uTunnel.value = view.tunnel
    mat.uniforms.uSpiral.value = view.spiral
    mat.uniforms.uSpiralDir.value = view.spiralDir
    mat.uniforms.uTunnelP.value = view.tunnelP
    mat.uniforms.uTunnelPhase.value = view.tunnelPhase
    ringColorFor(view.tunnelFrom, mat.uniforms.uTunA.value)
    ringColorFor(view.tunnelTo, mat.uniforms.uTunB.value)
    mat.uniforms.uFlashColor.value.copy(light.glow).lerp(white, 0.55).multiplyScalar(2.4)

    // the world you're in
    const here = worlds.get(view.zoneStart)
    mediumFor(here?.formName, mat.uniforms.uMedHere.value)
    lawFor(here, mat.uniforms.uLawHere.value)
    mat.uniforms.uPointer.value.set(view.px, view.py)
    mat.uniforms.uStillG.value = view.still
    mat.uniforms.uDim.value = here?.reality?.dim ?? 0.62
    mat.uniforms.uTravel.value = view.depth
    ;(mat.uniforms.uHereGlow.value as THREE.Color).copy(light.glow)
    // the mandala's tricks: every 10–16 s it changes how it moves, or flowers into a new number of folds
    {
      const T = tricks.current
      const lawU = mat.uniforms.uLawHere.value as THREE.Vector4
      const rl = here?.reality
      if (T.zone !== view.zoneStart) {
        // the very first realm starts already in its own motion (later ones ease into theirs)
        if (Number.isNaN(T.zone) && rl) Object.assign(motion.current, MOTIONS[rl.motion] ?? MOTIONS[0])
        // a new realm starts from its own folds
        T.zone = view.zoneStart
        T.folds = rl?.folds ?? 0
        T.to = T.folds
        T.shape = rl?.shape ?? 0
        T.shapeTo = T.shape
        T.motion = rl?.motion ?? 0
        T.mix = 0
        T.next = t + 10 + Math.random() * 6
      }
      if (rl) {
        if (T.mix === 0 && t >= T.next) {
          // the trick: every other time it changes how it moves; otherwise it flowers into a new fold count
          if (T.n++ % 2 === 1) {
            T.motion = (T.motion + 1 + Math.floor(Math.random() * (MOTION_COUNT - 1))) % MOTION_COUNT
            T.next = t + 10 + Math.random() * 6
          } else {
            let to = 3 + Math.floor(Math.random() * 12)
            if (Math.abs(to - T.folds) < 2) to = to + 4 > 14 ? to - 4 : to + 4
            T.to = to
            T.shapeTo = T.shape
            T.mix = 0.0001
          }
        }
        if (T.mix > 0) {
          T.mix = Math.min(1, T.mix + Math.min(delta, 0.05) / 4)
          if (T.mix >= 1) {
            T.folds = T.to
            T.shape = T.shapeTo
            T.mix = 0
            T.next = t + 10 + Math.random() * 6
          }
        }
        lawU.y = T.folds
        mat.uniforms.uFoldTo.value = T.to
        mat.uniforms.uShape.value = T.shape
        mat.uniforms.uShapeTo.value = T.shapeTo
        mat.uniforms.uFoldMix.value = T.mix * T.mix * (3 - 2 * T.mix)
      } else mat.uniforms.uFoldMix.value = 0

      // motion: every quantity eases toward the current kind's preset over a few seconds, and the
      // flow and sweep are integrated, so changing kind (or realm) never jumps
      const M = motion.current
      const P = MOTIONS[T.motion] ?? MOTIONS[0]
      const d = Math.min(delta, 0.05)
      const k = 1 - Math.exp(-d / 1.6)
      M.speed += (P.speed - M.speed) * k
      M.pulse += (P.pulse - M.pulse) * k
      M.bloom += (P.bloom - M.bloom) * k
      M.vortex += (P.vortex - M.vortex) * k
      M.sx += (P.sx - M.sx) * k
      M.sy += (P.sy - M.sy) * k
      M.spin += (P.spin - M.spin) * k
      // the turning is integrated too, so easing its speed never jumps the pattern
      M.turn += M.spin * d
      M.flow += M.speed * d
      M.phase += d * 0.16
      ;(mat.uniforms.uMotion.value as THREE.Vector4).set(M.flow, M.pulse, M.bloom, M.vortex)
      ;(mat.uniforms.uSweep.value as THREE.Vector2).set(Math.sin(M.phase) * M.sx, Math.sin(M.phase * 0.83 + 1.1) * M.sy)
      mat.uniforms.uTurn.value = M.turn
    }
    // falling into a spiral: slowly by itself, and deeper with every unit you travel
    mat.uniforms.uFall.value = t * 0.035 + view.depth * 0.05
    gl.setRenderTarget(fbo)
    if (here) gl.render(here.scene, here.camera)
    else gl.render(scene, camera)
    // and, once the hole is big enough to matter, the world beyond it
    const beyond = TRANSITION === 'portal' ? worlds.get(zoneOf(view.across).start) : undefined
    const showBeyond = !!beyond && view.hole > 0.12
    mediumFor(beyond?.formName, mat.uniforms.uMedBeyond.value)
    lawFor(beyond, mat.uniforms.uLawBeyond.value)
    mat.uniforms.uShapeBeyond.value = beyond?.reality?.shape ?? 0
    if (beyond && showBeyond) {
      // only the patch of screen the hole covers is ever seen of the world beyond, so only
      // that patch is drawn: a distant speck costs almost nothing, the full frame only at the end
      const c = mat.uniforms.uHoleC.value as THREE.Vector2
      const aspect = mat.uniforms.uAspect.value as number
      const h = view.hole
      let rs = 0.0045 + 1.2 * Math.pow(h, 3.2)
      const corner = Math.hypot(Math.max(c.x, 1 - c.x) * aspect, Math.max(c.y, 1 - c.y))
      rs += (Math.max(rs, corner * 1.08) - rs) * THREE.MathUtils.smoothstep(h, 0.82, 0.96)
      const edgeMode = view.holeBehind > 0.01
      if (!edgeMode && rs * 1.15 < corner) {
        const W = portalFbo.width, H = portalFbo.height
        const rx = (rs * 1.15) / aspect, ry = rs * 1.15
        const x0 = THREE.MathUtils.clamp(c.x - rx, 0, 1), x1 = THREE.MathUtils.clamp(c.x + rx, 0, 1)
        const y0 = THREE.MathUtils.clamp(c.y - ry, 0, 1), y1 = THREE.MathUtils.clamp(c.y + ry, 0, 1)
        portalFbo.scissor.set(Math.floor(x0 * W), Math.floor(y0 * H), Math.ceil((x1 - x0) * W) + 2, Math.ceil((y1 - y0) * H) + 2)
        portalFbo.scissorTest = true
      } else {
        portalFbo.scissorTest = false
      }
      gl.setRenderTarget(portalFbo)
      gl.render(beyond.scene, beyond.camera)
    }
    // echo: fold this frame into the memory (starting fresh on arrival)
    if (mat.uniforms.uLawHere.value.x === 2) {
      const src = echo.read ? echoB : echoA
      const dst = echo.read ? echoA : echoB
      echo.m.uniforms.tNew.value = fbo.texture
      echo.m.uniforms.tOld.value = src.texture
      echo.m.uniforms.uKeep.value = echo.active ? 0.9 : 0
      gl.setRenderTarget(dst)
      gl.render(echo.scene, quadCam)
      echo.read = 1 - echo.read
      echo.active = true
      mat.uniforms.tEcho.value = dst.texture
    } else echo.active = false
    mat.uniforms.tPortal.value = portalFbo.texture
    mat.uniforms.uPortal.value = showBeyond ? 1 : 0
    gl.setRenderTarget(null)
    gl.render(quadScene, quadCam)

    // dev-only: CPU work per frame (camera update → final render), to catch stalls
    if (import.meta.env.DEV) {
      ;(window as unknown as { __glassU: typeof mat.uniforms }).__glassU = mat.uniforms
      const win = window as unknown as { __frameStart: number; __frames?: string[] }
      const ms = performance.now() - win.__frameStart
      const log = (win.__frames ??= [])
      log.push(`${t.toFixed(2)} z${view.zoneStart} h${view.hole.toFixed(2)} ${ms.toFixed(1)}ms`)
      if (log.length > 2000) log.shift()
    }
  }, 1)

  return null
}
