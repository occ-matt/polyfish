import * as THREE from 'three';
import { randomRange, easeOutCubic } from '../utils/MathUtils.js';
import { createColorMaterial } from '../rendering/IBLMaterial.js';
import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../utils/Terrain.js';
import debugColliders from '../core/DebugColliders.js';

let physicsProxy = null;

export class Seed {
  /**
   * Set the PhysicsProxy to use for physics operations.
   */
  static setPhysicsProxy(proxy) {
    physicsProxy = proxy;
  }

  constructor() {
    const geometry = new THREE.OctahedronGeometry(0.1, 0);
    const material = createColorMaterial(CONFIG.seedColor, { flatShading: true });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.setScalar(CONFIG.seedScale);
    this.mesh.visible = false;
    this.mesh.position.set(0, -9999, 0); // Start underground so pool never flashes at origin

    this.joltBodyID = null;
    this.active = false;
    this.lifetime = 0;
    this.hasLanded = false;
    this._bounceCount = 0;
    this.forceGerminate = false;
    this.germinated = false; // true once seed has become a plant
    this._germScaleTimer = 0; // animated scale-up on germination
  }

  activate(position) {
    this.active = true;
    // Set position BEFORE making visible to prevent 1-frame flash at origin
    this.mesh.position.copy(position);
    this.mesh.visible = true;
    this.lifetime = 0;
    this.maxLifetime = 15 + randomRange(0, 5); // fixed at activate, not re-rolled per frame
    this.hasLanded = false;
    this._bounceCount = 0;
    this.germinated = false;
    this._germScaleTimer = 0;
    this.spawnTimer = 0;
    this.spawnDuration = 4.0;
    this.mesh.scale.setScalar(0.01); // start tiny

    // Sphere collider — Jolt handles ALL seed physics (position + rotation)
    if (!physicsProxy) return;
    const r = 0.1 * CONFIG.seedScale;

    const slot = physicsProxy.createBody(
      { type: 'sphere', radius: r },
      { x: position.x, y: position.y, z: position.z },
      { x: 0, y: 0, z: 0, w: 1 },
      'dynamic',
      1,
      { mass: 0.3, restitution: 0.75, friction: 0.4, linearDamping: 0.15, angularDamping: 0.8 }
    );
    this.joltBodyID = slot >= 0 ? slot : null;

    // Give an initial gentle random spin so seeds tumble naturally
    if (this.joltBodyID !== null) {
      const spread = 3.0; // radians/sec — gentle tumble
      physicsProxy.setAngularVelocity(this.joltBodyID,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread
      );
    }

    // Debug collider wireframe (visual only — physics uses sphere)
    debugColliders.addHull(this, 0.1 * CONFIG.seedScale);
  }

  deactivate() {
    this.active = false;
    this.mesh.visible = false;
    // Move mesh far off-screen to prevent any stale-frame flash from pool reuse
    this.mesh.position.set(0, -9999, 0);
    debugColliders.remove(this);
    if (this.joltBodyID !== null && physicsProxy) {
      physicsProxy.removeBody(this.joltBodyID);
      this.joltBodyID = null;
    }
  }

  update(dt, callbacks = {}) {
    if (!this.active) return;

    // Germinated seeds: animate scale-up with elastic bounce, then idle
    if (this.germinated) {
      const germDuration = 1.0; // 1 second bounce animation
      if (this._germScaleTimer < germDuration) {
        this._germScaleTimer += dt;
        const t = Math.min(this._germScaleTimer / germDuration, 1);
        // Elastic ease-out: overshoot then settle (same style as held food)
        const p = 0.4;
        const scale = Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
        this.mesh.scale.setScalar(CONFIG.seedScale * 2 * scale);
      }
      return;
    }

    this.lifetime += dt;

    if (this.lifetime > this.maxLifetime) {
      this.deactivate();
      return;
    }

    // Spawn scale-in
    this.spawnTimer += dt;
    if (this.spawnTimer < this.spawnDuration) {
      const t = Math.min(this.spawnTimer / this.spawnDuration, 1);
      const eased = easeOutCubic(t);
      this.mesh.scale.setScalar(CONFIG.seedScale * eased);
    } else if (this.mesh.scale.x < CONFIG.seedScale * 0.99) {
      this.mesh.scale.setScalar(CONFIG.seedScale);
    }

    // Read position AND rotation from Jolt — Jolt owns all seed physics
    if (this.joltBodyID !== null && physicsProxy) {
      const pos = physicsProxy.getPosition(this.joltBodyID);
      this.mesh.position.set(pos.x, pos.y, pos.z);

      const rot = physicsProxy.getRotation(this.joltBodyID);
      if (rot) this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

      // Detect ground contact: seed Y is within threshold of terrain surface
      const terrainY = getTerrainHeight(pos.x, pos.z);
      const groundThreshold = 0.5; // units above terrain to count as "on ground"
      const onGround = pos.y <= terrainY + groundThreshold;

      if (onGround && !this.hasLanded) {
        this.hasLanded = true;
        this._bounceCount++;

        if (callbacks.onLand) callbacks.onLand(this.mesh.position);

        // Check germination on every bounce — randomize density radius
        // so kelp patches form at variable densities (0.5× to 1.33× base)
        const germCfg = CONFIG.seedGermination;
        let chance = germCfg.baseChance;
        if (callbacks.getNearbyPlantCount) {
          const radius = germCfg.densityRadius * randomRange(0.5, 1.33);
          const nearby = callbacks.getNearbyPlantCount(this.mesh.position, radius);
          chance = Math.max(germCfg.minChance, chance - nearby * germCfg.densityPenalty);
        }
        if (this.forceGerminate || Math.random() < chance) {
          if (callbacks.onSpawnPlant) {
            // Snap plant to terrain surface, not mid-air
            const plantPos = this.mesh.position.clone();
            plantPos.y = terrainY;
            callbacks.onSpawnPlant(plantPos, this);
          }
          // Germinate: stop physics, start scale-up animation
          this.germinated = true;
          this._germScaleTimer = 0;
          this.mesh.position.y = terrainY + 0.1 * CONFIG.seedScale;
          debugColliders.remove(this);
          if (this.joltBodyID !== null && physicsProxy) {
            physicsProxy.removeBody(this.joltBodyID);
            this.joltBodyID = null;
          }
          return;
        }

        // Failed germination — bounce to a new position and try again.
        // Give the seed an upward + lateral impulse so it tumbles away.
        const maxBounces = 4;
        if (this._bounceCount < maxBounces && this.joltBodyID !== null) {
          // Bounce energy decays with each attempt
          const energy = 1.0 - (this._bounceCount / maxBounces) * 0.5;
          const lateralForce = 1.0 * energy;
          const upForce = 1.2 * energy;
          physicsProxy.addImpulse(
            this.joltBodyID,
            randomRange(-lateralForce, lateralForce),
            upForce,
            randomRange(-lateralForce, lateralForce)
          );
        }
      }

      // Reset hasLanded when seed rises above ground
      if (!onGround) {
        this.hasLanded = false;
      }

      // Seed exhausted all bounces without germinating — deactivate immediately
      if (onGround && this._bounceCount >= 4) {
        this.deactivate();
        return;
      }
    }

    // Safety net: deactivate seeds that lost their Jolt body but didn't germinate
    if (this.joltBodyID === null && !this.germinated) {
      this.deactivate();
      return;
    }
  }
}
