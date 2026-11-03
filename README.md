# TinyTorque REAL

**Build. Tune. Race. Repeat. In glorious 3D.**

TinyTorque REAL is a **separate** edition of [TinyTorque Classic](https://github.com/titomus/tiny-torque). The original repository remains untouched.

## Prototype REAL v0.1.0

- 4 distinctive RC racing cars with curved, beveled bodies, PBR car paint, transparent glazing, wheels, rims, wings, racing numbers and shadows
- A fully procedural backyard circuit with asphalt texture, gravel runoff, concrete paddocks, start gantry, 3D guardrails, tire stacks, cones, grass blades, rocks and hundreds of trees
- **Sun / night / rain** presets, real-time rain streaks, puddles, wet-road appearance and track floodlights
- **Cinema / TV / follow / overhead** camera modes
- Graphics controls **Eco / HD / Ultra**, pixel ratio scaling, reduced vegetation and shadows on Eco
- Original deterministic four-car physics: FWD/RWD/AWD, tuning, offroad grip, wall collisions, rollover and autonomous drivers
- Three-lap races, telemetry, personal bests, record challenges and X sharing
- **Isolated browser storage** (classic TinyTorque records are not affected)
- No backend, authentication, paid assets or third-party game model downloads

### Start playing

To serve locally:

~~~bash
python -m http.server 8000
~~~

Then open http://localhost:8000. Three.js is loaded from a CDN, so an Internet connection is needed.

Keys: **Space** start/pause, **R** reset, **1 to 4** select a car.

### Publishing on GitHub Pages

1. In **Settings → Pages**, select **GitHub Actions** as the build source.
2. Push to main: the workflow checks JavaScript, runs existing physics/track/records tests, then attempts Pages deployment.
3. **Important:** This repository is currently private. Pages for private repositories depends on your GitHub plan. If it is unavailable, you may need a public repository or alternative static hosting. Do not make the repo public without considering visibility.

### Architecture

- \`assets/app.js\`: simulation loop, UI, cameras, telemetry, challenge sharing
- \`assets/realism.mjs\`: original Three.js procedural 3D assets, weather and PBR materials
- \`assets/physics.mjs\`: deterministic bicycle-model RC dynamics
- \`assets/guardrails.mjs\`: fixed physical guardrails
- \`assets/records.mjs\`: personal records and shared links
- \`tests/*.test.mjs\`: Node regression tests
- \`.github/workflows/deploy.yml\`: CI and Pages deployment

### Reality check

This first iteration focuses on a **much more immersive rendering** without breaking proven gameplay. It is procedural art, **not yet photorealism**: high-end externally modeled cars, HDR lighting, contact shadows, modern reflection techniques, enhanced audio, track-specific physics calibration and an automated visual regression run are subsequent milestones.

The car physics still uses a simplified bicycle model rather than four independent wheel suspension constraints. The weather is **visual only** for now, so wet asphalt does not change grip.

No software re-use license has been chosen yet.
