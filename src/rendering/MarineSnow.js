import * as THREE from 'three';
import { CONFIG } from '../config.js';
import sceneManager from './SceneManager.js';
import { getSharedTexture } from '../utils/TextureCache.js';
import { randomSphericalDirection } from '../utils/MathUtils.js';

/**
 * MarineSnow
 * Ambient particle system — drifting organic particles around the camera.
 * Custom ShaderMaterial for per-particle rotation.
 */
class MarineSnow {
  constructor() {
    this.points = null;
    this.geometry = null;
    this.vrModeActive = false;
    this.fullParticleCount = 0;
    this.camera = null;
    this.radius = 0;
    this.vy = null;
    this.vx = null;
    this.phase = null;
    this.rotSpeed = null; // per-particle rotation speed (radians/sec)
    this.rotAttr = null;  // GPU rotation attribute
  }

  init(scene = null, camera = null) {
    if (!scene) scene = sceneManager.getScene();
    this.camera = camera;

    const params = new URLSearchParams(window.location.search);
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const useSnow = params.has('useSnow') ? params.get('useSnow') !== '0' : true;
    const useFullSnow = params.has('useFullSnow') ? params.get('useFullSnow') !== '0' : !isMobile;
    const { count: baseCount, speed, size } = CONFIG.marineSnow;
    const count = useFullSnow ? baseCount : (useSnow ? Math.floor(baseCount * 0.3) : 0);

    if (count === 0) return;

    this.radius = 9;
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const rotations = new Float32Array(count);

    this.vy = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.phase = new Float32Array(count);
    this.rotSpeed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const r = this.radius * Math.cbrt(Math.random());
      const dir = randomSphericalDirection();

      positions[i * 3]     = r * dir.x;
      positions[i * 3 + 1] = r * dir.y;
      positions[i * 3 + 2] = r * dir.z;

      this.vy[i] = speed * (0.5 + Math.random());
      this.vx[i] = (Math.random() - 0.5) * 0.15;
      this.phase[i] = Math.random() * Math.PI * 2;

      // Random rotation speed: -1.5 to +1.5 rad/sec (varied tumble)
      this.rotSpeed[i] = (Math.random() - 0.5) * 3.0;
      rotations[i] = Math.random() * Math.PI * 2; // initial angle
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rotAttr = new THREE.BufferAttribute(rotations, 1);
    this.rotAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aRotation', this.rotAttr);

    this.fullParticleCount = count;

    const particleTexture = getSharedTexture('/textures/tri_particle_64.png');

    // Custom shader for per-particle rotation
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: particleTexture },
        uSize: { value: size },
        uOpacity: { value: 0.4 },
      },
      vertexShader: /* glsl */ `
        attribute float aRotation;
        varying float vRotation;
        uniform float uSize;
        void main() {
          vRotation = aRotation;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (300.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 32.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTexture;
        uniform float uOpacity;
        varying float vRotation;
        void main() {
          // Rotate gl_PointCoord around center
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRotation);
          float s = sin(vRotation);
          uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
          vec4 tex = texture2D(uTexture, uv);
          if (tex.a < 0.05) discard;
          gl_FragColor = vec4(tex.rgb, tex.a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setVRMode(active) {
    if (this.vrModeActive === active || !this.geometry) return;
    this.vrModeActive = active;
    if (active) {
      this.geometry.setDrawRange(0, Math.floor(this.fullParticleCount * 0.5));
    } else {
      this.geometry.setDrawRange(0, this.fullParticleCount);
    }
  }

  update(dt, camera) {
    if (!this.geometry || !this.fullParticleCount) return;

    const cam = camera || this.camera;
    const positions = this.geometry.attributes.position.array;
    const rotArr = this.rotAttr.array;
    const r = this.radius;
    const rSq = r * r;

    // Particles are in world space; mesh stays at origin.
    const cx = cam ? cam.position.x : 0;
    const cy = cam ? cam.position.y : 0;
    const cz = cam ? cam.position.z : 0;

    const count = this.fullParticleCount;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Drift — own velocity only, no camera motion
      positions[i3]     += this.vx[i] * dt + Math.sin(this.phase[i] + dt) * 0.02 * dt;
      positions[i3 + 1] -= this.vy[i] * dt;
      this.phase[i] += dt * 0.5;

      // Rotate
      rotArr[i] += this.rotSpeed[i] * dt;

      // Wrap if outside camera sphere — respawn randomly inside the sphere
      // (not just at the top) so walking in any direction fills uniformly
      const dx = positions[i3]     - cx;
      const dy = positions[i3 + 1] - cy;
      const dz = positions[i3 + 2] - cz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > rSq) {
        // Random point inside sphere (uniform distribution via cube root)
        const rr = r * Math.cbrt(Math.random());
        const dir = randomSphericalDirection();
        positions[i3]     = cx + rr * dir.x;
        positions[i3 + 1] = cy + rr * dir.y;
        positions[i3 + 2] = cz + rr * dir.z;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.rotAttr.needsUpdate = true;
  }
}

export default new MarineSnow();
