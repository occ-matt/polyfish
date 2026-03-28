/**
 * VRGodRays - World-space volumetric light beams for VR.
 *
 * Unlike the desktop GodRayRenderer (screen-space post-processing), this uses
 * a large transparent mesh in the scene graph with a custom shader. Three.js
 * handles stereo rendering automatically - no extra render passes needed.
 *
 * The shader computes beam brightness at each fragment using the same Voronoi
 * beam pattern as the desktop version, but derived from actual world position
 * (interpolated from vertices) instead of screen-space raymarching. This is
 * cheaper per-pixel and avoids the depth pre-pass entirely.
 *
 * Tradeoff: beams don't occlude against scene geometry. Underwater this looks
 * natural since real god rays pass through objects in water.
 *
 * Usage:
 *   const vrGodRays = new VRGodRays(scene);
 *   vrGodRays.update(elapsed, cameraWorldPos);
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const gc = CONFIG.godrays || {};
const cc = CONFIG.caustics || {};

const VRGodRayShader = {
  uniforms: {
    uTime: { value: 0 },
    uSurfaceY: { value: CONFIG.surfaceY },
    uIntensity: { value: gc.intensity ?? 0.7 },     // slightly lower than desktop for VR comfort
    uDensity: { value: gc.density ?? 0.3 },
    uBeamScale: { value: gc.beamScale ?? 0.22 },
    uCausticSpeed: { value: cc.speed ?? 0.4 },
    uFloorReach: { value: gc.floorReach ?? 0.06 },
    uTilt: { value: gc.tilt ?? 0.42 },
    uSmoothK: { value: gc.smoothK ?? 0.4 },
    uAnimSpeed: { value: gc.animSpeed ?? 1.0 },
    uCameraPos: { value: new THREE.Vector3() },
    uOpacity: { value: 1.0 },
  },

  vertexShader: /* glsl */ `
    varying vec3 vWorldPos;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uSurfaceY;
    uniform float uIntensity;
    uniform float uDensity;
    uniform float uBeamScale;
    uniform float uCausticSpeed;
    uniform float uFloorReach;
    uniform float uTilt;
    uniform float uSmoothK;
    uniform float uAnimSpeed;
    uniform vec3 uCameraPos;
    uniform float uOpacity;

    varying vec3 vWorldPos;

    // ── Noise (same as desktop god rays) ──

    vec2 grHash(vec2 p) {
      return vec2(
        fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
        fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
      );
    }

    float grValueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
      float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
      float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
      float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // Smooth Voronoi beam pattern (same algorithm as desktop)
    vec3 beamInfo(vec2 uv, float time) {
      float warpSpeed = time * 0.08;
      vec2 warp1 = vec2(
        grValueNoise(uv * 0.35 + warpSpeed),
        grValueNoise(uv * 0.35 + vec2(7.3, 2.8) + warpSpeed * 0.9)
      );
      vec2 warp2 = vec2(
        grValueNoise(uv * 0.7 + vec2(3.1, 5.9) + warpSpeed * 1.3),
        grValueNoise(uv * 0.7 + vec2(11.4, 8.2) + warpSpeed * 0.7)
      );
      uv += (warp1 - 0.5) * 1.1 + (warp2 - 0.5) * 0.4;

      vec2 id = floor(uv);
      vec2 p = fract(uv) - 0.5;

      float expSum = 0.0;
      float nearMinDist = 1.0;
      vec2 nearestCell = vec2(0.0);

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 cellId = id + neighbor;
          vec2 offset = grHash(cellId);
          offset = 0.5 + 0.45 * sin(6.2831 * offset);
          vec2 diff = neighbor + offset - p;
          float d = length(diff);
          expSum += exp(-uSmoothK * d);
          if (d < nearMinDist) {
            nearMinDist = d;
            nearestCell = cellId;
          }
        }
      }

      float smoothDist = -log(expSum) / uSmoothK;
      float beam = 1.0 - smoothstep(0.0, 1.2, smoothDist);
      beam = beam * beam * (3.0 - 2.0 * beam);

      float rawReach = fract(sin(dot(nearestCell, vec2(53.7, 91.3))) * 43758.5453);
      float depthReach = rawReach * rawReach * rawReach;

      return vec3(beam, depthReach, 0.0);
    }

    float beamBreakup(vec2 xz, float time) {
      float n1 = grValueNoise(xz * 0.7 + time * 0.06);
      float n2 = grValueNoise(xz * 1.4 + vec2(4.7, 1.3) + time * 0.04);
      float n = n1 * 0.65 + n2 * 0.35;
      return smoothstep(0.15, 0.7, n);
    }

    void main() {
      // Skip fragments above water surface
      if (vWorldPos.y > uSurfaceY) discard;

      float depth = uSurfaceY - vWorldPos.y;
      float animTime = uTime * uCausticSpeed * uAnimSpeed;

      // Tilted beam lookup (same as desktop)
      float wobble = sin(uTime * 0.03) * 0.02;
      vec2 tiltDir = vec2(uTilt + wobble, (uTilt * 0.48) + wobble * 0.7);
      vec2 drift = vec2(uTime * 0.015, uTime * 0.009);
      vec2 sampleUV = (vWorldPos.xz + depth * tiltDir + drift) * uBeamScale;

      vec3 info = beamInfo(sampleUV, animTime);
      float pattern = info.x;
      float depthReach = info.y;

      // Central beam above camera
      float centerDist = length(vWorldPos.xz - uCameraPos.xz);
      float centerBeam = exp(-centerDist * centerDist * 0.04);
      pattern = max(pattern, centerBeam * 0.8);
      depthReach = max(depthReach, centerBeam * 0.6);

      // Per-beam depth fade
      float fadeHalfLife = mix(2.0, mix(2.0, 16.0, uFloorReach), depthReach);
      float beamFadeHL = mix(1.5, fadeHalfLife, depthReach);
      float heightFade = exp(-depth / beamFadeHL);

      // Internal breakup
      vec2 tiltedXZ = vWorldPos.xz + depth * tiltDir;
      float breakup = beamBreakup(tiltedXZ, animTime);
      pattern *= mix(0.45, 1.0, breakup);

      // Combine beam with height fade and density
      float brightness = pattern * heightFade * uDensity;
      brightness = 1.0 - exp(-brightness * 2.5);

      // Distance fade - beams fade out at the edges of the volume
      float distFromCamera = length(vWorldPos.xz - uCameraPos.xz);
      float distFade = 1.0 - smoothstep(12.0, 20.0, distFromCamera);

      // View angle consideration - fade near edges of the volume mesh
      // to hide hard geometry boundaries
      float edgeFade = smoothstep(0.0, 2.0, depth);

      // DEBUG v2: full solid magenta to confirm mesh renders at all.
      // If this isn't visible, the mesh itself isn't rendering (not a shader issue).
      vec3 rayColor = vec3(1.0, 0.0, 1.0) * brightness * uIntensity * distFade * edgeFade;
      float alpha = length(rayColor) * uOpacity;

      // Force high visibility for debugging
      rayColor = max(rayColor, vec3(0.3, 0.0, 0.3));
      alpha = max(alpha, 0.15);

      gl_FragColor = vec4(rayColor, alpha);
    }
  `,
};


export class VRGodRays {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;

    // Large box geometry centered on the play area.
    // Extends from below the terrain to the water surface.
    const boxW = 50;   // XZ extent
    const boxH = 20;   // Y extent (terrain to surface)
    const geometry = new THREE.BoxGeometry(boxW, boxH, boxW);

    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(VRGodRayShader.uniforms),
      vertexShader: VRGodRayShader.vertexShader,
      fragmentShader: VRGodRayShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,          // no depth test - additive beams render on top of scene
      side: THREE.BackSide,      // render inner faces so we see the effect from inside
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'vr-god-rays';
    this.mesh.frustumCulled = false;  // always render (we're inside the box)
    this.mesh.renderOrder = 450;      // after scene geometry, before HUD/vignette
    // Center vertically in the water column
    this.mesh.position.set(0, CONFIG.surfaceY - boxH / 2, 0);

    scene.add(this.mesh);
    this.mesh.visible = false; // hidden until VR session starts

    // VRGodRays initialized (world-space volumetric mesh)
  }

  /**
   * Update uniforms each frame.
   * @param {number} elapsed - total elapsed time in seconds
   * @param {THREE.Vector3} cameraWorldPos - camera world position
   */
  update(elapsed, cameraWorldPos) {
    if (!this.enabled || !this.mesh.visible) return;
    this.material.uniforms.uTime.value = elapsed;
    if (cameraWorldPos) {
      this.material.uniforms.uCameraPos.value.copy(cameraWorldPos);
      // Keep the volume centered on the camera XZ so beams are always around the player
      this.mesh.position.x = cameraWorldPos.x;
      this.mesh.position.z = cameraWorldPos.z;
    }
  }

  /**
   * Show/hide the god ray volume.
   */
  setVisible(visible) {
    this.mesh.visible = visible;
    // VRGodRays visibility toggled
  }

  /**
   * Set intensity (0-1+ range).
   */
  setIntensity(intensity) {
    this.material.uniforms.uIntensity.value = intensity;
  }

  /**
   * Clean up GPU resources.
   */
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
