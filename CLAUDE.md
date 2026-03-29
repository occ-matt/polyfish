# PolyFish Remastered

Underwater ecosystem simulation built with Three.js and WebXR. Supports desktop, mobile, and VR (Quest).

## Versioning

This project uses **semantic versioning** (semver): `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking changes, full rewrites, or milestone releases (e.g. 1.0 → 2.0)
- **MINOR** — new features, new modes, significant UX changes (e.g. 1.0 → 1.1)
- **PATCH** — bug fixes, tuning, small polish (e.g. 1.0.0 → 1.0.1)

### When to bump

| Change type | Bump | Example |
|---|---|---|
| New creature type, new game mode | MINOR | 1.0.0 → 1.1.0 |
| New credits entry, new sound effect | PATCH | 1.0.0 → 1.0.1 |
| VR interaction fix, mobile bug fix | PATCH | 1.0.0 → 1.0.1 |
| Physics engine rewrite, renderer swap | MAJOR | 1.0.0 → 2.0.0 |
| Config tuning (speeds, scales, colors) | PATCH | 1.0.0 → 1.0.1 |

### Where to update

Version lives in two places — keep them in sync:

1. **`package.json`** → `"version"` field
2. **`src/rendering/VRDebugPanel.js`** → `VR_BUILD_VERSION` constant (displayed in VR debug overlay and title screen footer)

Format: package.json uses `"1.0.0"`, VR_BUILD_VERSION uses `"v1.0.0"` (prefixed with v).

## Architecture

- **Rendering**: Three.js with instanced meshes for food/seeds/creatures (1 draw call per type)
- **Physics**: Jolt (via SharedArrayBuffer worker) for creature/food collisions, simple PhysicsBody for distant food (LOD)
- **XR**: WebXR with smooth locomotion (left stick), smooth turn (right stick), trigger-based feeding
- **Food in VR**: Lerp-based hold (not scene-graph parented) for weighted feel, instanced mesh rendering
- **End credits**: DOM-based for all platforms; VR exits session first, then plays DOM credits on flat screen

## VR food holding & throwing

VR food uses a **lerp-based hold** (not scene-graph parenting). This is important context for anyone touching `main.js` VR food code or `XRManager._updateFeeding()`.

### Hold mechanics

- Food mesh stays in the scene (never parented to the controller grip group)
- Each frame, the grip's world position + `VR_FOOD_GRIP_OFFSET` is computed as the target
- `grip.updateWorldMatrix(true, false)` must be called first — the grip's `matrixWorld` is stale during the animation callback (Three.js updates it during `renderer.render()`, which runs after)
- Food mesh position/quaternion lerp toward the target with `1 - Math.exp(-20 * dt)` for a weighted feel
- Physics body is synced from the mesh position
- The first 2 frames after spawn skip lerp (grip matrixWorld needs one render pass to be valid); frame 2 snaps to position, frame 3+ lerps
- Since food is NOT parented to the grip, it must go through the **instanced mesh** rendering path in `SimulationSystem.js` (the `if (food.held) return` early-exit was removed)

### Throw mechanics

- On trigger release, `XRManager._updateFeeding()` reads `grip.linearVelocity` from the XR API
- **Critical**: this velocity is in XR reference-space coordinates, NOT world space. Smooth turn rotates the Three.js rig (not the XR reference space), so `baseVelocity.applyQuaternion(this.rig.quaternion)` is required for correct throw direction
- Velocity is scaled by 0.4× (raw XR velocity is too hot for underwater)
- A `floatUp` value (0.4) is added to Y for gentle upward drift
- Angular velocity from the controller is also read and rotated by rig quaternion, then applied as `food.spinX`/`spinZ` so the food continues the hand's rotation on release
- `food.release()` is called but its default random spin (±12 rad/s) is overridden with the controller's angular velocity for continuity

### Why not scene-graph parenting?

The previous approach parented `food.mesh` to the grip group. This worked for positioning but had issues: no weighted/laggy feel (instant tracking), and since individual food meshes are never added to the scene (rendering uses a shared `InstancedMesh`), the only way it worked was that parenting to the grip made Three.js render the mesh as part of the grip subtree. Switching to lerp-in-scene + instanced mesh rendering solved both the feel and the rendering architecture.

## Dev server

```
npm run dev
```

Requires HTTPS for WebXR testing (`@vitejs/plugin-basic-ssl` handles this).
