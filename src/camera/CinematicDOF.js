/**
 * CinematicDOF — Depth-of-field post-processing system for PolyFish
 *
 * Implements cinematic lens simulation with three documentary-inspired profiles:
 * - DEEP: Establishing shot, everything in focus (f/16-f/22)
 * - MEDIUM: Chase/follow, subject + surroundings (f/5.6-f/8)
 * - SHALLOW: Hero portrait/macro, creamy bokeh background (f/2-f/4)
 *
 * Features:
 * - Smooth profile transitions (no jarring aperture changes)
 * - Focus distance tracking with cinematic rack focus
 * - Subtle cinematic vignette overlay
 * - Performance toggle for mobile/optimization
 * - Full EffectComposer integration with BokehPass
 *
 * ── INTEGRATION GUIDE ──────────────────────────────────────────────────────
 *
 * 1. IMPORT & INSTANTIATE (in main.js or SceneManager):
 *    import { CinematicDOF } from './camera/CinematicDOF.js';
 *    const dof = new CinematicDOF(renderer, scene, camera, {
 *      enabled: !isMobile,  // Auto-disable on mobile for performance
 *      initialProfile: 'MEDIUM',
 *      vignetteIntensity: 0.35,
 *    });
 *
 * 2. CALL RENDER INSTEAD OF renderer.render():
 *    In your main loop, change:
 *      sceneManager.render();
 *    To:
 *      dof.update(deltaTime);
 *      dof.render();
 *
 *    OR modify SceneManager.render() to use the composer instead of direct render.
 *
 * 3. SWITCH PROFILES (in DocumentaryDirector or EcosystemScout):
 *    // Establishing shot: everything sharp
 *    dof.setProfile('DEEP');
 *
 *    // Hero portrait: focus on subject at distance 15 units
 *    dof.setProfile('SHALLOW', 15.0);
 *
 *    // Chase follow: track moving subject
 *    dof.setProfile('MEDIUM', subjectDistance);
 *
 * 4. TRACK FOCUS DISTANCE (each frame from camera controller):
 *    const distanceToSubject = subjectPosition.distanceTo(camera.position);
 *    dof.updateFocusDistance(distanceToSubject);
 *
 * 5. CLEAN UP (on scene teardown):
 *    dof.dispose();
 *
 * ── PERFORMANCE NOTES ──────────────────────────────────────────────────────
 *
 * - DOF is GPU-intensive. BokehPass renders scene twice (depth + bokeh blur).
 * - Mobile: Set enabled=false in options to auto-disable. Use dof.setEnabled()
 *   at runtime to toggle based on performance metrics.
 * - Desktop: BokehPass is reasonably performant. Monitor GPU load in profiler.
 * - Window resize handled automatically via resize event listener.
 *
 * ── SHADER DETAILS ──────────────────────────────────────────────────────────
 *
 * BokehPass (from Three.js examples/jsm):
 *   - Renders depth texture of scene (with MeshDepthMaterial)
 *   - Applies bokeh blur shader with aperture and maxblur uniforms
 *   - Focus distance defines the plane in focus; blur increases away from it
 *
 * CinematicVignetteShader (custom):
 *   - Simple radial vignette: darkens edges, bright center
 *   - Applied as final post-processing pass (separate from BokehPass)
 *   - Independent intensity control for fine-tuning cinematic feel
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { easeOutCubic } from '../utils/MathUtils.js';

const _DEBUG = new URLSearchParams(window.location.search).has('debug');

/**
 * Cinematic vignette shader — darkens edges for lens feel
 * Separate from VR comfort vignette; always-on, subtle
 */
const CinematicVignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignetteIntensity: { value: 0.08 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignetteIntensity;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);

      // Radial falloff vignette: only darken the outer edges of frame
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float vignette = smoothstep(0.55, 0.9, dist);

      // Blend vignette: darken edges without losing detail
      vec3 darkened = texel.rgb * (1.0 - vignette * vignetteIntensity);
      gl_FragColor = vec4(darkened, texel.a);
    }
  `,
};

/**
 * DOF profile definitions — maps documentary-style names to bokeh parameters
 */
const DOF_PROFILES = {
  DEEP: {
    name: 'DEEP',
    description: 'Establishing shot — everything sharp',
    aperture: 0.001,      // f/16-f/22 equivalent
    maxblur: 0.001,       // Minimal blur
  },
  MEDIUM: {
    name: 'MEDIUM',
    description: 'Chase follow — subject + surroundings',
    aperture: 0.01,       // f/5.6-f/8 equivalent
    maxblur: 0.005,       // Subtle background blur
  },
  SHALLOW: {
    name: 'SHALLOW',
    description: 'Hero portrait — creamy bokeh',
    aperture: 0.025,      // f/2-f/4 equivalent
    maxblur: 0.015,       // Rich background blur
  },
};

export class CinematicDOF {
  /**
   * Create DOF post-processing system
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {Object} options - Configuration
   * @param {boolean} options.enabled - Start enabled (default: true)
   * @param {string} options.initialProfile - Starting profile (default: 'MEDIUM')
   * @param {number} options.vignetteIntensity - Vignette strength 0-1 (default: 0.35)
   * @param {number} options.focusRackSpeed - Rack focus interpolation rate (default: 2.0)
   * @param {number} options.profileTransitionTime - Aperture transition duration in seconds (default: 1.5)
   */
  constructor(renderer, scene, camera, options = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Configuration
    this.enabled = options.enabled !== false;
    this.vignetteIntensity = options.vignetteIntensity ?? 0.08;
    this.focusRackSpeed = options.focusRackSpeed ?? 2.0;
    this.profileTransitionTime = options.profileTransitionTime ?? 1.5;

    // State tracking
    this.currentProfile = DOF_PROFILES[options.initialProfile ?? 'MEDIUM'];
    this.targetProfile = this.currentProfile;
    this.currentAperture = this.currentProfile.aperture;
    this.targetAperture = this.currentProfile.aperture;
    this.currentMaxblur = this.currentProfile.maxblur;
    this.targetMaxblur = this.currentProfile.maxblur;

    // Focus distance tracking (cinematic rack focus)
    this.currentFocusDistance = 10.0;
    this.targetFocusDistance = 10.0;
    this.transitionTime = 0;
    this.transitionActive = false;

    // EffectComposer setup — use HalfFloat render target to preserve
    // color accuracy through the post-processing pipeline (prevents
    // double-darkening from ACES tonemapping + sRGB color space)
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const renderTarget = new THREE.WebGLRenderTarget(
      window.innerWidth * pixelRatio,
      window.innerHeight * pixelRatio,
      { type: THREE.HalfFloatType }
    );
    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setPixelRatio(pixelRatio);

    // RenderPass: render scene to texture
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // BokehPass: apply depth-of-field
    const bokehParams = {
      focus: this.currentFocusDistance,
      aperture: this.currentAperture,
      maxblur: this.currentMaxblur,
    };
    this.bokehPass = new BokehPass(scene, camera, bokehParams);
    this.bokehPass.enabled = this.enabled;
    this.composer.addPass(this.bokehPass);

    // Vignette pass: removed — was darkening entire scene
    this.vignettePass = null;

    // Handle window resize
    this.windowResizeHandler = () => this.onWindowResize();
    window.addEventListener('resize', this.windowResizeHandler);

    if (_DEBUG) console.log('[CinematicDOF] Initialized with profile:', this.currentProfile.name);
  }

  /**
   * Set the DOF profile with smooth aperture transition
   * @param {string} profileName - 'DEEP', 'MEDIUM', or 'SHALLOW'
   * @param {number} focusDistance - Optional: override focus distance (e.g., subject distance)
   */
  setProfile(profileName, focusDistance = null) {
    const profile = DOF_PROFILES[profileName];
    if (!profile) {
      console.warn(`[CinematicDOF] Unknown profile: ${profileName}`);
      return;
    }

    if (this.targetProfile === profile) {
      // Already on this profile, just update focus if needed
      if (focusDistance !== null) {
        this.updateFocusDistance(focusDistance);
      }
      return;
    }

    // Start smooth transition to new aperture
    this.targetProfile = profile;
    this.targetAperture = profile.aperture;
    this.targetMaxblur = profile.maxblur;
    this.transitionTime = 0;
    this.transitionActive = true;

    // Update focus distance if provided
    if (focusDistance !== null) {
      this.updateFocusDistance(focusDistance);
    }

    if (_DEBUG) console.log(`[CinematicDOF] Transitioning to profile: ${profile.name} (${profile.description})`);
  }

  /**
   * Update focus distance with cinematic rack focus (smooth interpolation)
   * Mimics a camera operator doing a focus pull
   * @param {number} distance - Distance from camera to focus point
   */
  updateFocusDistance(distance) {
    this.targetFocusDistance = Math.max(0.1, distance);
  }

  /**
   * Update DOF state (call each frame from main loop)
   * @param {number} deltaTime - Frame time in seconds
   */
  update(deltaTime) {
    if (!this.enabled) return;

    // Smooth aperture/maxblur transition when profile changes
    if (this.transitionActive) {
      this.transitionTime += deltaTime;
      const t = Math.min(1.0, this.transitionTime / this.profileTransitionTime);

      // Ease-out cubic interpolation for smooth lens feel
      const easeOut = easeOutCubic(t);

      this.currentAperture = THREE.MathUtils.lerp(
        this.currentAperture,
        this.targetAperture,
        easeOut
      );
      this.currentMaxblur = THREE.MathUtils.lerp(
        this.currentMaxblur,
        this.targetMaxblur,
        easeOut
      );

      if (t >= 1.0) {
        this.transitionActive = false;
        this.currentProfile = this.targetProfile;
      }

      this.bokehPass.uniforms.aperture.value = this.currentAperture;
      this.bokehPass.uniforms.maxblur.value = this.currentMaxblur;
    }

    // Cinematic focus rack: exponential lerp toward target focus distance
    // This mimics a real camera operator tracking a moving subject
    const focusDelta = this.targetFocusDistance - this.currentFocusDistance;
    const maxFocusChange = this.focusRackSpeed * deltaTime;

    if (Math.abs(focusDelta) > maxFocusChange) {
      this.currentFocusDistance += Math.sign(focusDelta) * maxFocusChange;
    } else {
      this.currentFocusDistance = this.targetFocusDistance;
    }

    this.bokehPass.uniforms.focus.value = this.currentFocusDistance;
  }

  /**
   * Render the frame with DOF applied
   * Must be called instead of renderer.render()
   */
  render() {
    if (!this.enabled) {
      // Fall back to direct render if DOF disabled
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.composer.render();
  }

  /**
   * Enable or disable DOF effect (toggle for performance)
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    this.bokehPass.enabled = enabled;

    if (_DEBUG) {
      if (enabled) {
        console.log('[CinematicDOF] Enabled');
      } else {
        console.log('[CinematicDOF] Disabled - falling back to direct render');
      }
    }
  }

  /**
   * Check if DOF is currently enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get current profile info
   * @returns {Object} Current profile object
   */
  getProfile() {
    return this.currentProfile;
  }

  /**
   * Get current focus distance
   * @returns {number}
   */
  getFocusDistance() {
    return this.currentFocusDistance;
  }

  /**
   * Get current aperture value
   * @returns {number}
   */
  getAperture() {
    return this.currentAperture;
  }

  /**
   * Lazily create and add the vignette pass to the composer.
   * Called when user toggles vignette on via 'V' key.
   */
  enableVignettePass() {
    if (this.vignettePass) return; // already created
    this.vignettePass = new ShaderPass(CinematicVignetteShader);
    this.vignettePass.uniforms.vignetteIntensity.value = this.vignetteIntensity;
    this.vignettePass.enabled = true;
    this.composer.addPass(this.vignettePass);
    if (_DEBUG) console.log('[CinematicDOF] Vignette pass enabled');
  }

  /**
   * Set vignette intensity (0-1)
   * @param {number} intensity
   */
  setVignetteIntensity(intensity) {
    this.vignetteIntensity = THREE.MathUtils.clamp(intensity, 0, 1);
    if (this.vignettePass) {
      this.vignettePass.uniforms.vignetteIntensity.value = this.vignetteIntensity;
    }
  }

  /**
   * Get vignette intensity
   * @returns {number}
   */
  getVignetteIntensity() {
    return this.vignetteIntensity;
  }

  /**
   * Get available DOF profiles
   * @returns {Object} Profile definitions
   */
  static getProfiles() {
    return DOF_PROFILES;
  }

  /**
   * Handle window resize — update composer and camera aspect
   * @private
   */
  onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.composer.setSize(width, height);
    this.bokehPass.setSize(width, height);
  }

  /**
   * Clean up resources (call when scene is destroyed)
   */
  dispose() {
    window.removeEventListener('resize', this.windowResizeHandler);

    this.bokehPass.dispose();
    this.composer.dispose();

    if (_DEBUG) console.log('[CinematicDOF] Disposed');
  }
}

