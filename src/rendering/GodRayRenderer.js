/**
 * GodRayRenderer - Screen-space volumetric light shafts for PolyFish
 *
 * Renders thick volumetric light beams in the water column by raymarching
 * through each pixel's view ray. Uses an inverted Voronoi F1 pattern
 * (bright cell centers, dark edges) for broad, soft light columns.
 *
 * The effect is strongest near the water surface and fades with depth,
 * sometimes reaching all the way down to the floor.
 *
 * Works with both render paths:
 *   - Standard: sceneManager.render() -> god ray composite
 *   - Cinematic DOF: cinematicDOF.render() -> god ray composite
 *
 * Toggle via URL: ?useGodrays=0 to disable.
 *
 * Usage:
 *   import { GodRayRenderer } from './rendering/GodRayRenderer.js';
 *   const godRays = new GodRayRenderer(renderer, scene, camera);
 *
 *   // In render loop:
 *   godRays.update(elapsed);       // sync time uniform
 *   godRays.render();              // renders scene + god ray composite
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';

// Note: enable/disable is handled by USE_GODRAYS feature flag in main.js
// (desktop ON, mobile OFF, VR OFF; override via ?useGodrays=0)

// ── God ray fullscreen shader ──
// Additive-only god ray shader. Outputs ONLY the god ray light contribution
// with alpha=0 where no light. Rendered as an additive blend on top of the
// normal scene, so scene colors are never touched.
const GodRayShader = {
  uniforms: {
    tDepth: { value: null },        // Depth buffer from a depth-only pre-pass
    uTime: { value: 0 },
    uSurfaceY: { value: CONFIG.surfaceY },
    uIntensity: { value: 0.3 },
    uDensity: { value: 0.5 },
    uMaxDist: { value: 18.0 },
    uBeamScale: { value: 0.08 },
    uCausticSpeed: { value: 0.4 },
    uFloorReach: { value: 0.35 },
    uTilt: { value: 0.25 },
    uSmoothK: { value: 0.6 },
    uAnimSpeed: { value: 1.0 },
    uInvProjection: { value: new THREE.Matrix4() },
    uInvView: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform float uTime;
    uniform float uSurfaceY;
    uniform float uIntensity;
    uniform float uDensity;
    uniform float uMaxDist;
    uniform float uBeamScale;
    uniform float uCausticSpeed;
    uniform float uFloorReach;
    uniform float uTilt;
    uniform float uSmoothK;
    uniform float uAnimSpeed;
    uniform mat4 uInvProjection;
    uniform mat4 uInvView;
    uniform vec3 uCameraPos;

    varying vec2 vUv;

    // ── Noise for thick light beams ──

    vec2 grHash(vec2 p) {
      return vec2(
        fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
        fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
      );
    }

    // Smooth value noise (used for slow domain warping)
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

    // Voronoi F1 with per-beam depth variation and internal breakup.
    // Returns vec3: x = beam brightness, y = per-beam depth reach (0-1),
    //               z = unused.
    //
    // Cell CENTERS are bright = thick beams, edges are dark gaps.
    // Each cell has a random depth limit so beams extend different distances.
    //
    // Uses a smooth Voronoi approach: instead of hard-min to find the
    // nearest cell (which has gradient discontinuities at boundaries),
    // we accumulate exponential weights from ALL cells. This produces a
    // C-infinity smooth distance field with no harsh edges anywhere.
    vec3 beamInfo(vec2 uv, float time) {
      // Heavier domain warp to break up the grid-like regularity.
      // Two octaves at different scales prevent the "spotlight circle" look.
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

      // Smooth Voronoi: accumulate exp weights for smooth-min distance.
      // uSmoothK controls the sharpness of the exponential falloff.
      // Higher k = sharper cells (closer to hard Voronoi).
      // Lower k = softer, more blended transitions.
      float smoothK = uSmoothK;
      float expSum = 0.0;       // sum of exp(-k*d) for smooth distance
      float nearMinDist = 1.0;  // still track nearest for depthReach hash
      vec2 nearestCell = vec2(0.0);

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 cellId = id + neighbor;
          vec2 offset = grHash(cellId);
          // Random cell center placement - NO time dependency here.
          // The domain warp handles slow organic drift; cell centers
          // stay fixed so beam roots don't slide around.
          offset = 0.5 + 0.45 * sin(6.2831 * offset);
          vec2 diff = neighbor + offset - p;
          float d = length(diff);

          // Accumulate for smooth minimum (log-sum-exp trick)
          expSum += exp(-smoothK * d);

          if (d < nearMinDist) {
            nearMinDist = d;
            nearestCell = cellId;
          }
        }
      }

      // Recover smooth distance: -log(sum(exp(-k*d))) / k
      // This is C-infinity smooth everywhere, no gradient discontinuities.
      float smoothDist = -log(expSum) / smoothK;

      // Wide smoothstep for soft edges. The 1.2 range extends well past
      // typical cell boundaries so the falloff is very gradual.
      float beam = 1.0 - smoothstep(0.0, 1.2, smoothDist);
      // Cubic hermite (x^2 * (3-2x)) reshapes the falloff: keeps beam
      // centers bright but makes the edges fade more gently than
      // a simple quadratic, which amplifies gradient differences.
      beam = beam * beam * (3.0 - 2.0 * beam);

      // Per-beam depth reach: hash the cell ID to get a 0-1 value.
      // Bias toward shallow beams: most stop near the surface,
      // only rare ones extend deep (cube root pushes values low).
      float rawReach = fract(sin(dot(nearestCell, vec2(53.7, 91.3))) * 43758.5453);
      float depthReach = rawReach * rawReach * rawReach; // cube bias toward shallow

      return vec3(beam, depthReach, 0.0);
    }

    // Medium-frequency breakup noise to create holes/gaps inside beams.
    // Without this, each beam is a solid uniform column of light.
    float beamBreakup(vec2 xz, float time) {
      // Two scales of noise blended together for organic patchiness.
      // Higher frequency = more frequent bright/dark patches within beams.
      float n1 = grValueNoise(xz * 0.7 + time * 0.06);
      float n2 = grValueNoise(xz * 1.4 + vec2(4.7, 1.3) + time * 0.04);
      float n = n1 * 0.65 + n2 * 0.35;
      // Remap to create soft bright/dark patches within the beam.
      // Wide transition band (0.15 to 0.7) prevents harsh patch edges.
      return smoothstep(0.15, 0.7, n);
    }

    // Reconstruct world position from screen UV + depth
    vec3 worldPosFromDepth(vec2 uv, float depth) {
      vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 viewPos = uInvProjection * ndc;
      viewPos /= viewPos.w;
      vec4 worldPos = uInvView * viewPos;
      return worldPos.xyz;
    }

    // Screen-space blue noise dither to break up raymarching bands.
    // Returns 0-1 based on pixel position. Interleaved gradient noise
    // by Jorge Jimenez - nearly perfect blue-noise distribution.
    float interleavedGradientNoise(vec2 pixel) {
      return fract(52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
    }

    void main() {
      float rawDepth = texture2D(tDepth, vUv).r;

      vec3 hitPos = worldPosFromDepth(vUv, rawDepth);
      float hitDist = length(hitPos - uCameraPos);
      vec3 rayDir = normalize(hitPos - uCameraPos);
      float marchDist = min(hitDist, uMaxDist);

      // View-angle fade: god rays are vertical columns, so they are most
      // visible when viewed from the side (horizontal rays). When looking
      // straight up or down you see along the beam axis - fade to zero.
      // abs(rayDir.y) = 1 when looking straight up/down, 0 when horizontal.
      float viewAngleFade = 1.0 - smoothstep(0.65, 0.97, abs(rayDir.y));

      float fadeHalfLife = mix(2.0, 16.0, uFloorReach);

      const int NUM_STEPS = 16;
      float stepSize = marchDist / float(NUM_STEPS);
      float accum = 0.0;

      // Per-pixel jitter offset (0 to 1 step) breaks up banding artifacts
      // from discrete raymarching steps, especially visible when looking up.
      vec2 pixelCoord = gl_FragCoord.xy;
      float jitter = interleavedGradientNoise(pixelCoord) * stepSize;

      for (int i = 0; i < NUM_STEPS; i++) {
        float t = (float(i) + 0.5) * stepSize + jitter;
        vec3 samplePos = uCameraPos + rayDir * t;

        if (samplePos.y > uSurfaceY) continue;

        float depth = uSurfaceY - samplePos.y;

        // Angled beam lookup: shift XZ by depth so beams tilt like /
        // instead of straight down |. Fixed ~4pm sun direction with a
        // very slow subtle wobble so it doesn't feel perfectly static.
        float wobble = sin(uTime * 0.03) * 0.02;
        vec2 tiltDir = vec2(uTilt + wobble, (uTilt * 0.48) + wobble * 0.7);
        // Slow drift offset so beam pattern slides through the scene.
        // Prevents cell boundaries from parking in one visible spot.
        vec2 drift = vec2(uTime * 0.015, uTime * 0.009);
        vec2 sampleUV = (samplePos.xz + depth * tiltDir + drift) * uBeamScale;
        vec3 info = beamInfo(sampleUV, uTime * uCausticSpeed * uAnimSpeed);
        float pattern = info.x;
        float depthReach = info.y;

        // Central beam: gaussian bright spot directly above the camera
        // so when looking up at the ring of beams, there's one in the center.
        float centerDist = length(samplePos.xz - uCameraPos.xz);
        float centerBeam = exp(-centerDist * centerDist * 0.04);
        pattern = max(pattern, centerBeam * 0.8);
        depthReach = max(depthReach, centerBeam * 0.6);

        // Per-beam depth fade: each beam has its own max depth.
        // depthReach 0 = stops near surface, 1 = extends to floor.
        // Map depthReach to a fadeHalfLife for this beam.
        float beamFadeHL = mix(1.5, fadeHalfLife, depthReach);
        float heightFade = exp(-depth / beamFadeHL);

        // Internal breakup uses the same tilted XZ so patches
        // align with the beam direction instead of cutting across it.
        vec2 tiltedXZ = samplePos.xz + depth * tiltDir;
        float breakup = beamBreakup(tiltedXZ, uTime * uCausticSpeed * uAnimSpeed);
        pattern *= mix(0.45, 1.0, breakup);

        accum += pattern * heightFade * uDensity * stepSize;
      }

      // Soft-clamp accumulator so overlapping beams blend smoothly
      // instead of creating harsh additive boundaries.
      accum = 1.0 - exp(-accum * 1.8);

      // Apply view-angle fade and output god ray light
      vec3 rayColor = vec3(0.55, 0.78, 1.0) * accum * uIntensity * viewAngleFade;
      gl_FragColor = vec4(rayColor, 1.0);
    }
  `,
};


export class GodRayRenderer {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;

    // Read config
    const gc = CONFIG.godrays || {};
    const cc = CONFIG.caustics || {};

    // Create render target with depth texture
    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();
    const w = Math.floor(size.x * pixelRatio);
    const h = Math.floor(size.y * pixelRatio);

    // Depth-only render target (no color buffer needed, just depth)
    this.depthTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      colorSpace: THREE.NoColorSpace,
    });
    this.depthTarget.depthTexture = new THREE.DepthTexture(w, h);
    this.depthTarget.depthTexture.type = THREE.UnsignedIntType;

    // Fullscreen quad rendered additively on top of the scene
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(GodRayShader.uniforms),
      vertexShader: GodRayShader.vertexShader,
      fragmentShader: GodRayShader.fragmentShader,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });

    // Apply config values
    this.material.uniforms.uIntensity.value = gc.intensity ?? 1.05;
    this.material.uniforms.uDensity.value = gc.density ?? 0.3;
    this.material.uniforms.uMaxDist.value = gc.maxDist ?? 18.0;
    this.material.uniforms.uBeamScale.value = gc.beamScale ?? 0.22;
    this.material.uniforms.uCausticSpeed.value = cc.speed ?? 0.4;
    this.material.uniforms.uFloorReach.value = gc.floorReach ?? 0.06;
    this.material.uniforms.uTilt.value = gc.tilt ?? 0.42;
    this.material.uniforms.uSmoothK.value = gc.smoothK ?? 0.4;
    this.material.uniforms.uAnimSpeed.value = gc.animSpeed ?? 1.0;
    this.material.uniforms.uSurfaceY.value = CONFIG.surfaceY;

    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.material
    );
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Handle resize
    this._onResize = () => this._handleResize();
    window.addEventListener('resize', this._onResize);

    // GodRayRenderer initialized (screen-space volumetric)
  }

  /**
   * Update the time uniform. Call once per frame.
   * @param {number} elapsed - Total elapsed seconds
   */
  update(elapsed) {
    if (!this.enabled) return;
    this.material.uniforms.uTime.value = elapsed;
  }

  /**
   * Capture the depth buffer from the already-rendered scene.
   * Must be called BEFORE the scene render so we can grab the depth,
   * then renderOverlay() is called AFTER the scene renders to screen.
   */
  captureDepth() {
    if (!this.enabled) return;

    const renderer = this.renderer;
    const cam = this.camera;

    // Render scene to offscreen target purely to capture depth texture.
    // Color output is discarded (we only need the depth).
    const origTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear();
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(origTarget);
  }

  /**
   * Render god ray overlay additively on top of the scene.
   * Call AFTER the normal scene has been rendered to screen.
   * The scene colors are untouched (no intermediate color render target).
   */
  renderOverlay() {
    if (!this.enabled) return;

    const renderer = this.renderer;
    const cam = this.camera;

    // Update camera uniforms
    this.material.uniforms.uCameraPos.value.copy(cam.position);
    this.material.uniforms.uInvProjection.value.copy(cam.projectionMatrixInverse);
    this.material.uniforms.uInvView.value.copy(cam.matrixWorld);
    this.material.uniforms.tDepth.value = this.depthTarget.depthTexture;

    // Render additive god ray quad on top of whatever is in the framebuffer.
    // The autoClear must be disabled so we don't erase the scene.
    const origAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = origAutoClear;
  }

  /** @private */
  _handleResize() {
    if (!this.enabled) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const w = Math.floor(size.x * pr);
    const h = Math.floor(size.y * pr);
    this.depthTarget.setSize(w, h);
  }

  /** Clean up GPU resources */
  dispose() {
    if (!this.enabled) return;
    window.removeEventListener('resize', this._onResize);
    this.depthTarget.dispose();
    this.depthTarget.depthTexture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
