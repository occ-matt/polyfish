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

## Dev server

```
npm run dev
```

Requires HTTPS for WebXR testing (`@vitejs/plugin-basic-ssl` handles this).
