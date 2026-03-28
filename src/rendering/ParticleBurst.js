import * as THREE from 'three';
import { getSharedTexture } from '../utils/TextureCache.js';
import { randomSphericalDirection } from '../utils/MathUtils.js';

const PARTICLE_COUNT = 16;
const BURST_LIFETIME = 0.8; // seconds
const BURST_SPEED = 3.0;
const PARTICLE_SIZE = 0.12;

function createMaterial() {
  return new THREE.PointsMaterial({
    size: PARTICLE_SIZE,
    map: getSharedTexture('/textures/tri_particle_64.png'),
    transparent: true,
    opacity: 1.0,
    color: 0xffffff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
}

class Burst {
  constructor() {
    this.active = false;
    this.timer = 0;
    this.followTarget = null; // optional mesh to follow (particles move with it)
    this.followOffset = new THREE.Vector3(); // origin offset from target at fire time

    // Per-particle velocities
    this.velocities = new Float32Array(PARTICLE_COUNT * 3);

    // Geometry with positions
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Each burst gets its own material so color/opacity can vary independently
    this.material = createMaterial();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.visible = false;
    this.points.renderOrder = 500;
    // Disable frustum culling — positions are in world-space in the vertex
    // buffer so the default bounding sphere can be wrong after particles expand.
    // Without this, stereo VR rendering may cull the burst from one/both eyes.
    this.points.frustumCulled = false;
  }

  fire(position, color, followTarget = null) {
    this.active = true;
    this.timer = 0;
    this.followTarget = followTarget;
    if (followTarget) {
      this.followOffset.copy(position).sub(followTarget.position);
    }

    if (color !== undefined) {
      this.material.color.set(color);
    }

    const positions = this.geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // All start at the burst origin
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      // Random outward velocity (spherical)
      const dir = randomSphericalDirection();
      const speed = BURST_SPEED * (0.5 + Math.random() * 0.5);
      this.velocities[i * 3]     = dir.x * speed;
      this.velocities[i * 3 + 1] = dir.y * speed;
      this.velocities[i * 3 + 2] = dir.z * speed;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.points.visible = true;
  }

  update(dt) {
    if (!this.active) return;

    this.timer += dt;
    if (this.timer >= BURST_LIFETIME) {
      this.active = false;
      this.points.visible = false;
      return;
    }

    const t = this.timer / BURST_LIFETIME;
    // Fade out opacity
    this.material.opacity = 1.0 - t;

    // If following a target, compute pull position for particles
    if (this.followTarget) {
      const tp = this.followTarget.position;
      const origin = this.followOffset;
      // Store target position for per-particle pull below
      this._targetX = tp.x + origin.x;
      this._targetY = tp.y + origin.y;
      this._targetZ = tp.z + origin.z;
    }

    const positions = this.geometry.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] += this.velocities[i * 3] * dt;
      positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      // Pull particles toward the moving target
      if (this.followTarget) {
        const pullStrength = 3.0 * dt;
        this.velocities[i * 3]     += (this._targetX - positions[i * 3]) * pullStrength;
        this.velocities[i * 3 + 1] += (this._targetY - positions[i * 3 + 1]) * pullStrength;
        this.velocities[i * 3 + 2] += (this._targetZ - positions[i * 3 + 2]) * pullStrength;
      }

      // Slow down over time
      this.velocities[i * 3] *= 0.95;
      this.velocities[i * 3 + 1] *= 0.95;
      this.velocities[i * 3 + 2] *= 0.95;
    }

    this.geometry.attributes.position.needsUpdate = true;
  }
}

/**
 * ParticleBurstPool — manages a pool of reusable burst effects.
 */
class ParticleBurstPool {
  constructor() {
    this.bursts = [];
    this.scene = null;
  }

  init(scene) {
    this.scene = scene;
    // Pre-allocate a few bursts
    for (let i = 0; i < 8; i++) {
      const burst = new Burst();
      scene.add(burst.points);
      this.bursts.push(burst);
    }
  }

  /**
   * Emit a particle burst at a position with an optional color.
   * @param {THREE.Vector3} position
   * @param {number|THREE.Color} [color=0x88ffaa] — hex color for the particles
   * @param {THREE.Object3D} [followTarget=null] — mesh to follow (particles streak with it)
   */
  emit(position, color, followTarget = null) {
    if (!this.scene) return;

    // Find an inactive burst
    let burst = this.bursts.find(b => !b.active);
    if (!burst) {
      // Grow pool
      burst = new Burst();
      this.scene.add(burst.points);
      this.bursts.push(burst);
    }

    burst.fire(position, color, followTarget);
  }

  update(dt) {
    for (const burst of this.bursts) {
      burst.update(dt);
    }
  }
}

export default new ParticleBurstPool();
