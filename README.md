# Beyond the Glass

A window you look through, not a page you look at. Live at
[beyond.edgarasneverdauskas.com](https://beyond.edgarasneverdauskas.com).

Home is a floating world behind the glass: islands, crystals and drifting pieces that
change while you watch, in the light of your own time of day and tonight's real moon. Lean
(move the mouse or tilt by touch) and the window parallax shows what lies behind the edges.

Scroll, or let it drift, and a black hole pulls you on: it grows from a dot in the distance
until it swallows the view, and you come out the other side into the world waiting inside it.
For now that world is home again; what lies beyond the black hole is being reimagined.

## Controls

- **Mouse / touch:** lean into the window.
- **Scroll / swipe:** travel; the black holes pull a little on their own.
- **drift** (bottom right) or **space:** fly on by itself. While drifting, the slider or the
  ↑ / ↓ keys set the pace.
- **Tap:** things react.

## Addresses

- `?v=1a2b3c4d`: a particular journey (any 8 hex characters). Without it, every visit is new.
- `?at=3`: start a few black holes further in (any step number).

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
