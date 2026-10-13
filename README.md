# Beyond the Glass

A window you look through, not a page you look at. Live at
[beyond.edgarasneverdauskas.com](https://beyond.edgarasneverdauskas.com).

Home is a floating world behind the glass: islands, crystals and drifting pieces that
change while you watch, in the light of your own time of day and tonight's real moon. Lean
(move the mouse or tilt by touch) and the window parallax shows what lies behind the edges.

Scroll, or let it drift, and a black hole pulls you on. Through it, the world becomes pattern:
a mandala folded from the same world, receding into depth toward the next black hole. Each
realm moves its own way (diving toward you, sinking away, sliding in from the sides or from
above, pulsing, blooming, spiralling, turning), changes how it moves as you watch, and now and
then flowers into a new number of folds. Every realm is generated fresh, with its own law of perception, palette and
name, and is kept clearly unlike the one before it. After six realms the journey comes home,
and starts again, never the same twice.

Stay still and it deepens. Stay still long enough and the edges of the glass dissolve.

## Controls

- **Mouse / touch:** lean into the window.
- **Scroll / swipe:** travel; the black holes pull a little on their own.
- **drift** (bottom right) or **space:** fly on by itself. While drifting, the slider or the
  ↑ / ↓ keys set the pace.
- **Tap:** things react.

## Addresses

- `?v=1a2b3c4d`: a particular journey (any 8 hex characters). Without it, every visit is new.
- `?at=1`: start in the first realm instead of home (any step number).
- `?reality=heat`: put one law in every realm, to preview it (`attention`, `echo`, `mirror`,
  `edges`, `opposite`, `particles`, `breath`, `liquid`, `strata`, `recursion`, `heat`,
  `mosaic`, `nautilus`).
- `?motion=sides`: give every realm one kind of motion (`dive`, `sink`, `sides`, `vertical`,
  `pulse`, `bloom`, `vortex`, `turn`).

## Running it

```bash
npm install
npm run dev
```

```bash
npm run build
```

Built with React, Vite, three.js and React Three Fiber. The frame rate is paced to what the
moment needs (fewer frames when you are still) and the resolution steps down if frames run
slow, so it stays gentle on laptops.

## Licence

[AGPL-3.0](LICENSE).
