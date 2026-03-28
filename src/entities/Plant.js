import * as THREE from 'three';
import { randomRange, easeOutCubic } from '../utils/MathUtils.js';
import { createColorMaterial } from '../rendering/IBLMaterial.js';
import { CONFIG } from '../config.js';
import { VerletChain } from '../core/VerletChain.js';
import debugColliders from '../core/DebugColliders.js';

/**
 * Plant — kelp entity eaten by manatees.
 *
 * Physics: Verlet soft-body chain — a lightweight position-based simulation
 * that replaces the previous Jolt ragdoll approach. Each plant has a chain
 * of Verlet nodes from base to tip. Distance and bend constraints keep the
 * chain rigid enough to stand, while procedural sway forces and creature
 * collisions make it flex naturally.
 *
 * Bones are driven directly from Verlet node positions: each bone's rotation
 * is computed by looking from node_i toward node_{i+1}. No Jolt bodies,
 * constraints, or WASM calls needed.
 */

const _swayForce = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _parentWorldQuat = new THREE.Quaternion();
const _boneWorldQuat = new THREE.Quaternion();
const _localQuat = new THREE.Quaternion();
const _spawnPos = new THREE.Vector3();
const _upForce = new THREE.Vector3();
const _growStartScale = new THREE.Vector3(0.01, 0.01, 0.01);
const _tempV1 = new THREE.Vector3(); // debug arrow direction scratch

// Temp objects for LOD 2 procedural sway (avoid per-frame allocation)
const _tempQuat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);

export class Plant {
  /**
   * @param {THREE.Object3D|null} modelMesh — pre-cloned kelp GLB scene, or null for placeholder
   */
  constructor(modelMesh) {
    if (modelMesh) {
      this.mesh = modelMesh;
      this.hasModel = true;
    } else {
      const geometry = new THREE.ConeGeometry(0.15, 2.0, 4);
      const material = createColorMaterial(0x33aa55, { flatShading: true });
      this.mesh = new THREE.Mesh(geometry, material);
      this.hasModel = false;
    }
    this.mesh.visible = false;
    // Save factory-set base scale before parking at near-zero
    this._baseScale = this.mesh.scale.x || 1;
    this.mesh.position.set(0, -9999, 0); // Start underground so pool never flashes at origin
    this.mesh.scale.set(0.001, 0.001, 0.001); // Near-zero scale so even stale matrixWorld is invisible
    this.active = false;

    // Grow animation state
    this.growTimer = 0;
    this.growDuration = 16.0; // Slow, natural grow-in
    this.targetScale = new THREE.Vector3(1, 1, 1);
    this.growing = false;

    // Per-plant phase offset for Verlet current variety
    this.swayOffset = 0;

    // Bones with their rest-pose quaternions
    /** @type {{ bone: THREE.Bone, restQuat: THREE.Quaternion }[]} */
    this.swayBones = [];

    // Health system — each bite deals 1 damage, plant scales with remaining health
    this.maxHealth = 4;
    this.health = this.maxHealth;

    // Smooth shrink interpolation state
    this._shrinking = false;
    this._shrinkFrom = null;
    this._shrinkTo = null;
    this._shrinkTimer = 0;
    this._shrinkDuration = 0.6;

    // Lifespan
    this.lifeTimer = 0;
    this.lifetime = 60;

    // Collision radius for creature interaction
    this.collisionRadius = CONFIG.plant.collisionRadius;

    // Verlet soft-body chain (replaces Jolt ragdoll)
    /** @type {VerletChain|null} */
    this._verlet = null;
    this._verletReady = false;

    // Cached stalk height for Verlet init
    this._stalkHeight = 0;

    // Reusable vector for midpoint calculation
    this._midpoint = new THREE.Vector3();

    // LOD (Level of Detail) system
    this.lod = 0; // 0=full, 1=medium, 2=low
    this._prevLod = 0; // Track previous LOD for transitions
    this._lodFrameCounter = 0; // Frame counter for skipping updates

    // All bones in skeleton order (root + sway) — exposed for instanced rendering
    /** @type {THREE.Bone[]|null} */
    this._allBones = null;
  }

  /**
   * Set LOD level for distance-based optimization.
   * @param {number} level - 0 (full), 1 (medium), 2 (low)
   */
  setLOD(level) {
    this.lod = Math.max(0, Math.min(2, level));
  }

  /**
   * Returns the world-space midpoint of the plant.
   * Uses a Verlet node at ~40% height for an accurate stalk position.
   */
  getMidpoint() {
    if (this._verlet && this._verletReady && this._verlet.nodeCount > 2) {
      const idx = Math.floor(this._verlet.nodeCount * 0.4);
      return this._midpoint.copy(this._verlet.pos[idx]);
    }
    const height = this.mesh.scale.y * 0.25;
    return this._midpoint.copy(this.mesh.position).setY(this.mesh.position.y + height);
  }

  /**
   * Returns a random node index in the lower-mid section (25–50% height).
   * Called once by manatees when they pick this plant as a target.
   */
  getGrazingNodeIndex() {
    if (this._verlet && this._verletReady && this._verlet.nodeCount > 2) {
      const lo = Math.floor(this._verlet.nodeCount * 0.25);
      const hi = Math.floor(this._verlet.nodeCount * 0.5);
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    }
    return 0;
  }

  /**
   * Returns the live world-space position of a Verlet node by index.
   * The returned reference is the actual node position (moves with sway).
   */
  getVerletNodePos(idx) {
    if (this._verlet && this._verletReady && idx > 0 && idx < this._verlet.nodeCount) {
      return this._verlet.pos[idx];
    }
    return this.getMidpoint();
  }

  activate(position) {
    this.active = true;
    // Position and orient before making visible
    this.mesh.position.copy(position);
    this.mesh.position.y += 0.25;
    this._linkedSeed = null; // cleared; set by spawnPlant() if seed-spawned

    // Y-spin for visual variety
    if (this.hasModel) {
      this.mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), randomRange(0, Math.PI * 2));
    } else {
      this.mesh.rotation.set(0, randomRange(0, Math.PI * 2), 0);
    }

    // Grow to the factory-set base scale with random variation.
    const variation = randomRange(0.5, 1.5);
    const finalScale = this._baseScale * variation;
    this.targetScale.set(finalScale, finalScale, finalScale);

    // Randomize phase offset for Verlet current variety
    this.swayOffset = randomRange(0, Math.PI * 2);

    // Gather bones and snapshot their rest-pose quaternions.
    this.swayBones = [];
    const allBones = [];
    this.mesh.traverse((child) => {
      if (child.isBone) allBones.push(child);
    });
    this._allBones = allBones;
    for (let i = 1; i < allBones.length; i++) {
      this.swayBones.push({
        bone: allBones[i],
        restQuat: allBones[i].quaternion.clone(),
      });
    }

    // Create Verlet chain at full target scale — mesh stays invisible during
    // this so the instanced renderer never sees the temporary full-size transform.
    this.mesh.scale.copy(this.targetScale);
    this.mesh.updateMatrixWorld(true);
    this._createVerletChain();

    // Now set the actual grow-start scale and make visible
    this.mesh.scale.set(0.01, 0.01, 0.01);
    this.mesh.updateMatrixWorld(true);
    this.mesh.visible = true;
    this.growTimer = 0;
    this.growing = true;

    this.foodTag = 'plant';

    // Health
    this.health = this.maxHealth;
    this.damageCooldown = 0;

    // Lifespan — randomized ±25%
    const plantCfg = CONFIG.plant;
    this.lifeTimer = 0;
    this.lifetime = plantCfg.minLifetime * randomRange(0.75, 1.25);

    // Food production
    this.foodTimer = 0;
    this.foodRate = randomRange(plantCfg.foodRateYoung, plantCfg.foodRateYoung + 1);
  }

  takeDamage() {
    if (this.damageCooldown > 0) return true;

    this.health--;
    this.damageCooldown = 2.0;

    if (this.health <= 0) {
      this.deactivate();
      return false;
    }

    // Smooth shrink — interpolate from current scale to new target over time
    const fraction = this.health / this.maxHealth;
    this._shrinkFrom = this.mesh.scale.clone();
    this._shrinkTo = this.targetScale.clone().multiplyScalar(fraction);
    this._shrinkTimer = 0;
    this._shrinkDuration = 0.6; // seconds to interpolate
    this._shrinking = true;
    return true;
  }

  deactivate() {
    this._verlet = null;
    this._verletReady = false;

    // Remove debug visualization
    if (this._debugLine) {
      this._debugLine.parent?.remove(this._debugLine);
      this._debugLine = null;
    }
    if (this._debugSpheres) {
      for (const s of this._debugSpheres) s.parent?.remove(s);
      this._debugSpheres = null;
    }
    if (this._debugArrows) {
      for (const arrows of this._debugArrows) {
        for (const a of arrows) a.parent?.remove(a);
      }
      this._debugArrows = null;
    }

    // Deactivate linked seed mesh (it was kept alive while plant was alive)
    if (this._linkedSeed) {
      this._linkedSeed.deactivate();
      this._linkedSeed = null;
    }

    this.active = false;
    this.mesh.visible = false;
    this.mesh.position.set(0, -9999, 0); // Move underground so reuse never flashes
    this.mesh.scale.set(0.001, 0.001, 0.001); // Near-zero so stale instance data is invisible
    this.growing = false;

    // Restore rest poses so the clone is clean for pool reuse
    for (const { bone, restQuat } of this.swayBones) {
      bone.quaternion.copy(restQuat);
    }
  }

  /**
   * @param {number} dt — delta time
   * @param {number} elapsed — total elapsed time for sway phase
   */
  update(dt, elapsed) {
    if (!this.active) return;

    // Damage cooldown
    if (this.damageCooldown > 0) this.damageCooldown -= dt;

    // Lifespan — age and die (ticks even during growth)
    if (!this.growing) {
      this.lifeTimer += dt;
      if (this.lifeTimer >= this.lifetime) {
        this.deactivate();
        return;
      }
    }

    // Food production — spawns from the moment the plant exists, slows with age
    this.foodTimer += dt;
    const plantCfg = CONFIG.plant;
    const ageFraction = this.growing ? 0 : Math.min(this.lifeTimer / this.lifetime, 1.0);
    const baseRate = plantCfg.foodRateYoung + ageFraction * (plantCfg.foodRateOld - plantCfg.foodRateYoung);
    if (this.foodTimer >= this.foodRate) {
      this.foodTimer = 0;
      this.foodRate = randomRange(baseRate, baseRate + 1);
      if (this._onProduceFood) {
        // Spawn food from the lower portion of the stalk (node 2 up to 33% height)
        // Node 0 is the anchor, node 1 is at the base — food starts from node 2+
        if (this._verlet && this._verletReady && this._verlet.nodeCount > 2) {
          const lo = 2; // skip anchor (node 0) and base (node 1)
          const hi = Math.max(lo, Math.floor(this._verlet.nodeCount * 0.33));
          const idx = lo + Math.floor(Math.random() * (hi - lo + 1));
          _spawnPos.copy(this._verlet.pos[Math.min(idx, this._verlet.nodeCount - 1)]);
        } else {
          _spawnPos.copy(this.mesh.position);
          _spawnPos.y += randomRange(0.2, 1.0);
        }
        _spawnPos.x += randomRange(-0.3, 0.3);
        _spawnPos.z += randomRange(-0.3, 0.3);
        _upForce.set(
          randomRange(-0.5, 0.5),
          randomRange(1, 3),
          randomRange(-0.5, 0.5)
        );
        this._onProduceFood(_spawnPos, _upForce, ageFraction);
      }
    }

    // Grow animation: ease-out from near-zero to target scale
    if (this.growing) {
      this.growTimer += dt;
      const t = Math.min(this.growTimer / this.growDuration, 1.0);
      const eased = easeOutCubic(t);
      this.mesh.scale.lerpVectors(
        _growStartScale,
        this.targetScale,
        eased
      );
      if (t >= 1.0) {
        this.growing = false;
        this.mesh.scale.copy(this.targetScale);
      }
    }

    // Smooth shrink interpolation (after damage)
    if (this._shrinking) {
      this._shrinkTimer += dt;
      const t = Math.min(this._shrinkTimer / this._shrinkDuration, 1.0);
      const eased = easeOutCubic(t); // ease-out cubic
      this.mesh.scale.lerpVectors(this._shrinkFrom, this._shrinkTo, eased);
      if (t >= 1.0) {
        this._shrinking = false;
        this.mesh.scale.copy(this._shrinkTo);
      }
    }

    // Verlet chain drives bones at all times (including during growth).
    // Bone rotations are scale-independent so this works at any mesh scale.
    if (this._verletReady) {
      this._updateVerlet(dt, elapsed);
    }

    // Plant meshes are NOT in the Three.js scene graph (removed for performance).
    // Manually bake world matrices so syncPlantInstances reads correct transforms.
    this.mesh.updateMatrixWorld(true);
  }

  /**
   * Drag Verlet nodes along with a creature swimming through (wrap effect).
   * @param {THREE.Vector3} creaturePos — world position of creature
   * @param {number} creatureRadius — creature's collision radius
   * @param {THREE.Vector3} creatureVel — creature's velocity vector
   */
  dragFrom(creaturePos, creatureRadius, creatureVel) {
    if (this._verlet && this._verletReady) {
      this._verlet.dragAlong(creaturePos, creatureRadius + this.collisionRadius, creatureVel, 0.4);
    }
  }

  // ── Verlet soft-body chain ──────────────────────────────────

  _createVerletChain() {
    if (this.swayBones.length === 0) return;

    // Ensure bones are at rest pose for clean rest-position computation.
    for (const { bone, restQuat } of this.swayBones) {
      bone.quaternion.copy(restQuat);
    }
    this.mesh.updateMatrixWorld(true);

    // Get world positions of all sway bones in their rest pose
    const boneWorldPositions = [];
    for (const { bone } of this.swayBones) {
      const wp = new THREE.Vector3();
      bone.getWorldPosition(wp);
      boneWorldPositions.push(wp);
    }

    // ── Compute the chain's actual "up" direction from the bone positions ──
    // The kelp mesh was built for Unity's coordinate system. After glTF export
    // and the Armature's +90°X, the bone chain may NOT align with world Y.
    // Instead of assuming Y-up, derive the stalk direction from the first and
    // last bone, then build the rest pose along that direction from the anchor.
    const anchorPos = new THREE.Vector3();
    this.mesh.getWorldPosition(anchorPos);

    const chainDir = new THREE.Vector3()
      .subVectors(boneWorldPositions[boneWorldPositions.length - 1], anchorPos)
      .normalize();

    // Compute total chain length from actual bone spacing
    let totalLen = anchorPos.distanceTo(boneWorldPositions[0]);
    for (let i = 0; i < boneWorldPositions.length - 1; i++) {
      totalLen += boneWorldPositions[i].distanceTo(boneWorldPositions[i + 1]);
    }
    this._stalkHeight = totalLen;

    // Chain has nodeCount = swayBones + 1 (anchor at base + one node per bone)
    const nodeCount = this.swayBones.length + 1;
    const segLen = totalLen / (nodeCount - 1);

    // Create Verlet chain
    const plantCfg = CONFIG.plant;
    // Randomize per-plant for natural variation in the kelp forest
    const inertia = 0.82 + Math.random() * 0.08;    // 0.82–0.90 (draggier = lazier, snappier = whippier)
    const ampVar = 0.6 + Math.random() * 0.25;      // 0.60–0.85
    const speedVar = 0.6 + Math.random() * 0.2;     // 0.60–0.80

    this._verlet = new VerletChain(nodeCount, {
      currentAmplitude: ampVar,  // randomized sway range
      currentSpeed: speedVar,    // randomized wave speed
      currentPhaseSpan: 4.0,     // phase shift base→tip — traveling-wave whip
      inertia,                   // randomized drag — lower = snappier
      impulseDecay: 0.88,        // impulses decay fast — crisp localized reactions
      impulseSpread: 0.2,        // low spread — hit stays local, neighbors get gentle falloff
      stiffness: 3,              // 3 constraint passes — rigid segments that pivot at joints
      compliance: 1.0,           // full correction — segments maintain rest length
      buoyancy: 0.35 + Math.random() * 0.1, // 0.35–0.45
      collisionRadius: plantCfg.collisionRadius,
    });

    // Initialize along the ACTUAL chain direction (not hardcoded Y-up).
    // This respects whatever orientation the Armature/bone hierarchy produces.
    this._verlet.init(anchorPos, chainDir, segLen);

    // Recompute rest lengths from actual bone spacing
    for (let i = 0; i < nodeCount - 1; i++) {
      this._verlet.restLengths[i] = this._verlet.pos[i].distanceTo(this._verlet.pos[i + 1]);
    }

    // Cache rest-pose chain directions and bone world rotations for the
    // bone-driving code. We need these to compute rotations RELATIVE to the
    // rest pose (not absolute), since the bone chain may not align with world Y.
    this._restChainDirs = [];
    this._restBoneWorldQuats = [];
    for (let i = 0; i < this.swayBones.length; i++) {
      // Rest direction from node_i to node_{i+1}
      const rA = this._verlet.restPos[i];
      const rB = this._verlet.restPos[i + 1];
      const rd = new THREE.Vector3().subVectors(rB, rA).normalize();
      this._restChainDirs.push(rd);

      // Bone's world quaternion in rest pose
      const wq = new THREE.Quaternion();
      this.swayBones[i].bone.getWorldQuaternion(wq);
      this._restBoneWorldQuats.push(wq);
    }

    this._verletReady = true;

    // Debug visualization is created lazily — only when debug colliders are
    // toggled on — to avoid adding 50+ scene objects per plant at spawn time.
    // With 400+ plants that would be 20,000+ objects crippling the renderer.
  }

  _createDebugVis() {
    if (!this._verlet) return;
    if (this._debugLine) return; // already created
    const nc = this._verlet.nodeCount;

    // Line connecting all nodes
    const lineGeo = new THREE.BufferGeometry();
    const linePos = new Float32Array(nc * 3);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2, depthTest: false });
    this._debugLine = new THREE.Line(lineGeo, lineMat);
    this._debugLine.renderOrder = 999;
    this._debugLine.frustumCulled = false;
    this._debugLine.visible = debugColliders.enabled;
    this.mesh.parent?.add(this._debugLine);

    // Small spheres at each node
    const sphereGeo = new THREE.SphereGeometry(0.12, 6, 4);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, depthTest: false });
    this._debugSpheres = [];
    for (let i = 0; i < nc; i++) {
      const s = new THREE.Mesh(sphereGeo, i === 0 ? new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true, depthTest: false }) : sphereMat);
      s.renderOrder = 999;
      s.frustumCulled = false;
      s.visible = debugColliders.enabled;
      this.mesh.parent?.add(s);
      this._debugSpheres.push(s);
    }

    // Force arrows per node (skip anchor node 0)
    // Colors: cyan=current, yellow=spring, green=buoyancy, red=impulse
    const forceColors = [0x00ddff, 0xffdd00, 0x44ff44, 0xff4444];
    this._debugArrows = []; // [nodeIndex][forceType] = ArrowHelper
    const parent = this.mesh.parent;
    const defaultDir = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < nc; i++) {
      const arrows = [];
      for (let f = 0; f < 4; f++) {
        const arrow = new THREE.ArrowHelper(defaultDir, new THREE.Vector3(), 0.1, forceColors[f], 0.06, 0.04);
        arrow.renderOrder = 999;
        arrow.visible = false;
        parent?.add(arrow);
        arrows.push(arrow);
      }
      this._debugArrows.push(arrows);
    }
  }

  _updateDebugVis() {
    if (!this._verlet) return;
    const show = debugColliders.enabled;

    // Lazy creation — only build debug objects when debug mode is first enabled
    if (show && !this._debugLine) {
      this._createDebugVis();
    }
    if (!this._debugLine) return;
    this._debugLine.visible = show;

    // Enable/disable force recording on the chain
    this._verlet.debugForces = show;

    const posArr = this._debugLine.geometry.attributes.position.array;
    const _dir = _tempV1;
    for (let i = 0; i < this._verlet.nodeCount; i++) {
      const p = this._verlet.pos[i];
      posArr[i * 3] = p.x;
      posArr[i * 3 + 1] = p.y;
      posArr[i * 3 + 2] = p.z;
      if (this._debugSpheres && this._debugSpheres[i]) {
        this._debugSpheres[i].position.copy(p);
        this._debugSpheres[i].visible = show;
      }

      // Update force arrows
      if (this._debugArrows && this._debugArrows[i]) {
        const forces = [
          this._verlet.dbgCurrent[i],
          this._verlet.dbgSpring[i],
          this._verlet.dbgBuoyancy[i],
          this._verlet.dbgImpulse[i],
        ];
        for (let f = 0; f < 4; f++) {
          const arrow = this._debugArrows[i][f];
          if (!show || i === 0) {
            arrow.visible = false;
            continue;
          }
          const force = forces[f];
          const len = force.length();
          if (len < 0.005) {
            arrow.visible = false;
            continue;
          }
          arrow.visible = true;
          arrow.position.copy(p);
          _dir.copy(force).normalize();
          arrow.setDirection(_dir);
          arrow.setLength(Math.min(len, 2.0), 0.06, 0.04);
        }
      }
    }
    this._debugLine.geometry.attributes.position.needsUpdate = true;
  }

  _updateVerlet(dt, elapsed) {
    if (!this._verlet) return;
    const time = elapsed || 0;

    // ── Handle LOD transitions ──
    // When transitioning from LOD 2 (procedural) to LOD 0/1 (Verlet), reset
    // Verlet chain positions to match current bone positions for smooth handoff
    if (this._prevLod === 2 && this.lod !== 2) {
      this._resetVerletToCurrent();
    }
    this._prevLod = this.lod;

    // ── LOD-based Verlet simulation ──
    if (this.lod === 2) {
      // LOD 2 (far): Skip Verlet entirely. Use cheap procedural sin-wave sway.
      this._applyProceduralSway(elapsed);
    } else {
      // LOD 0 (close) or LOD 1 (medium): Use Verlet simulation with optional frame skipping
      let shouldUpdate = false;
      let iterationCount = this._verlet.stiffness;

      if (this.lod === 0) {
        // Full detail: update every frame, full constraint iterations
        shouldUpdate = true;
        iterationCount = this._verlet.stiffness;
      } else if (this.lod === 1) {
        // Medium detail: update every 2nd frame, reduced constraint iterations
        shouldUpdate = (this._lodFrameCounter % 2) === 0;
        iterationCount = 1; // Reduce from 3 to 1 iteration
      }

      this._lodFrameCounter++;

      if (shouldUpdate) {
        // Step Verlet with optional reduced constraint iterations
        const clampedDt = Math.min(dt, 1 / 30);
        this._verlet.update(clampedDt, time, this.swayOffset, iterationCount);
      }

      // Drive bones from Verlet node positions (for both LOD 0 and 1)
      this._driveBoneFromVerlet();
    }

    // Update debug visualization
    this._updateDebugVis();
  }

  /**
   * Apply cheap procedural sway to bones without Verlet simulation.
   * Used for LOD 2 (far plants) to reduce CPU cost.
   * @param {number} elapsed — total elapsed time
   */
  _applyProceduralSway(elapsed) {
    for (let i = 0; i < this.swayBones.length; i++) {
      const { bone, restQuat } = this.swayBones[i];

      // Start from rest pose
      bone.quaternion.copy(restQuat);

      // Apply simple sin-wave sway: oscillate around Z-axis
      // Parameters: 0.5 = sway frequency, 0.3 offset per bone, 0.08 = max angle
      const angle = Math.sin(elapsed * 0.5 + this.swayOffset + i * 0.3) * 0.08;
      _tempQuat.setFromAxisAngle(_zAxis, angle);
      bone.quaternion.multiply(_tempQuat);
    }
  }

  /**
   * Reset Verlet chain node positions to match current bone positions.
   * Called when transitioning from LOD 2 (procedural) back to LOD 0/1 (Verlet).
   */
  _resetVerletToCurrent() {
    if (!this._verlet) return;

    for (let i = 0; i < this.swayBones.length; i++) {
      const { bone } = this.swayBones[i];
      const wp = new THREE.Vector3();
      bone.getWorldPosition(wp);
      this._verlet.pos[i + 1].copy(wp);
      this._verlet.prev[i + 1].copy(wp);
    }
  }

  /**
   * Drive bone rotations from current Verlet node positions.
   * Each bone i maps to the segment from node_i to node_{i+1}.
   */
  _driveBoneFromVerlet() {
    for (let i = 0; i < this.swayBones.length; i++) {
      const { bone } = this.swayBones[i];
      const nodeA = this._verlet.pos[i];
      const nodeB = this._verlet.pos[i + 1];

      // Current chain direction for this segment
      _dir.subVectors(nodeB, nodeA);
      if (_dir.lengthSq() < 0.0001) _dir.copy(this._restChainDirs[i]);
      _dir.normalize();

      // Delta rotation: from rest direction → current direction
      _quat.setFromUnitVectors(this._restChainDirs[i], _dir);

      // New bone world rotation = delta * restBoneWorldQuat
      _boneWorldQuat.copy(_quat).multiply(this._restBoneWorldQuats[i]);

      // Convert to bone-local: local = inverse(parentWorld) * boneWorld
      if (bone.parent) {
        bone.parent.getWorldQuaternion(_parentWorldQuat);
        _localQuat.copy(_parentWorldQuat).invert().multiply(_boneWorldQuat);
      } else {
        _localQuat.copy(_boneWorldQuat);
      }

      bone.quaternion.copy(_localQuat);
    }
  }
}
