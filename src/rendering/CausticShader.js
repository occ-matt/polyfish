/**
 * CausticShader — Procedural underwater caustics for PolyFish
 *
 * Adds animated light caustic patterns to any MeshStandardMaterial via onBeforeCompile.
 * Uses a dual-layer Voronoi noise pattern that mimics the light refraction through
 * a wavy water surface, projected downward onto surfaces.
 *
 * The effect is depth-dependent: strongest near the surface, fading with depth.
 * Two overlapping caustic layers at different scales and speeds create the
 * characteristic "swimming" light pattern seen in real underwater environments.
 *
 * Usage:
 *   import { applyCaustics, updateCausticTime } from './CausticShader.js';
 *
 *   // Patch a material (terrain, creature, etc.)
 *   const uniforms = applyCaustics(material);
 *
 *   // Each frame:
 *   updateCausticTime(elapsed);
 */

import { CONFIG } from '../config.js';

// ── Shared caustic uniform (single time source for all patched materials) ──
const _sharedUniforms = {
  uCausticTime: { value: 0 },
  uCausticIntensity: { value: 0.0 },       // will be set from config
  uCausticScale: { value: 0.0 },
  uCausticSpeed: { value: 0.0 },
  uSurfaceY: { value: CONFIG.surfaceY },
  uCausticFadeDepth: { value: 0.0 },       // will be set from config
  uCausticDistFade: { value: 0.0 },        // camera-distance fade start
  uCausticLOD: { value: 0.0 },              // per-material: 0.0 = full quality, 1.0 = simplified
};

let _configApplied = false;

function _ensureConfig() {
  if (_configApplied) return;
  const c = CONFIG.caustics || {};
  _sharedUniforms.uCausticIntensity.value = c.intensity ?? 0.35;
  _sharedUniforms.uCausticScale.value     = c.scale ?? 0.8;
  _sharedUniforms.uCausticSpeed.value     = c.speed ?? 0.4;
  _sharedUniforms.uCausticFadeDepth.value = c.fadeDepth ?? 20.0;
  _sharedUniforms.uCausticDistFade.value  = c.distanceFade ?? 25.0;
  _sharedUniforms.uSurfaceY.value         = CONFIG.surfaceY;
  _configApplied = true;
}

// ── GLSL: Fragment shader declarations (injected after #include <common>) ──
const CAUSTIC_FRAGMENT_PARS = /* glsl */ `
  varying vec3 vCausticWorldPos;
  varying vec3 vCausticWorldNormal;
  uniform float uCausticTime;
  uniform float uCausticIntensity;
  uniform float uCausticScale;
  uniform float uCausticSpeed;
  uniform float uSurfaceY;
  uniform float uCausticFadeDepth;
  uniform float uCausticDistFade;
  uniform float uCausticBoost;
  uniform float uCausticLOD;

  // Simple 2D hash for domain warping
  vec2 causticHash(vec2 p) {
    return vec2(
      fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
      fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
    );
  }

  // Smooth value noise for organic distortion of the Voronoi grid
  float causticValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep interpolation
    float a = dot(causticHash(i), vec2(1.0));
    float b = dot(causticHash(i + vec2(1.0, 0.0)), vec2(1.0));
    float c = dot(causticHash(i + vec2(0.0, 1.0)), vec2(1.0));
    float d = dot(causticHash(i + vec2(1.0, 1.0)), vec2(1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Voronoi-based caustic pattern using F2-F1 (second-nearest minus nearest).
  // Produces bright lines at cell BOUNDARIES — the characteristic underwater
  // caustic web/net pattern. Domain-warped for organic, flowing shapes.
  // LOD parameter: 0.0 = full quality (dual octave warp), >= 0.5 = simplified (single octave)
  float causticLayer(vec2 uv, float time, float lod) {
    // Domain warp: distort the UV coordinates with layered noise
    // so cells feel like natural light refracting through moving water,
    // not a tiled geometric grid.

    // First octave — large, slow-moving distortion (always applied)
    vec2 warp1 = vec2(
      causticValueNoise(uv * 0.6 + time * 0.12),
      causticValueNoise(uv * 0.6 + vec2(5.2, 1.3) + time * 0.10)
    );
    uv += (warp1 - 0.5) * 1.0;

    // Second octave — smaller, faster turbulence on top
    // Skip when LOD >= 0.5 (simplified mode) for reduced GPU cost
    if (lod < 0.5) {
      vec2 warp2 = vec2(
        causticValueNoise(uv * 1.4 + time * 0.22 + vec2(8.1, 3.7)),
        causticValueNoise(uv * 1.4 + vec2(2.9, 7.4) + time * 0.18)
      );
      uv += (warp2 - 0.5) * 0.4;
    }

    vec2 p = fract(uv) - 0.5;
    vec2 id = floor(uv);

    float f1 = 1.0; // nearest distance
    float f2 = 1.0; // second-nearest distance

    // 3x3 neighbor search (standard Voronoi)
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 cellId = id + neighbor;
        vec2 randomOffset = causticHash(cellId);
        // Animate the cell centers with sin for smooth looping motion
        randomOffset = 0.5 + 0.5 * sin(time + 6.2831 * randomOffset);

        vec2 diff = neighbor + randomOffset - p;
        float dist = length(diff);

        // Track two nearest distances for F2-F1
        if (dist < f1) {
          f2 = f1;
          f1 = dist;
        } else if (dist < f2) {
          f2 = dist;
        }
      }
    }
    // F2-F1: near zero at cell boundaries, larger at cell centers
    return f2 - f1;
  }

  // Combine caustic layers at different scales for richer pattern.
  // LOD controls detail level: full quality uses dual-layer, simplified uses single.
  float causticPattern(vec3 worldPos, float time, float lod) {
    // Tilted projection: mostly XZ (top-down) but blend in Y so vertical
    // surfaces like the logo get curved patterns instead of vertical streaks.
    vec2 baseUV = worldPos.xz + worldPos.y * vec2(0.3, 0.2);
    vec2 uv1 = baseUV * uCausticScale;

    // Full quality (LOD < 0.5): use dual-layer Voronoi for rich pattern
    if (lod < 0.5) {
      vec2 uv2 = baseUV * uCausticScale * 1.6 + vec2(3.7, 1.9); // offset to decorrelate

      float layer1 = causticLayer(uv1, time * uCausticSpeed, lod);
      float layer2 = causticLayer(uv2, time * uCausticSpeed * 1.3 + 2.0, lod);

      // Min of two F2-F1 layers: both are small at edges, so the min
      // creates a denser web where both layers' edges overlap.
      float combined = min(layer1, layer2);

      // Soft edge lines — wider smoothstep avoids filled-cell artifacts.
      // The gentle falloff keeps lines as thin bright strands, not filled regions.
      float caustic = 1.0 - smoothstep(0.0, 0.18, combined);

      // Subtle secondary glow for softer bleed around the bright edges
      caustic += 0.15 * (1.0 - smoothstep(0.05, 0.35, combined));

      return caustic;
    } else {
      // Simplified (LOD >= 0.5): use single-layer Voronoi with reduced domain warp
      float layer1 = causticLayer(uv1, time * uCausticSpeed, lod);

      // Soft edge lines — same as full quality but only one layer
      float caustic = 1.0 - smoothstep(0.0, 0.18, layer1);

      // Subtle secondary glow (reduced intensity for simplified mode)
      caustic += 0.1 * (1.0 - smoothstep(0.05, 0.35, layer1));

      return caustic;
    }
  }

  // Depth-based fade: strongest near surface, fading to zero at depth.
  // Uses a sqrt curve so caustics remain visible deep down (seabed) but
  // are still strongest near the surface.
  float causticDepthFade(float worldY) {
    // Distance below the surface
    float depth = max(0.0, uSurfaceY - worldY);
    // Sqrt falloff: gentler than linear, keeps caustics visible on the seabed
    float t = clamp(depth / uCausticFadeDepth, 0.0, 1.0);
    return 1.0 - t * t; // quadratic falloff — 50% at 70% depth, 0% at 100%
  }
`;

// ── GLSL: Fragment shader main injection (after lighting, before output) ──
// Injected by replacing the output_fragment include to add caustic light
// on top of the lit fragment color.
const CAUSTIC_FRAGMENT_MAIN = /* glsl */ `
  {
    vec3 cWorldPos = vCausticWorldPos;
    vec3 cWorldNrm = normalize(vCausticWorldNormal);

    // ── EARLY-OUT OPTIMIZATION: Compute cheap fade factors first ──
    // Normal-direction gate: only upward-facing surfaces receive caustic light.
    // dot(normal, up) = 1.0 for horizontal floors, 0.0 for vertical walls, -1.0 for ceilings.
    // Use smoothstep to softly fade on angled surfaces (walls get partial caustics).
    float normalFacing = smoothstep(-0.1, 0.3, cWorldNrm.y);

    // Apply depth fade (stronger near surface)
    float depthFade = causticDepthFade(cWorldPos.y);

    // Camera-distance fade: caustics dissolve into the fog at range.
    // cameraPosition is a built-in Three.js uniform.
    float camDist = length(cWorldPos - cameraPosition);
    float distFade = 1.0 - smoothstep(uCausticDistFade, uCausticDistFade * 1.6, camDist);

    // Compute combined fade before expensive Voronoi computation
    float combinedFade = depthFade * normalFacing * distFade;

    // Skip expensive causticPattern() if the combined fade is below threshold
    // (pixel would be invisible anyway due to distance, depth, or surface orientation)
    if (combinedFade >= 0.01) {
      // Compute caustic brightness at this fragment (expensive Voronoi)
      // LOD system: pass uCausticLOD to reduce GPU cost on subtle caustics
      float causticBrightness = causticPattern(cWorldPos, uCausticTime, uCausticLOD);

      // Final caustic contribution — additive light, gated by surface orientation
      vec3 causticColor = vec3(0.6, 0.85, 1.0) * causticBrightness * uCausticIntensity * uCausticBoost * combinedFade;

      gl_FragColor.rgb += causticColor;
    }
  }
`;

// ── GLSL: Vertex shader injection to ensure vCausticWorldPos is available ──
const CAUSTIC_VERTEX_PARS = /* glsl */ `
  varying vec3 vCausticWorldPos;
  varying vec3 vCausticWorldNormal;
`;

const CAUSTIC_VERTEX_MAIN = /* glsl */ `
  {
    vec4 _cwp = vec4(transformed, 1.0);
    vec4 _cwn = vec4(objectNormal, 0.0);
    #ifdef USE_INSTANCING
      _cwp = instanceMatrix * _cwp;
      _cwn = instanceMatrix * _cwn;
    #endif
    vCausticWorldPos = (modelMatrix * _cwp).xyz;
    vCausticWorldNormal = normalize((modelMatrix * _cwn).xyz);
  }
`;



/**
 * Patch a MeshStandardMaterial to add procedural caustics.
 * Chains with any existing onBeforeCompile (e.g., SwimMaterial).
 *
 * @param {THREE.Material} material — The material to patch
 * @param {number} [boost=1.0] — Per-material intensity multiplier (e.g., 3.0 for creatures)
 * @returns {Object} Shared uniform references (for debugging)
 */
// Caustics: ON for all platforms. Toggle with ?useCaustics=0 to disable.
const _useCaustics = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('useCaustics')) return params.get('useCaustics') !== '0';
  return true;
})();

export function applyCaustics(material, boost = 1.0) {
  if (!_useCaustics) return _sharedUniforms;
  if (!material || material._causticPatched) return _sharedUniforms;
  _ensureConfig();

  const origCompile = material.onBeforeCompile;
  // Per-material uniforms: boost and LOD (each material can have its own)
  // LOD = 0.0 for full quality (boost > 1.0, creatures/plants)
  // LOD = 1.0 for simplified (boost <= 1.0, terrain/ground)
  const causticLOD = boost > 1.0 ? 0.0 : 1.0;
  const perMaterialUniforms = {
    uCausticBoost: { value: boost },
    uCausticLOD: { value: causticLOD },
  };

  material.onBeforeCompile = (shader) => {
    // Chain: call previous hook first (e.g., SwimMaterial)
    if (origCompile) origCompile(shader);

    // Inject shared uniforms + per-material boost and LOD
    Object.assign(shader.uniforms, _sharedUniforms, perMaterialUniforms);

    // ── Vertex shader: add world-position varying ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\n' + CAUSTIC_VERTEX_PARS
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n' + CAUSTIC_VERTEX_MAIN
    );

    // ── Fragment shader: inject caustic functions + varying ──
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + CAUSTIC_FRAGMENT_PARS
    );

    // Apply caustic light just before dithering (after all lighting is resolved)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      CAUSTIC_FRAGMENT_MAIN + '\n#include <dithering_fragment>'
    );
  };

  material.needsUpdate = true;
  material._causticPatched = true;

  return _sharedUniforms;
}


/**
 * Update the shared caustic time uniform.
 * Call once per frame from the game loop.
 *
 * @param {number} elapsed — Total elapsed time in seconds
 */
export function updateCausticTime(elapsed) {
  _sharedUniforms.uCausticTime.value = elapsed;
}


/**
 * Get the shared caustic uniforms for external access (e.g., debug HUD).
 * @returns {Object} Uniform references
 */
export function getCausticUniforms() {
  _ensureConfig();
  return _sharedUniforms;
}
