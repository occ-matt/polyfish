/**
 * VRComfortVignette — Darkens screen edges during VR locomotion for comfort.
 *
 * Reduces motion sickness by providing a stable visual reference during
 * thumbstick-based movement. Renders as a full-screen quad with a radial
 * vignette shader that darkens edges when player is moving.
 */
import * as THREE from 'three';

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
uniform float intensity;
varying vec2 vUv;

void main() {
  vec2 center = vUv - 0.5;
  float dist = length(center) * 2.0;
  float vignette = smoothstep(0.5, 1.2, dist);
  gl_FragColor = vec4(0.0, 0.0, 0.0, vignette * intensity);
}
`;

export class VRComfortVignette {
  constructor() {
    // Create full-screen quad geometry positioned in clip space
    const geometry = new THREE.PlaneGeometry(2, 2);

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        intensity: { value: 0.0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 1000; // Render on top of everything
    this.mesh.frustumCulled = false; // Always render, even outside camera frustum

    // Current and target intensity for smooth transitions
    this._currentIntensity = 0.0;
    this._targetIntensity = 0.0;
    this._smoothSpeed = 3.0; // Units per second
  }

  /**
   * Attach the vignette mesh to a camera so it follows the view.
   * @param {THREE.Camera} camera — typically the XR camera
   */
  attach(camera) {
    camera.add(this.mesh);
  }

  /**
   * Set the vignette intensity directly (0 = off, 1 = full).
   * @param {number} value — intensity (0–1)
   */
  setIntensity(value) {
    this._currentIntensity = THREE.MathUtils.clamp(value, 0, 1);
    this.mesh.material.uniforms.intensity.value = this._currentIntensity;
  }

  /**
   * Update vignette intensity based on movement state.
   * Smoothly ramps up to 0.35 when moving, down to 0 when stopped.
   * @param {number} dt — delta time in seconds
   * @param {boolean} isMoving — whether the player is currently moving
   */
  update(dt, isMoving) {
    this._targetIntensity = isMoving ? 0.35 : 0.0;

    // Smoothly interpolate toward target
    const diff = this._targetIntensity - this._currentIntensity;
    const maxDelta = this._smoothSpeed * dt;

    if (Math.abs(diff) > maxDelta) {
      this._currentIntensity += Math.sign(diff) * maxDelta;
    } else {
      this._currentIntensity = this._targetIntensity;
    }

    this.mesh.material.uniforms.intensity.value = this._currentIntensity;
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
