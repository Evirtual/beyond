import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { view } from './state'
import { light, ringColorFor, TRANSITION, zoneOf } from './moment'
import { worlds } from './world'

const glowTmp = new THREE.Color()
const black = new THREE.Color(0, 0, 0)
const white = new THREE.Color(1, 1, 1)
const holePoint = new THREE.Vector3()
const OPEN_DELAY = 0.35
const OPEN_DURATION = 3.0

/**
 * Takes over rendering: draws the world into an offscreen target, then
 * composites it through the "glass" — faint refraction wobble, edge darkening,
 * a reflection sheen that moves against the world, grain, and the opening —
 * and the black hole, with the world beyond it already waiting inside.
 */
export function Glass() {
  const { gl, scene, camera, size } = useThree()
  // 2× smoothing, not 4×: most of the edge work for half the cost (laptops stay cooler)
  const fbo = useFBO({ samples: 2, type: THREE.HalfFloatType })
  // the world waiting inside the black hole
  const portalFbo = useFBO({ samples: 2, type: THREE.HalfFloatType })

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

        // a sample through the glass: the colours split a little at the edges
        vec3 rgbSplit(sampler2D t, vec2 uv, vec2 dir) {
          return vec3(texture2D(t, uv + dir).r, texture2D(t, uv).g, texture2D(t, uv - dir).b);
        }

        void main() {
          vec2 c = vUv - 0.5;
          vec2 ca = c * vec2(uAspect, 1.0);
          float r = length(ca) / length(vec2(uAspect, 1.0) * 0.5); // 0 centre → 1 corner
          float closed = 1.0 - uOpen;

          // glass imperfection: very low-frequency ripple, slightly stronger at the rim,
          // much stronger while the surface is still "opening"
          vec2 q = ca * 2.2 + vec2(uTime * 0.012, -uTime * 0.009);
          vec2 wob = vec2(noise(q), noise(q + 17.3)) - 0.5;
          float amp = 0.0016 * (0.35 + r * r) + closed * closed * 0.02;
          vec2 uv = vUv + wob * amp;
          // the same glass (ripple + edge dispersion) for the world seen through the hole,
          // so nothing shifts when it becomes the world you're in
          vec2 uvGlass = uv;
          vec2 dirGlass = c * r * 0.0035;

          // the black hole: where it sits, how big its horizon has grown
          vec2 hc = (vUv - uHoleC) * vec2(uAspect, 1.0);
          float hr = length(hc);
          // stays small for most of the approach, then rushes up to fill the view
          float rs = 0.0045 + 1.2 * pow(uHole, 3.2); // far away: a small black dot
          // at the very end the edge must sweep past the farthest corner of the frame before
          // you cross — wherever the hole sits (it's off-centre, and moves as you lean) —
          // so nothing of it is left to vanish at once
          vec2 farCorner = vec2(max(uHoleC.x, 1.0 - uHoleC.x) * uAspect, max(uHoleC.y, 1.0 - uHoleC.y));
          rs = mix(rs, max(rs, length(farCorner) * 1.08), smoothstep(0.82, 0.96, uHole));
          // the glass ripple rides along with the lensing, so nothing jumps when the hole appears
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
          vec3 col = rgbSplit(tScene, uv, dir);

          // colours cycling in rings during the trip
          if (trip > 0.001) col = mix(col, hueShift(col, (r * 7.0 - uTime * 5.0) * 1.2), trip * 0.85);

          // the speed of the fall shows as a streak toward the hole
          float streak = max(max(uVeil, uSpeed), max(pushIn, uEmerge));
          if (streak > 0.001) {
            vec3 acc = col;
            for (int i = 1; i < 7; i++) {
              float k = float(i) / 7.0;
              acc += texture2D(tScene, mix(uv, uHoleC, k * 0.1 * streak)).rgb;
            }
            // the blur fades in with the fall instead of switching on
            col = mix(col, acc / 7.0, smoothstep(0.0, 0.05, streak));
          }
          // the veil between worlds: a luminous fog
          if (uVeil > 0.001) {
            float v = uVeil * uVeil * (3.0 - 2.0 * uVeil);
            col = mix(col, uVeilColor * (1.0 - r * 0.45), v * 0.94);
          }
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
            float rd2 = (er - ap) / rimW;
            float rim = exp(-rd2 * rd2);
            float swirl = 0.55 + 0.45 * sin(ang * 6.0 + uTime * 5.0 - er * 25.0);
            // outside the opening it's still the inside of the hole: dark, with light dragged outward
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
            float th = atan(hc.y, hc.x);
            float roll = -0.18 + 0.06 * sin(uTime * 0.13);
            vec2 qd = vec2(cos(roll) * hc.x - sin(roll) * hc.y, sin(roll) * hc.x + cos(roll) * hc.y);
            float tilt = 0.17 + 0.035 * sin(uTime * 0.09); // how open the disk looks; it slowly precesses
            float dr = length(vec2(qd.x, qd.y / tilt)); // radius within the disk's own plane
            float inner = rs * 1.5, outer = rs * 5.0;
            float diskBand = smoothstep(inner * 0.92, inner * 1.08, dr) * smoothstep(outer, outer * 0.55, dr);
            // brighter toward the inside, white-hot at the inner edge, cooling into the next zone's colour
            float heat = pow(inner / max(dr, inner), 1.6);
            vec3 hot = mix(uRing, vec3(1.0, 0.94, 0.84), smoothstep(0.55, 1.0, heat) * 0.8);
            // orbiting streaks; inner matter orbits faster than outer (Kepler), shearing into flowing streaks
            float orbit = atan(qd.y / tilt, qd.x);
            float spin = orbit + uTime * 1.6 * pow(inner / max(dr, inner), 1.5);
            vec2 around = vec2(cos(spin), sin(spin));
            float turb = noise(around * 2.5 + dr / max(rs, 0.01) * 0.9) * 0.6 + noise(around * 6.0 - dr / max(rs, 0.01) * 1.7 + uTime * 0.2) * 0.4;
            float clumps = smoothstep(0.62, 0.9, noise(around * 4.0 + vec2(dr / max(rs, 0.01) * 1.3, uTime * 0.15)));
            float streaks = 0.35 + 0.9 * turb + 0.8 * clumps;
            // the approaching side (left) beamed brighter
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

            // shadow first (nothing comes back), then what lies beyond it, then the near disk in front.
            // Inside the shadow: the next world, already there — lens-curved while far, exactly
            // undistorted by the time it fills the frame, so crossing changes nothing
            float insideH = 1.0 - smoothstep(rs * 0.98, rs * 1.02, hr);
            vec3 beyond = vec3(0.0);
            if (uPortal > 0.5) {
              // the lens curve is gone well before the crossing, not still fading at it
              float fk = 1.0 - smoothstep(0.55, 0.9, uHole);
              float sc = mix(1.0, 0.6 + 0.4 * clamp(hr / max(rs, 1e-4), 0.0, 1.0), fk);
              vec2 puv = uHoleC + (uvGlass - uHoleC) * sc;
              beyond = rgbSplit(tPortal, puv, dirGlass);
            }
            col = mix(col, beyond, insideH * (1.0 - uEdge));
            // everything lit sits outside the horizon — inside, nothing
            float outside = smoothstep(rs * 0.98, rs * 1.02, hr);
            col += (lensedArc + uRing * photon * 1.3 + mix(uRing, vec3(1.0), 0.4) * 0.06 * exp(-(hr - rs) / (rs * 3.0 + 0.002))) * show * outside;
            float nearSide = smoothstep(0.02, -0.02, qd.y);   // the half of the disk between you and the hole
            // the near side of the disk shades what is behind it — and fades out with the disk,
            // instead of leaving a dark band over the world beyond until the crossing
            col = mix(col, col * 0.15 + disk, nearSide * diskBand * show * 0.9 * diskFade);
            col += disk * (1.0 - nearSide) * 0.35 * show;      // far half, seen past the shadow's sides
          }
          if (uHole > 0.001 && uEdge > 0.001) {
            // backwards: the dark closes in from every edge, the world shrinking to a lit circle
            float ri = (1.0 - pow(uHole, 1.4)) * 1.15;
            float ang = atan(hc.y, hc.x);
            float swirl = 0.5 + 0.5 * sin(ang * 5.0 + uTime * 1.6 - hr * 12.0);
            float rimD = (hr - ri * 0.93) / (0.025 + ri * 0.05);
            float rim = exp(-rimD * rimD);
            vec3 behindEdge = uPortal > 0.5 ? rgbSplit(tPortal, uvGlass, dirGlass) : vec3(0.0);
            vec3 edged = mix(behindEdge, col, smoothstep(ri, ri * 0.9, hr)) + uRing * rim * (0.35 + 0.65 * swirl) * 1.1 * smoothstep(0.0, 0.12, uHole);
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
          outc += vec3(0.75, 0.78, 0.95) * sheen * uOpen;

          // edge darkening (like looking through a thick pane)
          float vig = smoothstep(1.15, 0.35, r);
          outc *= mix(0.25, 1.0, vig);

          // grain
          float g = hash(vUv * uRes + fract(uTime * 7.13) * 91.0) - 0.5;
          outc += g * 0.022;

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

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const p = THREE.MathUtils.clamp((t - OPEN_DELAY) / OPEN_DURATION, 0, 1)
    view.open = p * p * (3 - 2 * p) // smoothstep ease

    mat.uniforms.uTime.value = t
    mat.uniforms.uOpen.value = view.open
    mat.uniforms.uView.value.set(view.x, view.y)
    mat.uniforms.tScene.value = fbo.texture
    mat.uniforms.uVeil.value = view.veil
    mat.uniforms.uVeilColor.value.copy(light.horizon).multiplyScalar(2.2).add(glowTmp.copy(light.glow).multiplyScalar(0.05))
    // a crossing is made in darkness: the veil becomes the inside of the hole
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

    // how far the hole has spread (the same sum as the shader's)
    const c = mat.uniforms.uHoleC.value as THREE.Vector2
    const aspect = mat.uniforms.uAspect.value as number
    const h = view.hole
    let rs = 0.0045 + 1.2 * Math.pow(h, 3.2)
    const corner = Math.hypot(Math.max(c.x, 1 - c.x) * aspect, Math.max(c.y, 1 - c.y))
    rs += (Math.max(rs, corner * 1.08) - rs) * THREE.MathUtils.smoothstep(h, 0.82, 0.96)
    const edgeMode = view.holeBehind > 0.01
    const beyond = TRANSITION === 'portal' ? worlds.get(zoneOf(view.across).start) : undefined
    const showBeyond = !!beyond && view.hole > 0.12
    // once the hole's shadow covers the whole frame, the world you're leaving can't be seen:
    // only the world beyond is drawn, so the last of the fall costs one world, not two
    const covered = showBeyond && !edgeMode && rs * 0.98 > corner + 0.02

    // the world you're in
    const here = worlds.get(view.zoneStart)
    if (!covered) {
      gl.setRenderTarget(fbo)
      if (here) gl.render(here.scene, here.camera)
      else gl.render(scene, camera)
    }
    // and, once the hole is big enough to matter, the world beyond it
    if (beyond && showBeyond) {
      // only the patch of screen the hole covers is ever seen of the world beyond, so only
      // that patch is drawn: a distant speck costs almost nothing, the full frame only at the end
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
