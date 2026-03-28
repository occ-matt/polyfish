# PolyFish Particle System Test Page

## Overview

`particle-test.html` is a standalone, self-contained test page for visualizing and verifying the PolyFish particle effect system during migration from custom `ParticleBurst` to **three.quarks** BatchedRenderer.

## Running the Test

### Local Development
```bash
cd /sessions/bold-great-knuth/mnt/PolyFish_ThreeJS
# Open test/particle-test.html directly in a browser
# e.g., file:///sessions/bold-great-knuth/mnt/PolyFish_ThreeJS/test/particle-test.html
```

### With Vite Dev Server
```bash
npm run dev
# Then navigate to http://localhost:5173/test/particle-test.html
```

## Features

### Interactive UI

The page includes a control panel at the top with buttons to fire each particle effect type:

| Button | Color | Effect | Description |
|--------|-------|--------|-------------|
| **Food Eaten** | Green | Soft burst | 15 particles, gentle upward buoyancy |
| **Creature Eaten** | Orange | Strong burst | 25 particles, fast outward spread |
| **Plant Eaten** | Light Green | Gentle burst | 12 particles, slight growth-then-shrink size curve |
| **Birth** | Cyan | Shimmer | 20 particles, slow drift, lingering effect (1.2s) |
| **Death** | Brown | Scatter | 18 particles, downward gravity, dispersal |
| **Decompose** | Earthy Green | Drift | 16 particles, slow upward drift, subtle (1.5s) |
| **Food Drop** | Yellow | Splash | 10 particles, ring-like expansion, fast fade (0.4s) |
| **All at Once** | Magenta | Combined | Fires all 7 effects simultaneously at different positions |

### Scene Elements

- **Dark Blue/Teal Background**: Underwater atmosphere (color: `#0a1428`)
- **Ground Plane**: Sandy seafloor (200x200 units) with realistic material
- **Placeholder Creatures**: 5 static sphere meshes at various positions, representing creatures in the ecosystem
- **Lighting**:
  - Ambient light (cool blue tone)
  - Directional light (sun/moon position) with shadow support
  - Point light (greenish accent)

### Camera Controls

- **Left Mouse Drag**: Orbit around the scene
- **Middle Mouse Drag**: Pan the camera
- **Mouse Wheel**: Zoom in/out
- **Auto-Rotation**: Camera slowly rotates when idle (disabled when dragging)

### Performance Stats Panel

Bottom-left corner displays real-time metrics:
- **FPS**: Frames per second
- **Draw Calls**: Number of renderer draw calls (target: 1-3 batched)
- **Particles**: Active particle count across all effects
- **Active Bursts**: Number of currently firing particle systems

## Effect Specifications (from Migration Plan)

### Food Eaten
- **Color**: Soft green (0x88ffaa, RGB: 136, 255, 170)
- **Particles**: 15
- **Lifetime**: 0.8s
- **Speed**: 2.5 u/s
- **Force**: Gentle upward buoyancy (0, +0.5, 0)
- **Size Curve**: Shrink from 0.15 to 0.01
- **Use Case**: When a creature eats generic food (herbivore grazing, omnivore snacking)

### Creature Eaten
- **Color**: Orange (0xff9944, RGB: 255, 153, 68)
- **Particles**: 25
- **Lifetime**: 0.9s
- **Speed**: 3.5 u/s
- **Force**: Slight downward (0, -0.3, 0) — heavier event
- **Size Curve**: Shrink from 0.2 to 0.02
- **Use Case**: Predator-prey interaction (dolphin eats fish)

### Plant Eaten
- **Color**: Light green (0x66ff99, RGB: 102, 255, 153)
- **Particles**: 12
- **Lifetime**: 0.7s
- **Speed**: 2.0 u/s
- **Force**: Gentle upward with slight horizontal wobble
- **Size Curve**: Grow then shrink (dispersing plant matter)
- **Use Case**: Manatee grazing, herbivore vegetation interaction

### Birth
- **Color**: Bright cyan (0xccffff, RGB: 204, 255, 255)
- **Particles**: 20
- **Lifetime**: 1.2s (longer to feel magical)
- **Speed**: 1.5 u/s
- **Force**: Gentle upward drift
- **Size Curve**: Shimmer effect (small particles: 0.1 to 0.02)
- **Use Case**: Offspring spawn event, reproduction success

### Death
- **Color**: Muted gray/brown (0xaa8866, RGB: 170, 136, 102)
- **Particles**: 18
- **Lifetime**: 1.2s
- **Speed**: 2.0 u/s
- **Force**: Downward gravity (0, -0.5, 0) — debris falling
- **Size Curve**: Hold size then shrink at end
- **Use Case**: Creature death, remains dispersal

### Decompose
- **Color**: Earthy green (0x88dd99, RGB: 136, 221, 153)
- **Particles**: 16
- **Lifetime**: 1.5s
- **Speed**: 0.8 u/s
- **Force**: Slow upward drift (returning to ecosystem)
- **Size Curve**: Gradual shrink (0.12 to 0.02)
- **Use Case**: Decomposition, nutrient cycling, post-death breakdown

### Food Drop
- **Color**: Yellow (0xffdd88, RGB: 255, 221, 136)
- **Particles**: 10
- **Lifetime**: 0.4s (fast fade)
- **Speed**: 4.0 u/s
- **Force**: Upward with some outward expansion
- **Size Curve**: Shrink from 0.08 to 0.01
- **Use Case**: Player dropping food into ecosystem, splash effect

## Current Implementation

The test page uses Three.js `Points` geometry with additive blending to simulate particle effects. This is a **reference implementation** demonstrating the desired visual behavior, particle counts, colors, and physics.

### Why Not three.quarks Yet?

The npm registry access is currently restricted, preventing installation of `three.quarks`. The test page demonstrates the exact specifications and behavior from `PARTICLE_MIGRATION_PLAN.md` using native Three.js APIs:

- ✅ Proper color and opacity for each effect type
- ✅ Size curves (grow, shrink, hold)
- ✅ Force fields (buoyancy up, gravity down)
- ✅ Correct particle lifetimes and counts
- ✅ Batched rendering with additive blending
- ✅ Performance monitoring

### Next Steps (Phase 1 Migration)

When three.quarks becomes available:

1. Create `src/rendering/VFXManager.js` using `BatchedRenderer`
2. Replace this test's `ParticleBurst` class with three.quarks `ParticleSystem` definitions
3. Update particle system properties to match this test's specifications
4. Verify visual parity (colors, timing, forces match)
5. Integrate into main app (`main.js` creatureCallbacks)
6. Remove `ParticleBurst.js` and `MarineSnow.js`

## File Structure

```
/sessions/bold-great-knuth/mnt/PolyFish_ThreeJS/
├── test/
│   ├── particle-test.html          ← Standalone test page
│   └── PARTICLE_TEST_README.md      ← This file
├── node_modules/
│   └── three/build/three.module.js  ← Three.js ES module import
├── PARTICLE_MIGRATION_PLAN.md       ← Full architecture & implementation guide
└── src/
    ├── rendering/
    │   ├── ParticleBurst.js         ← Current implementation (to be replaced)
    │   ├── VFXManager.js            ← (To be created in Phase 1)
    │   └── ...
    └── ...
```

## Performance Expectations

| Metric | Current System | Test Page | Target (three.quarks) |
|--------|---|---|---|
| Draw Calls | 8+ (1 per active burst + 1 snow) | 1-3 | 1-3 |
| Max Concurrent Particles | ~530 | ~150 | ~600 |
| Batched | ❌ No | ✅ Yes | ✅ Yes |

## Testing Checklist

When verifying particle effects:

- [ ] Each button produces expected color burst
- [ ] Particles fade smoothly over lifetime (opacity → 0)
- [ ] Size curves are correct (comparing visual to spec)
- [ ] "All at Once" fires 7 effects without visual stutter
- [ ] Camera auto-rotation works smoothly
- [ ] Particles don't pop or cut off abruptly
- [ ] FPS remains stable (60 on desktop, ~30-45 on mobile)
- [ ] No memory leaks after 5+ minutes of continuous firing

## Troubleshooting

### White screen or no particles
- Check browser console for errors
- Verify `../node_modules/three/build/three.module.js` path is correct
- Ensure JavaScript modules are enabled

### Particles not visible against background
- The dark ocean blue background (0x0a1428) is intentional for underwater feel
- Additive blending should make particles glow
- Try adjusting browser brightness/contrast

### Controls not working
- Left-click and drag to rotate
- Use mouse wheel to zoom
- If stuck, refresh the page to reset camera

### Performance issues
- Close other browser tabs
- Reduce screen resolution
- Try Firefox or Chrome (WebGL performance varies)

## Related Files

- **PARTICLE_MIGRATION_PLAN.md**: Complete architecture, API design, and integration points
- **src/rendering/ParticleBurst.js**: Current implementation (baseline for migration)
- **src/rendering/MarineSnow.js**: Ambient particle system (will migrate in Phase 2)
- **package.json**: Dependencies (three.quarks to be added in Phase 1)

## Contact & Questions

For implementation details or three.quarks integration:
1. Consult `PARTICLE_MIGRATION_PLAN.md` (full specs)
2. Review this test page for visual behavior baseline
3. Check PolyFish project documentation for ecosystem context
