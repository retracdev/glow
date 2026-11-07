# Glow

An interactive 3D light playground by [retrac.space](https://retrac.space), built for `glow.retrac.space`. Steer glowing neon tubes, weave them into braids, drop black holes on them, blow them up. It runs entirely in the browser with no backend.

## Run it

```sh
npm install
npm run dev       # development server
npm run build     # typecheck and production build, output in dist/
npm run preview   # serve the production build
```

Needs a browser with WebGL 2.

## Controls

| Control | Mouse | Touch | Key |
| --- | --- | --- | --- |
| Steer the tubes | Move | Drag with the Steer tool, several fingers split the tubes | `1` |
| Draw a braid | Drag | Drag with the Draw tool | |
| Black hole | Click to place, click one to remove, drag to move | Same, with taps | `B` |
| Explosion | Click | Tap | `E` |
| Mirror | Toolbar: left and right, top and bottom, or both | Same | `M` cycles |
| Freeze time | Toolbar | Toolbar | `F` or `Space` |
| Chaos | Toolbar | Toolbar | `X` |
| Clear canvas | Toolbar | Toolbar | `C` |

Colors, glow, tube count, speed, trail length, background and reduced effects are in the settings panel. Reduced effects starts on when the system asks for reduced motion.

## How it works

Rendering is separate from the UI: `src/ui` is React, `src/engine` is plain TypeScript and Three.js, and React only talks to `GlowEngine` through its small public API. Nothing in the frame loop touches React.

- **Tubes** (`FreeTubes.ts`, `TubeMesh.ts`). Each head chases an anchor on an underdamped spring and drops samples behind it. Samples keep some momentum and drift through a divergence-free flow, so trails bend and curl by themselves. Control points go into a float texture, and one instanced mesh builds every tube in the vertex shader with Catmull-Rom interpolation and parallel-transported frames.
- **Strokes** (`Strokes.ts`). Dragging lays down a braid of three strands that use the same texture and mesh. They spring back to where they were drawn after being disturbed.
- **Black holes** (`BlackHoles.ts`, `LensEffect.ts`, `ForceField.ts`). Gravity and swirl act on every tube point. The visual is a screen-space lens pass that runs before bloom, so warped light still glows, plus an accretion disk mesh that the lens bends into a halo.
- **Explosions** (`Particles.ts`). Sparks move analytically in the vertex shader, so the CPU only touches a particle when it spawns. Bursts also kick nearby tube points and send out a lens shockwave.
- **Mirror**. The whole scene is redrawn reflected, including holes and bursts, and each force is applied for every reflection. That keeps the symmetry exact.
- **Post-processing**. HDR buffer, mipmap bloom, tone mapping, vignette and dithering, using [postprocessing](https://github.com/pmndrs/postprocessing).
- **Performance**. No allocations per point in the simulation, lower geometry and particle budgets on small devices, and render resolution steps down automatically if a device can't keep up.

The look was inspired by Kevin Levron's Tubes Cursor component. This is an independent implementation and shares no code with it.

## License

MIT
