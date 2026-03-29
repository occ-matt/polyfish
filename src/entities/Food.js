import * as THREE from 'three';
import { PhysicsBody } from '../core/PhysicsBody.js';
import { randomRange, easeOutCubic } from '../utils/MathUtils.js';
import { createColorMaterial } from '../rendering/IBLMaterial.js';
import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../utils/Terrain.js';
import debugColliders from '../core/DebugColliders.js';

let physicsProxy = null;

/**
 * Create a stellated octahedron (plankton/radiolarian shape).
 * An octahedron with each face extruded into a spike.
 * @param {number} coreRadius — radius of the inner octahedron
 * @param {number} spikeLength — how far spikes extend beyond the core
 * @returns {THREE.BufferGeometry}
 */
export function createPlanktonGeometry(coreRadius = 0.12, spikeLength = 0.1) {
  // Octahedron vertices
  const r = coreRadius;
  const verts = [
    new THREE.Vector3( 0,  r,  0), // 0 top
    new THREE.Vector3( 0, -r,  0), // 1 bottom
    new THREE.Vector3( r,  0,  0), // 2 +X
    new THREE.Vector3(-r,  0,  0), // 3 -X
    new THREE.Vector3( 0,  0,  r), // 4 +Z
    new THREE.Vector3( 0,  0, -r), // 5 -Z
  ];

  // 8 faces of the octahedron (vertex indices, wound CCW from outside)
  const faces = [
    [0, 4, 2], [0, 2, 5], [0, 5, 3], [0, 3, 4], // top 4
    [1, 2, 4], [1, 5, 2], [1, 3, 5], [1, 4, 3], // bottom 4
  ];

  const positions = [];

  for (const [a, b, c] of faces) {
    const va = verts[a], vb = verts[b], vc = verts[c];

    // Face centroid → spike tip
    const center = new THREE.Vector3()
      .addVectors(va, vb).add(vc).divideScalar(3);
    const tip = center.clone().normalize().multiplyScalar(r + spikeLength);

    // Three sub-triangles: tip connects to each edge of the original face
    positions.push(
      va.x, va.y, va.z,  vb.x, vb.y, vb.z,  tip.x, tip.y, tip.z,
      vb.x, vb.y, vb.z,  vc.x, vc.y, vc.z,  tip.x, tip.y, tip.z,
      vc.x, vc.y, vc.z,  va.x, va.y, va.z,  tip.x, tip.y, tip.z,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Food — spawned by plants and player.
 * Floats in the water column as plankton-like particles.
 */
export class Food {
  /**
   * Set the PhysicsProxy to use for physics operations.
   */
  static setPhysicsProxy(proxy) {
    physicsProxy = proxy;
  }

  /**
   * @param {THREE.Object3D|null} modelMesh — pre-built mesh, or null for procedural plankton
   */
  constructor(modelMesh) {
    if (modelMesh) {
      this.mesh = modelMesh;
    } else {
      const geometry = createPlanktonGeometry(0.12, 0.1);
      const material = createColorMaterial(CONFIG.foodColor, { flatShading: true });
      this.mesh = new THREE.Mesh(geometry, material);
    }
    this.mesh.visible = false;
    this.mesh.position.set(0, -9999, 0); // Start underground so pool never flashes at origin
    // Remember the scale assigned by pool factory (from CONFIG.foodScale)
    this.poolScale = this.mesh.scale.x;

    this.body = new PhysicsBody();
    this.body.drag = 0.65;   // Unity Food.prefab drag
    this.body.mass = 0.6;    // Unity Food.prefab mass
    this.body.useGravity = false; // Food floats — no gravity
    this.active = false;
    this.held = false;
    this.lifetime = 0;
    this.maxLifetime = 30;
    // Spin velocity (radians/sec per axis)
    this.spinX = 0.5;
    this.spinZ = 0.3;

    // Jolt physics body for collisions with creatures/terrain
    this.joltBodyID = null;

    // Physics LOD — set each frame by SimulationSystem based on camera distance.
    // When false, food skips Jolt command writes and readback, using only
    // simple PhysicsBody integration.  Saves 2 SAB commands per distant food.
    this._useJolt = true;
  }

  activate(position, force, plantAgeFraction = 0) {
    this.active = true;
    this.held = false;
    // Set position BEFORE making visible to prevent 1-frame flash at origin
    this.body.position.copy(position);
    this.mesh.position.copy(position);
    this.mesh.visible = true;
    this.body.velocity.set(0, 0, 0);
    this.body.useGravity = false;
    this.lifetime = 0;
    // Older plants produce shorter-lived food: 100% lifespan at age 0, 30% at age 1
    const ageFactor = 1 - plantAgeFraction * 0.7;
    this.maxLifetime = randomRange(7.5, 15) * ageFactor;
    this.spawnTimer = 0;
    this.spawnDuration = 4.0;
    this.fadeOutDuration = 1.5; // scale down over last 1.5s of life

    // Slight random size variation around the mesh's pool-assigned scale
    const baseScale = this.poolScale || 1;
    this.targetScale = baseScale * randomRange(0.85, 1.15);
    this.mesh.scale.setScalar(0.01); // start tiny

    if (force) {
      this.body.addImpulse(force);
    }
    this.body.syncToMesh(this.mesh);

    // Jolt sphere collider — so food bounces off creatures and terrain
    this._createJoltBody(position);

    // Debug collider — sphere matching the food's visual radius
    debugColliders.addHull(this, this.targetScale * 0.25, 0x88ffaa);
  }

  /**
   * Activate as player-held food: faster spawn-in with bounce, infinite lifespan.
   */
  activateHeld(position) {
    this.activate(position, null);
    this.held = true;
    this.maxLifetime = Infinity;
    this.spawnDuration = 2.0; // 2x faster than normal (4s)
    this.fadeOutDuration = 0; // no fade-out
  }

  /**
   * Release from player hold — start normal lifespan from now.
   */
  release() {
    this.held = false;
    this.lifetime = 0;
    this.maxLifetime = randomRange(8, 15); // generous lifespan after throw
    this.fadeOutDuration = 1.5;
    // Big spin on throw
    this.spinX = randomRange(-12, 12);
    this.spinZ = randomRange(-12, 12);
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

  _createJoltBody(position) {
    if (!physicsProxy) return;
    // Clean up any existing body
    if (this.joltBodyID !== null) {
      physicsProxy.removeBody(this.joltBodyID);
      this.joltBodyID = null;
    }

    const radius = this.targetScale * 0.25; // generous collision radius for visible bouncing

    const slot = physicsProxy.createBody(
      { type: 'sphere', radius },
      { x: position.x, y: position.y, z: position.z },
      { x: 0, y: 0, z: 0, w: 1 },
      'dynamic',
      1,
      { mass: 0.1, restitution: 0.95, friction: 0.05, linearDamping: 0.4, angularDamping: 0.3, gravityFactor: 0 }
    );
    this.joltBodyID = slot >= 0 ? slot : null;
  }

  /**
   * Pre-step: push velocity/position to Jolt BEFORE physics step so
   * collision resolution uses current-frame data (eliminates 1-frame lag
   * that caused food-food overlap).
   */
  preStep(dt) {
    if (!this.active || this.joltBodyID === null || !physicsProxy) return;

    // Advance simple physics so velocity is current
    this.body.update(dt);

    // Physics LOD: distant food skips Jolt commands — simple physics only.
    if (!this._useJolt) return;

    if (this.held) {
      const p = this.body.position;
      physicsProxy.setPosition(this.joltBodyID, p.x, p.y, p.z, 0);
      physicsProxy.setLinearVelocity(this.joltBodyID, 0, 0, 0);
    } else {
      // Push BOTH velocity and position to Jolt before the step
      const v = this.body.velocity;
      const p = this.body.position;
      physicsProxy.setLinearVelocity(this.joltBodyID, v.x, v.y, v.z);
      physicsProxy.setPosition(this.joltBodyID, p.x, p.y, p.z, 0);
    }
  }

  update(dt) {
    if (!this.active) return;
    this.lifetime += dt;
    this.spawnTimer += dt;
    if (this.lifetime >= this.maxLifetime) {
      this.deactivate();
      return;
    }

    // Scale: spawn-in, then full size, then fade-out at end of life
    let scale = this.targetScale;
    if (this.spawnTimer < this.spawnDuration) {
      const t = Math.min(this.spawnTimer / this.spawnDuration, 1);
      if (this.held) {
        const p = 0.4;
        scale *= (Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1);
      } else {
        scale *= easeOutCubic(t);
      }
    }
    if (this.fadeOutDuration > 0) {
      const timeLeft = this.maxLifetime - this.lifetime;
      if (timeLeft < this.fadeOutDuration) {
        scale *= Math.max(0.01, timeLeft / this.fadeOutDuration);
      }
    }
    this.mesh.scale.setScalar(scale);

    // Read back collision-corrected position from Jolt (step already happened).
    // Physics LOD: distant food (_useJolt === false) skips readback — simple
    // physics position is already correct from preStep's body.update().
    if (this._useJolt && this.joltBodyID !== null && physicsProxy && !this.held) {
      const jPos = physicsProxy.getPosition(this.joltBodyID);
      this.body.position.set(jPos.x, jPos.y, jPos.z);
      // Also read back velocity — Jolt may have altered it from collisions
      const jVel = physicsProxy.getLinearVelocity?.(this.joltBodyID);
      if (jVel) this.body.velocity.set(jVel.x, jVel.y, jVel.z);
    }

    // When held in VR, the mesh is parented to a controller grip group.
    // The scene graph handles positioning automatically. Skip all world-space
    // mesh sync, terrain clamping, and rotation - they would overwrite the
    // local grip-space offset with world-space values, launching the food.
    if (this.held) return;

    // Clamp to surface
    if (this.body.position.y > CONFIG.surfaceY) {
      this.body.position.y = CONFIG.surfaceY;
      if (this.body.velocity.y > 0) this.body.velocity.y = 0;
    }

    // Clamp to terrain floor
    const floorY = getTerrainHeight(this.body.position.x, this.body.position.z) + 0.2;
    if (this.body.position.y < floorY) {
      this.body.position.y = floorY;
      if (this.body.velocity.y < 0) this.body.velocity.y = 0;
    }

    // Sync position to mesh
    this.mesh.position.copy(this.body.position);
    // Rotation
    this.mesh.rotation.x += dt * this.spinX;
    this.mesh.rotation.z += dt * this.spinZ;
    this.spinX += (0.5 - this.spinX) * dt * 2;
    this.spinZ += (0.3 - this.spinZ) * dt * 2;
  }

}
