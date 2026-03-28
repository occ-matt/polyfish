import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { randomRange, randomInsideSphere, easeOutCubic } from '../utils/MathUtils.js';
import { PhysicsBody } from '../core/PhysicsBody.js';
import { applySwimMaterial, updateSwimUniforms } from '../rendering/SwimMaterial.js';
import { checkTerrainCollision, getTerrainHeight } from '../utils/Terrain.js';
import { getMacroWaveHeight } from '../utils/WaveUtils.js';
import { LAYER_MOVING } from '../core/JoltWorld.js';
import debugColliders from '../core/DebugColliders.js';

// Module-level physics proxy reference — set via static method
let physicsProxy = null;

// Debug logging flag — set to true to re-enable verbose console output
const DEBUG_LOG = false;

// Swim animation feature flag (ON for all platforms, toggle with ?useSwim=0)
const _useSwim = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('useSwim')) return params.get('useSwim') !== '0';
  return true;
})();

// Module-level temp objects to avoid per-frame allocations.
// Safe because these are only used within single synchronous method calls.
const _direction = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _negDir = new THREE.Vector3();
const _lookMatrix = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _thrust = new THREE.Vector3();
const _burst = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _wastePos = new THREE.Vector3();
const _prevForward = new THREE.Vector3();
const _currForward = new THREE.Vector3();
const _bankQuat = new THREE.Quaternion();
const _bankEuler = new THREE.Euler();
const _mouthPos = new THREE.Vector3();
const _separationHashResults = []; // Pre-allocated array for spatial hash queries in _applySeparation
const _fleeHashResults = []; // Pre-allocated array for spatial hash queries in updateFlee
const _eatHashResults = []; // Pre-allocated array for spatial hash queries in checkEating

export class Creature {
  constructor(mesh, creatureType = 'fish') {
    const cfg = CONFIG.creatures[creatureType];
    this.type = creatureType;
    this.mesh = mesh;
    this.mesh.position.set(0, -9999, 0); // Start underground so pool never flashes at origin
    this.cfg = cfg;
    this.active = false;

    // Physics
    this.body = new PhysicsBody();
    this.body.drag = cfg.drag;
    this.body.mass = cfg.mass;
    this.body.angularDrag = cfg.angularDrag || 0.5;

    // AI state
    this.speed = cfg.speed * randomRange(0.8, 1.2);
    this.lookTime = cfg.lookTime;
    this.foodTarget = null;
    this.lastPlantEaten = null; // Avoid re-targeting the same plant consecutively
    this.reproFoodCounter = 1;
    this.wasteCounter = 0;
    this.eatCooldown = 0;
    this.reproCooldown = 0;
    this.offspringCount = 0;
    this.dead = false;

    // Predator avoidance state
    this.fleeTarget = null;      // Nearest predator to flee from
    this.isFleeing = false;      // True when actively fleeing from predator

    // Dash mechanic — occasional speed burst toward food
    this._isDashing = false;     // True when actively dashing
    this._dashTimer = 0;         // Time remaining in current dash
    this._dashCooldown = 0;      // Time remaining before next dash can trigger

    // Engine burn cycle — controls animation intensity & food-finding cadence.
    // Thrust is always applied (continuous force); enginesOn modulates throttle level.
    this.enginesOn = false;
    this.engineTimer = 0;
    this.engineBurnDuration = cfg.engineBurnTime;
    this.engineCooldown = 0;
    this.needsNewTarget = true; // Find food after each engine cycle, not every frame
    this._throttle = 0.4;       // Smooth throttle: 0.4 = idle, up to 1.0 = full thrust
    this._targetThrottle = 0.7; // AI-set throttle target, smoothed per-frame into _throttle
    this._sprinting = false;     // True when locked-on sprint burst is active
    this._sprintHoldTimer = 0;   // Keeps sprint going briefly after eating
    this._killSprintCooldown = 0; // Cooldown between killing sprints
    this._stamina = 1.0;         // 0–1 sprint stamina gauge
    this._staminaExhausted = false; // True when stamina bottomed out, clears at recovery threshold

    // Lifetime
    this.lifeTimer = 0;
    this.lifetime = cfg.minLifetime * randomRange(1.0, 1.5);

    // Metabolism
    this.metabolism = cfg.startingMetabolism * randomRange(0.75, 1.5);
    this.energyRate = cfg.energyUsedPerMinute * randomRange(0.75, 1.5);
    this.metabolismTimer = 0;

    // Spawn scale-in
    this.spawnTimer = 0;
    this.spawnDuration = 4.0;

    // Oxygen (dolphins only — config-gated)
    this._oxygen = 1.0;           // 0–1 gauge
    this._needsAir = false;       // True when heading to surface for air
    this._breathingAtSurface = false; // True when at surface and inhaling
    this._lastFeedPos = new THREE.Vector3();  // XZ of last feeding spot
    this._breathTarget = null;                // Lateral-offset surface target

    // Turn banking
    this.turnRate = 0;          // current smoothed yaw rate (rad/sec)
    this.bankAngle = 0;         // current smoothed bank roll (radians)
    this.maxBankAngle = 0.6;    // max roll in radians (~34°)
    this._lastForward = new THREE.Vector3(0, 0, 1);

    // Vertex shader swim animation data
    this.swimData = null;

    // Death state
    this.originalMaterials = [];
    this.deathMaterial = null;

    // Jolt physics body
    this.joltBodyID = null;

    // Debug visualization
    this._debugSphere = null;
    this._debugLine = null;
    this._debugScene = null;

    // LOD (Level of Detail) system
    this.lod = 0; // 0=full, 1=medium, 2=low
    this._lodFindFoodCounter = 0; // Frame counter for findFood frequency reduction
  }

  /**
   * Set the physics proxy for all Creature instances.
   * Called during scene initialization before any creatures are spawned.
   */
  static setPhysicsProxy(proxy) {
    physicsProxy = proxy;
  }

  activate(position) {
    this.active = true;
    this.dead = false;

    // Ensure spawn position is above terrain surface
    const terrain = checkTerrainCollision(position.x, position.y, position.z);
    if (terrain.grounded) {
      position.y = terrain.surfaceY + 1.0; // at least 1m above ground
    }

    // Set mesh position BEFORE making visible to prevent 1-frame flash at origin
    this.body.position.copy(position);
    this.mesh.position.copy(position);
    this.mesh.visible = true;
    this.body.velocity.set(0, 0, 0);
    this.body.useGravity = false;
    this.body.frozen = false;
    this.reproFoodCounter = 1;
    this.wasteCounter = 0;
    this.eatCooldown = 0;
    this.reproCooldown = 0;
    this.offspringCount = 0;
    this.lastPlantEaten = null;
    this.lifeTimer = 0;
    this.metabolismTimer = 0;
    this.metabolism = this.cfg.startingMetabolism * randomRange(0.75, 1.5);
    this.enginesOn = false;
    this.engineTimer = 0;
    this.engineCooldown = randomRange(0.5, 2.0);
    this.needsNewTarget = true;
    this._throttle = 0.2; // Start slow, ramp up as creature finds food
    this._sprinting = false;
    this._sprintHoldTimer = 0;
    this._killSprintCooldown = 0;
    this._stamina = 1.0;
    this._staminaExhausted = false;
    this._isDashing = false;
    this._dashTimer = 0;
    this._dashCooldown = 0;
    this.fleeTarget = null;
    this.isFleeing = false;
    this._baseSpeed = this.cfg.speed;
    this.speed = this.cfg.speed * randomRange(0.8, 1.2);
    this.lifetime = this.cfg.minLifetime * randomRange(1.0, 1.5);
    this.spawnTimer = 0;
    this._oxygen = 1.0;
    this._needsAir = false;
    this._breathingAtSurface = false;
    this._lastFeedPos.set(0, 0, 0);
    this._breathTarget = null;
    this.turnRate = 0;
    this.bankAngle = 0;
    this._lastForward.set(0, 0, 1);
    this.mesh.scale.setScalar(0.01); // start tiny, scale up over spawnDuration
    this._lastGrowthScale = 1; // collider starts at base scale; resized on eat

    if (DEBUG_LOG) console.log(`[${this.type}] Spawned: metabolism=${this.metabolism.toFixed(1)}, energyRate=${this.energyRate.toFixed(1)}/min, tickEvery=${this.cfg.metabolicClock}s, drain/tick=${(this.energyRate * this.cfg.metabolicClock / 60).toFixed(1)}, lifetime=${this.lifetime.toFixed(1)}s`);

    // Restore materials first, THEN apply swim shader — otherwise restoreMaterials
    // overwrites the onBeforeCompile patch and the fish doesn't animate.
    this.restoreMaterials();

    // Setup vertex shader swim animation (replaces bone-based ProceduralRotation)
    if (_useSwim) {
      this.swimData = applySwimMaterial(this.mesh, this.type);
      this._swimPhase = 0; // Reset phase for clean start
    } else {
      this.swimData = null;
      this._swimPhase = 0;
    }
    this.body.syncToMesh(this.mesh);

    // Create Jolt ragdoll (or single capsule fallback)
    // Jolt capsule created after spawn scale-in completes (in update())
  }

  deactivate() {
    this.active = false;
    this.mesh.visible = false;
    // Move mesh far off-screen to prevent any stale-frame flash from pool reuse
    this.mesh.position.set(0, -9999, 0);
    this.swimData = null;

    // Remove debug collider visual
    debugColliders.remove(this);

    // Remove debug target/line/mouth objects from scene
    if (this._debugSphere) {
      this._debugScene?.remove(this._debugSphere);
      this._debugSphere = null;
    }
    if (this._debugLine) {
      this._debugScene?.remove(this._debugLine);
      this._debugLine = null;
    }
    if (this._debugMouth) {
      this._debugScene?.remove(this._debugMouth);
      this._debugMouth = null;
    }
    this._debugScene = null;

    // Remove physics body
    if (this.joltBodyID !== null && physicsProxy) {
      physicsProxy.removeBody(this.joltBodyID);
    }
    this.joltBodyID = null;
  }

  /**
   * Set LOD level for distance-based optimization.
   * @param {number} level - 0 (full), 1 (medium), 2 (low)
   */
  setLOD(level) {
    this.lod = Math.max(0, Math.min(2, level));
  }

  /**
   * Current spawn scale factor (0→1 over spawnDuration, ease-out).
   */
  getSpawnScale() {
    if (this.spawnTimer >= this.spawnDuration) return 1;
    const t = Math.min(this.spawnTimer / this.spawnDuration, 1);
    return easeOutCubic(t);
  }

  /**
   * Apply the correct visual scale, combining base, growth, and spawn factors.
   */
  _applyScale() {
    const growthScale = (this.reproFoodCounter / this.cfg.foodToReproduce) + 1;
    this.mesh.scale.setScalar(this.cfg.scale * growthScale * this.getSpawnScale());

    // Resize the physics collider to match the new visual scale (skip if unchanged)
    if (this.joltBodyID !== null && growthScale !== this._lastGrowthScale) {
      this._lastGrowthScale = growthScale;
      this._resizeCapsule(growthScale);
    }
  }

  /**
   * Re-read behavioral params from CONFIG after runtime edits.
   * Call this on all active creatures after changing CONFIG.creatures[type].
   * Physics params (mass, drag, capsule) require rebuildPhysicsBody() separately.
   */
  refreshFromConfig() {
    const cfg = this.cfg;
    // Preserve the per-creature random variation factor
    const speedVariation = this.speed / (this._baseSpeed || cfg.speed);
    this._baseSpeed = cfg.speed;
    this.speed = cfg.speed * speedVariation;
  }

  /**
   * Rebuild physics body from current CONFIG values.
   * Call this after modifying CONFIG.creatures[type] physics params
   * (mass, drag, capsuleRadius, etc.) at runtime.
   */
  rebuildPhysicsBody() {
    if (!physicsProxy || this.joltBodyID === null) return;
    const growthScale = this._lastGrowthScale || 1;
    this._resizeCapsule(growthScale);
  }

  /**
   * Destroy and recreate the Jolt capsule with a fatter radius for growthScale.
   * Half-height stays fixed so the collider doesn't extend past the head/tail.
   * Preserves position, rotation, and velocity from the old body.
   */
  _resizeCapsule(growthScale) {
    if (!physicsProxy || this.joltBodyID === null) return;
    const cfg = this.cfg;

    // Read current state from old body
    const pos = physicsProxy.getPosition(this.joltBodyID);
    const rot = physicsProxy.getRotation(this.joltBodyID);
    const vel = physicsProxy.getLinearVelocity(this.joltBodyID);

    // Destroy old body and debug visual
    debugColliders.remove(this);
    physicsProxy.removeBody(this.joltBodyID);
    this.joltBodyID = null;

    // Radius grows with the creature; half-height stays at base config size.
    const worldRadius = cfg.capsuleRadius * 2 * growthScale;
    const worldHalfHeight = cfg.capsuleHalfHeight * 2;
    const newSlot = physicsProxy.createBody(
      { type: 'capsule', halfHeight: worldHalfHeight, radius: worldRadius },
      pos,
      { x: 0.7071068, y: 0, z: 0, w: 0.7071068 },
      'dynamic',
      LAYER_MOVING,
      {
        mass: cfg.mass,
        restitution: 0.1,
        friction: 0.3,
        linearDamping: cfg.drag,
        angularDamping: cfg.angularDrag,
      }
    );
    this.joltBodyID = newSlot >= 0 ? newSlot : null;

    // Restore velocity
    if (this.joltBodyID !== null) physicsProxy.setLinearVelocity(this.joltBodyID, vel.x, vel.y, vel.z);

    this.body.externalPosition = !!this.joltBodyID;

    // Recreate debug collider with new dimensions
    debugColliders.addCapsule(this, worldHalfHeight, worldRadius, 0xff4444, { x: Math.PI / 2, y: 0, z: 0 });
  }

  _createSingleCapsule(position) {
    if (!physicsProxy) return;
    const cfg = this.cfg;

    // Radius scaled by 2x (reduces interpenetration) and by growth.
    // Half-height uses config value. Capsule is shifted backward by mouthOffset
    // so the front doesn't extend past the mouth trigger.
    const growthScale = (this.reproFoodCounter / this.cfg.foodToReproduce) + 1;
    this._lastGrowthScale = growthScale;
    const worldRadius = cfg.capsuleRadius * 2 * growthScale;
    const worldHalfHeight = cfg.capsuleHalfHeight * 2;
    const slot = physicsProxy.createBody(
      { type: 'capsule', halfHeight: worldHalfHeight, radius: worldRadius },
      { x: position.x, y: position.y, z: position.z },
      { x: 0.7071068, y: 0, z: 0, w: 0.7071068 },
      'dynamic',
      LAYER_MOVING,
      {
        mass: cfg.mass,
        restitution: 0.1,
        friction: 0.3,
        linearDamping: cfg.drag,
        angularDamping: cfg.angularDrag,
      }
    );
    this.joltBodyID = slot >= 0 ? slot : null;

    // Physics proxy manages position — tell PhysicsBody to skip position integration
    this.body.externalPosition = !!this.joltBodyID;

    // Debug collider — capsule rotated 90° on X to match the physics body orientation
    debugColliders.addCapsule(this, worldHalfHeight, worldRadius, 0xff4444, { x: Math.PI / 2, y: 0, z: 0 });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // updateAI — called at fixed 10 Hz from staggered groups in main.js.
  // Handles decisions, timers, hash-based queries (eating, separation, food
  // finding). Heavy work that doesn't need per-frame precision.
  // ═══════════════════════════════════════════════════════════════════════════
  updateAI(dt, targets, callbacks = {}) {
    if (!this.active || this.dead) return;

    // Lifetime
    this.lifeTimer += dt;
    if (this.lifeTimer >= this.lifetime) {
      if (DEBUG_LOG) console.log(`[${this.type}] ★ OLD AGE at ${this.lifeTimer.toFixed(1)}s (max ${this.lifetime.toFixed(1)}s), metabolism was ${this.metabolism.toFixed(1)}`);
      this.die(callbacks);
      return;
    }

    // Metabolism — fleeing burns energy at 2× rate
    if (this.cfg.hasMetabolism) {
      this.metabolismTimer += dt;
      if (this.metabolismTimer >= this.cfg.metabolicClock) {
        const fleeMultiplier = this.isFleeing ? 2.0 : 1.0;
        const drain = this.energyRate * (this.cfg.metabolicClock / 60) * fleeMultiplier;
        this.metabolismTimer = 0;
        this.metabolism -= drain;
        if (DEBUG_LOG) console.log(`[${this.type}] Metabolism tick: -${drain.toFixed(1)} → ${this.metabolism.toFixed(1)} remaining (life: ${this.lifeTimer.toFixed(1)}s)`);
        if (this.metabolism <= 0) {
          if (DEBUG_LOG) console.log(`[${this.type}] ★ STARVED (metabolism depleted at ${this.lifeTimer.toFixed(1)}s)`);
          this.die(callbacks);
          return;
        }
      }
    }

    // ── Oxygen system (dolphins) ──
    const o2cfg = this.cfg.oxygen;
    if (o2cfg) {
      this._updateOxygen(dt, o2cfg);
    }

    // ── Food finding ──
    // Flee state is set externally by batch flee pass in main.js.
    // AI just needs to decide what to do when not fleeing.
    if (!this._needsAir && !this.isFleeing) {
      if (this.needsNewTarget) {
        this.needsNewTarget = false;
        this.findFood(targets, callbacks);
        if (this.dead) return; // findFood may have killed us (starvation)
      }
    }

    // ── Engine cadence timer — triggers new food search ──
    this.engineTimer += dt;
    if (this.engineTimer >= this.cfg.engineBurnTime * randomRange(1.5, 3.0)) {
      this.engineTimer = 0;
      // Plant eaters (manatees) lock onto a specific verlet node — don't
      // re-search while the current plant target is still valid, otherwise
      // they keep switching nodes right before reaching one.
      const _ce = CONFIG.foodChain[this.type];
      const keepPlantTarget = _ce && _ce.eatCategory === 'plant'
        && this.foodTarget && this.foodTarget.active && !this.foodTarget.dead;
      if (!keepPlantTarget) {
        this.needsNewTarget = true;
      }
    }

    // ── Throttle decision (what speed to aim for) ──
    this._updateThrottleDecision(dt);

    // ── Separation: push away from same-type neighbors ──
    if (targets?.creatureHash) {
      this._applySeparation(targets.creatureHash);
    }

    // ── Cooldowns ──
    if (this.eatCooldown > 0) this.eatCooldown -= dt;
    if (this.reproCooldown > 0) this.reproCooldown -= dt;

    // ── Eating check (uses spatial hash) ──
    if (this.eatCooldown <= 0) {
      this.checkEating(targets, callbacks);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // updateMotion — called every frame for smooth visuals.
  // Handles rotation slerps, force application, physics integration,
  // mesh sync, banking, swim animation. No hash queries — very cheap.
  // ═══════════════════════════════════════════════════════════════════════════
  updateMotion(dt, elapsed = 0) {
    if (!this.active || this.dead) return;

    // Spawn scale-in
    if (this.spawnTimer < this.spawnDuration) {
      this.spawnTimer += dt;
      this._applyScale();
    } else if (!this.joltBodyID) {
      this._createSingleCapsule(this.body.position);
    }

    // ── Drop stale food target (dead or deactivated) — triggers immediate re-search ──
    if (this.foodTarget && (this.foodTarget.dead || !this.foodTarget.active)) {
      this.foodTarget = null;
      this.needsNewTarget = true;
    }

    // ── Steering rotation (smooth slerps — must be per-frame) ──
    const o2cfg = this.cfg.oxygen;
    if (this._needsAir) {
      this._navigateToSurface(dt, o2cfg, elapsed);
    } else if (this.isFleeing) {
      this.fleeFromPredator(dt);
    } else if (this.foodTarget) {
      this.faceTarget(dt);
    }

    // ── Engine force application (uses stored _throttle from AI tick) ──
    this._applyEngineForce(dt);

    // ── Soft boundary (cheap — no hash queries) ──
    this.enforceBoundary();

    // ── Physics read → integrate → write ──
    if (this.joltBodyID !== null && physicsProxy) {
      const jPos = physicsProxy.getPosition(this.joltBodyID);
      this.body.position.set(jPos.x, jPos.y, jPos.z);
    }

    this.body.update(dt);

    if (this.joltBodyID !== null && physicsProxy) {
      const v = this.body.velocity;
      physicsProxy.setLinearVelocity(this.joltBodyID, v.x, v.y, v.z);
    }

    // Hard clamp — nothing above water surface
    if (this.body.position.y > CONFIG.surfaceY) {
      this.body.position.y = CONFIG.surfaceY;
      if (this.body.velocity.y > 0) this.body.velocity.y = 0;
      if (this.joltBodyID !== null && physicsProxy) {
        const p = this.body.position;
        physicsProxy.setPosition(this.joltBodyID, p.x, p.y, p.z, 0);
        physicsProxy.setLinearVelocity(this.joltBodyID, this.body.velocity.x, 0, this.body.velocity.z);
      }
    }

    // Hard clamp — nothing below terrain surface
    const terrainY = getTerrainHeight(this.body.position.x, this.body.position.z);
    const terrainMargin = (this.cfg.capsuleRadius || 0.2) + 0.3;
    if (this.body.position.y < terrainY + terrainMargin) {
      this.body.position.y = terrainY + terrainMargin;
      if (this.body.velocity.y < 0) this.body.velocity.y = 0;
      if (this.joltBodyID !== null && physicsProxy) {
        const p = this.body.position;
        physicsProxy.setPosition(this.joltBodyID, p.x, p.y, p.z, 0);
        physicsProxy.setLinearVelocity(this.joltBodyID, this.body.velocity.x, 0, this.body.velocity.z);
      }
    }

    this.body.syncToMesh(this.mesh);

    // ── Turn banking (LOD 0 only) ──
    if (this.lod === 0) {
      _currForward.set(0, 0, 1).applyQuaternion(this.body.rotation);
      _currForward.y = 0;
      _currForward.normalize();
      _prevForward.copy(this._lastForward);
      _prevForward.y = 0;
      _prevForward.normalize();

      if (_prevForward.lengthSq() > 0.001 && _currForward.lengthSq() > 0.001 && dt > 0) {
        const cross = _prevForward.x * _currForward.z - _prevForward.z * _currForward.x;
        const dot = _prevForward.x * _currForward.x + _prevForward.z * _currForward.z;
        const angle = Math.atan2(cross, dot);
        const rawTurnRate = angle / dt;
        this.turnRate += (rawTurnRate - this.turnRate) * Math.min(1, 5 * dt);
      }
      this._lastForward.set(0, 0, 1).applyQuaternion(this.body.rotation);

      const targetBank = -Math.max(-this.maxBankAngle, Math.min(this.maxBankAngle,
        this.turnRate * 0.15));
      this.bankAngle += (targetBank - this.bankAngle) * Math.min(1, 4 * dt);

      if (Math.abs(this.bankAngle) > 0.001) {
        _bankEuler.set(0, 0, this.bankAngle);
        _bankQuat.setFromEuler(_bankEuler);
        this.mesh.quaternion.multiply(_bankQuat);
      }
    }

    // ── Swim animation (LOD 0-1 only) ──
    if (this.swimData && this.lod < 2) {
      const speed = this.body.velocity.length();
      const maxSpeed = this.speed * 2;
      const intensity = Math.min(1, speed / maxSpeed);
      const isThrusting = this.enginesOn;

      if (this._swimPhase === undefined) this._swimPhase = 0;
      const config = this.swimData.config;

      const thrust = this.swimData._smoothThrust ?? 0;
      const effectiveSpeed = config.idleSpeed + thrust * (config.thrustSpeed - config.idleSpeed);

      this._swimPhase += effectiveSpeed * dt;

      updateSwimUniforms(this.swimData, this._swimPhase, intensity, isThrusting);
    }
  }

  findFood(targets, callbacks) {
    let searchList = null;
    let useSpatialHash = false;

    const chainEntry = CONFIG.foodChain[this.type];
    const eatCategory = chainEntry ? chainEntry.eatCategory : 'food';

    if (eatCategory === 'food') {
      // Use spatial hash for food particles - O(nearby) instead of O(all)
      if (targets.foodHash) {
        useSpatialHash = true;
      } else {
        searchList = targets.food || [];
      }
    } else if (eatCategory === 'creature') {
      // Hunt specific creature types defined in food chain
      const preyTypes = chainEntry.preyTypes || [];
      searchList = [];
      for (const pt of preyTypes) {
        const prey = targets.creatures && targets.creatures[pt];
        if (prey) searchList.push(...prey);
      }
    } else if (eatCategory === 'plant') {
      searchList = targets.plants || [];
    }

    // Predators and herbivores also scavenge dead creature corpses
    const corpseList = (eatCategory === 'creature' || eatCategory === 'plant')
      ? (targets.corpseList || [])
      : [];

    let closest = null;
    let closestDist = Infinity;
    let fallback = null;
    let fallbackDist = Infinity;

    if (useSpatialHash) {
      // Spatial hash query: search nearby food within a generous radius (~15 units)
      const queryRadius = 15;
      Creature._foodHashTemp.length = 0;
      targets.foodHash.query(
        this.body.position.x, this.body.position.z,
        queryRadius, Creature._foodHashTemp
      );
      const results = Creature._foodHashTemp;
      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        if (!item.active) continue;
        // Skip food buried below terrain.
        // Held food (VR): mesh.position is in local grip space, so
        // use body.position (synced to grip world pos) instead.
        const fp = item.held ? item.body.position : item.mesh.position;
        if (fp.y < getTerrainHeight(fp.x, fp.z) + 0.1) continue;
        const dist = this.body.position.distanceToSquared(fp);
        if (dist < closestDist) {
          closestDist = dist;
          closest = item;
        }
      }
    } else if (searchList) {
      for (const item of searchList) {
        if (!item.active) continue;
        if (item.dead) continue;
        const itemPos = item.getMidpoint ? item.getMidpoint() : item.mesh.position;
        // Skip targets buried below terrain
        if (itemPos.y < getTerrainHeight(itemPos.x, itemPos.z) + 0.1) continue;
        const dist = this.body.position.distanceToSquared(itemPos);

        // For plant eaters: prefer a different plant than the one we just ate
        if (eatCategory === 'plant' && item === this.lastPlantEaten) {
          if (dist < fallbackDist) {
            fallbackDist = dist;
            fallback = item;
          }
          continue;
        }

        if (dist < closestDist) {
          closestDist = dist;
          closest = item;
        }
      }
    }

    // Also consider corpses — treat them as lower priority than live targets
    for (let i = 0; i < corpseList.length; i++) {
      const corpse = corpseList[i];
      const cp = corpse.mesh.position;
      if (cp.y < getTerrainHeight(cp.x, cp.z) + 0.1) continue;
      const dist = this.body.position.distanceToSquared(cp);
      if (dist < closestDist) {
        closestDist = dist;
        closest = corpse;
      }
    }

    // Use the last-eaten plant only if no other targets are available
    this.foodTarget = closest || fallback;
    // Clear cached grazing node so a fresh one is picked for the new target
    this._grazingNodeIdx = null;
    this._grazingTargetRef = null;

    // No food? Creature just wanders — metabolism will handle starvation naturally.
    if (!this.foodTarget) {
      if (DEBUG_LOG) console.log(`[${this.type}] No ${this.cfg.foodTag} targets — wandering (metabolism: ${this.metabolism.toFixed(1)})`);
    }
  }

  /**
   * Detect nearby predators and update flee state.
   * Returns true if fleeing, false otherwise.
   */
  updateFlee(targets) {
    const fleeRadius = this.cfg.fleeRadius || 0;
    if (fleeRadius <= 0) {
      // This creature type doesn't flee
      this.fleeTarget = null;
      this.isFleeing = false;
      return false;
    }

    const chainEntry = CONFIG.foodChain[this.type];
    const predatorTypes = chainEntry ? chainEntry.eatenBy : [];

    // If no predators for this type, no point searching
    if (predatorTypes.length === 0) {
      this.fleeTarget = null;
      this.isFleeing = false;
      return false;
    }

    // Find the nearest active predator within flee radius using spatial hash
    let closestPredator = null;
    let closestDist = fleeRadius * fleeRadius; // squared distance

    if (targets?.creatureHash) {
      const pos = this.body.position;
      const nearbyCreatures = _fleeHashResults;
      targets.creatureHash.query(pos.x, pos.z, fleeRadius, nearbyCreatures);

      for (let i = 0, len = nearbyCreatures.length; i < len; i++) {
        const other = nearbyCreatures[i];
        // Skip if not active, dead, or not a predator type
        if (!other.active || other.dead) continue;
        if (!predatorTypes.includes(other.type)) continue;

        const dist = pos.distanceToSquared(other.body.position);
        if (dist < closestDist) {
          closestDist = dist;
          closestPredator = other;
        }
      }
    }

    this.fleeTarget = closestPredator;
    this.isFleeing = !!closestPredator;
    return this.isFleeing;
  }

  /**
   * Get the world position to aim for on the current food target.
   * Plant eaters lock onto a specific Verlet node (live position that sways
   * with the kelp). The node index is chosen once per target and persists
   * until the creature picks a new plant.
   */
  _getTargetPosition() {
    if (!this.foodTarget) return null;

    // Plant eaters: lock onto a Verlet node index, read its live position
    if (this.foodTarget.getGrazingNodeIndex !== undefined) {
      if (this._grazingTargetRef !== this.foodTarget) {
        this._grazingNodeIdx = this.foodTarget.getGrazingNodeIndex();
        this._grazingTargetRef = this.foodTarget;
      }
      const pos = this.foodTarget.getVerletNodePos(this._grazingNodeIdx);
      if (pos) return pos;
    }

    return this.foodTarget.mesh ? this.foodTarget.mesh.position : this.foodTarget.position;
  }

  /**
   * Face away from the predator and steer in the opposite direction.
   */
  fleeFromPredator(dt) {
    if (!this.fleeTarget) return;

    // Get direction away from predator
    _direction.subVectors(this.body.position, this.fleeTarget.body.position).normalize();

    if (_direction.lengthSq() < 0.001) {
      // On top of predator — pick a random escape direction
      _direction.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }

    // GLB models face +Z; we want to face away from predator
    _negDir.copy(_direction).negate();
    _origin.set(0, 0, 0);
    _lookMatrix.lookAt(_origin, _negDir, _up);
    _targetQuat.setFromRotationMatrix(_lookMatrix);

    // Rotate toward escape direction quickly
    this.body.rotation.slerp(_targetQuat, Math.min(1, dt * this.lookTime * 2)); // 2x faster turn
  }

  faceTarget(dt) {
    if (!this.foodTarget) return;
    const targetPos = this._getTargetPosition();
    if (!targetPos) return;

    _direction.subVectors(targetPos, this.body.position);
    const dist = _direction.length();
    if (dist < 0.001) return;
    _direction.divideScalar(dist); // normalize

    // GLB models exported from Unity face +Z (Unity forward).
    // We orient +Z toward the food target so the model visually faces it.
    // Matrix4.lookAt(eye, target, up): z-axis = normalize(eye - target).
    // lookAt(origin, -direction): z = origin - (-direction) = +direction → +Z faces food. ✓
    // Thrust is then applied along +Z to push toward food.
    _negDir.copy(_direction).negate();
    _origin.set(0, 0, 0);
    _lookMatrix.lookAt(_origin, _negDir, _up);
    _targetQuat.setFromRotationMatrix(_lookMatrix);

    // Close-range boost: when very close to food and moving slowly, turn faster
    // to prevent orbiting. Kicks in within 2× mouth range at low speed.
    let lookMul = 1.0;
    const closeRange = (this.cfg.mouthOffset || 0.3) * 4;
    const _chain = CONFIG.foodChain[this.type];
    if (dist < closeRange && (!_chain || _chain.eatCategory !== 'plant')) {
      const spd = this.body.velocity.length();
      const slowThreshold = this.speed * 0.8;
      if (spd < slowThreshold) {
        // The slower and closer, the sharper the turn (up to 3× normal)
        const closeFactor = 1 - (dist / closeRange);         // 0..1
        const slowFactor = 1 - (spd / slowThreshold);        // 0..1
        lookMul = 1 + 2.0 * closeFactor * slowFactor;        // 1..3
      }
    }

    // Unity: transform.rotation = Quaternion.Slerp(current, target, deltaTime * lookTime)
    this.body.rotation.slerp(_targetQuat, Math.min(1, dt * this.lookTime * lookMul));
  }

  /**
   * Age factor: 1.0 at birth, linearly decays to 0.5 at end of life.
   */
  getAgeFactor() {
    const age = Math.min(this.lifeTimer / this.lifetime, 1.0);
    return 1.0 - age * 0.5;
  }

  // ── Throttle decision (called from updateAI at 10 Hz) ──
  // Sets _targetThrottle, enginesOn, sprint/dash state. No forces applied here.
  _updateThrottleDecision(dt) {
    let targetThrottle = 0.7; // idle cruise when no target

    // Tick down sprint-hold timer (keeps sprint active after eating)
    if (this._sprintHoldTimer > 0) {
      this._sprintHoldTimer -= dt;
      this._sprinting = true;
    }
    // Tick down killing sprint cooldown
    if (this._killSprintCooldown > 0) this._killSprintCooldown -= dt;
    // Tick down dash timers
    if (this._dashTimer > 0) this._dashTimer -= dt;
    if (this._dashCooldown > 0) this._dashCooldown -= dt;

    // If heading to surface for air, cruise at steady speed (no sprint)
    if (this._needsAir) {
      targetThrottle = this._oxygen <= (this.cfg.oxygen?.criticalThreshold || 0.1) ? 1.5 : 1.0;
      this._sprinting = false;
      this.enginesOn = true;
    } else if (this.isFleeing) {
      if (!this._staminaExhausted) {
        targetThrottle = 3.5;
        this._sprinting = true;
      } else {
        targetThrottle = 1.0;
        this._sprinting = false;
      }
      this.enginesOn = true;
    } else if (this.foodTarget) {
      const targetPos = this._getTargetPosition();
      if (targetPos) {
        _direction.subVectors(targetPos, this.body.position);
        const dist = _direction.length();
        if (dist > 0.01) _direction.divideScalar(dist);
        const fwd = this.body.getForwardDirection();
        const alignment = fwd.dot(_direction);

        const closeRange = (this.cfg.mouthOffset || 0.3) * 4;
        const isClose = dist < closeRange;

        if (this._sprintHoldTimer > 0 && this.cfg.killSprint) {
          targetThrottle = 3.5;
        } else if (this.cfg.killSprint && alignment > 0.85 && this._killSprintCooldown <= 0 && !this._staminaExhausted) {
          this._sprinting = true;
          this._killSprintCooldown = 2.0;
          targetThrottle = 3.5;
        } else if (this.cfg.killSprint && this._sprinting) {
          if (alignment > 0.5) {
            targetThrottle = 3.5;
          } else {
            this._sprinting = false;
            targetThrottle = 1.0;
          }
        } else if (isClose) {
          // Plant eaters (manatees) slow down for precise grazing on verlet nodes.
          // Predators and fish speed up on final approach.
          const _chain = CONFIG.foodChain[this.type];
          if (_chain && _chain.eatCategory === 'plant') {
            targetThrottle = alignment > 0.5 ? 0.4 : 0.2;
          } else {
            targetThrottle = alignment > 0.5 ? 1.5 : 0.8;
          }
        } else {
          targetThrottle = 1.0;
        }

        // Dash mechanic
        if (!this._isDashing && this._dashCooldown <= 0 && isClose) {
          const dashCfg = CONFIG.dash;
          const dashChance = dashCfg.probabilityPerSecond * dt;
          if (Math.random() < dashChance) {
            this._isDashing = true;
            this._dashTimer = dashCfg.duration;
            this._dashCooldown = dashCfg.cooldown;
          }
        }
        if (this._isDashing) {
          targetThrottle = CONFIG.dash.speedMultiplier;
        }

        this.enginesOn = targetThrottle > 0.6;
      }
    } else {
      this._sprinting = false;
      this._isDashing = false;
      this.enginesOn = false;
    }

    if (this._dashTimer <= 0 && this._isDashing) {
      this._isDashing = false;
    }

    // Store target for per-frame smoothing in _applyEngineForce
    this._targetThrottle = targetThrottle;

    // Stamina: drain while sprinting, recover while not
    if (this._sprinting) {
      this._stamina = Math.max(0, this._stamina - dt / 3.0);
      if (this._stamina <= 0) {
        this._staminaExhausted = true;
        this._sprinting = false;
      }
    } else {
      this._stamina = Math.min(1, this._stamina + dt / 5.0);
      if (this._staminaExhausted && this._stamina >= 0.4) {
        this._staminaExhausted = false;
      }
    }
  }

  // ── Engine force application (called from updateMotion every frame) ──
  // Smooths _throttle toward _targetThrottle and applies forward thrust.
  _applyEngineForce(dt) {
    // Smooth the throttle toward the AI-set target
    const target = this._targetThrottle ?? 0.7;
    const smoothRate = this._sprinting ? 10.0 : 4.0;
    this._throttle += (target - this._throttle) * Math.min(1, smoothRate * dt);

    // Apply continuous forward force: F = v_target * mass * drag
    const ageFactor = this.getAgeFactor();
    const mult = this.cfg.thrustMultiplier || 8.0;
    const targetSpeed = this.speed * mult * this._throttle * ageFactor;
    const force = targetSpeed * this.body.mass * this.body.drag;
    _thrust.set(0, 0, force);
    this.body.addRelativeForce(_thrust);
  }

  enforceBoundary() {
    const b = CONFIG.boundary;
    if (!b) return;
    const pos = this.body.position;
    _steer.set(0, 0, 0);

    // Horizontal boundary
    const horizDist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (horizDist > b.radius) {
      // Push back toward center
      _steer.x = -pos.x;
      _steer.z = -pos.z;
      _steer.normalize().multiplyScalar(b.steerForce * (horizDist / b.radius));
    }

    // Vertical boundary — use terrain height as floor instead of fixed yMin
    const floorY = getTerrainHeight(pos.x, pos.z) + 1.0;
    const effectiveYMin = Math.max(b.yMin, floorY);
    if (pos.y < effectiveYMin) {
      _steer.y += b.steerForce * ((effectiveYMin - pos.y) / 2);
    } else if (pos.y > b.yMax && !this._needsAir) {
      _steer.y -= b.steerForce * ((pos.y - b.yMax) / 2);
    }

    if (_steer.lengthSq() > 0.001) {
      this.body.addForce(_steer);
    }
  }

  /**
   * Soft separation force — push away from same-type neighbors that are too close.
   * Prevents the visual "stacking" where multiple creatures converge on the same food.
   * Uses spatial hash lookup for O(nearby) performance instead of O(n²) brute-force.
   * @param {SpatialHash} spatialHash - Spatial hash containing all creatures, queried for nearby neighbors
   */
  _applySeparation(spatialHash) {
    if (!spatialHash) return;

    // LOD 2 creatures skip separation entirely.
    // LOD 0-1 run every AI tick (~10 Hz) — no extra frame-skipping needed.
    if (this.lod >= 2) return;

    const pos = this.body.position;
    const separationRadius = 1.5; // Units — creatures closer than this get pushed apart
    const separationRadiusSq = separationRadius * separationRadius;
    const maxForce = 3.0; // Max repulsion force

    let fx = 0, fy = 0, fz = 0;

    // Query spatial hash for nearby creatures within separationRadius
    // Note: spatialHash.query() will be pre-allocated in main.js
    const nearbyCreatures = _separationHashResults;
    spatialHash.query(pos.x, pos.z, separationRadius, nearbyCreatures);

    for (let i = 0, len = nearbyCreatures.length; i < len; i++) {
      const other = nearbyCreatures[i];
      // Only apply separation to same-type neighbors
      if (other === this || other.dead || other.type !== this.type) continue;

      const oPos = other.body.position;
      const dx = pos.x - oPos.x;
      const dy = pos.y - oPos.y;
      const dz = pos.z - oPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < separationRadiusSq && distSq > 0.0001) {
        // Inverse distance — stronger when closer
        const dist = Math.sqrt(distSq);
        const strength = maxForce * (1 - dist / separationRadius);
        fx += (dx / dist) * strength;
        fy += (dy / dist) * strength;
        fz += (dz / dist) * strength;
      }
    }

    if (fx !== 0 || fy !== 0 || fz !== 0) {
      _steer.set(fx, fy, fz);
      this.body.addForce(_steer);
    }
  }

  // ── Oxygen System ─────────────────────────────────────────────
  /**
   * Deplete oxygen while underwater, refill at the surface.
   * Triggers _needsAir when oxygen drops below thresholds.
   */
  _updateOxygen(dt, o2cfg) {
    // Use a slightly lower threshold so dolphins register as "at surface"
    // even when the hard clamp or boundary steering prevents exact surfaceY
    const atSurface = this.body.position.y >= o2cfg.surfaceY - 1.0;

    if (atSurface) {
      // At the surface — refill oxygen
      this._oxygen = Math.min(o2cfg.max, this._oxygen + o2cfg.refillRate * dt);
      this._breathingAtSurface = true;

      // Fully topped off — resume normal behavior
      if (this._oxygen >= o2cfg.max * 0.95) {
        if (DEBUG_LOG && this._needsAir) console.log(`[${this.type}] ★ OXYGEN FULL — resuming hunting, y=${this.body.position.y.toFixed(1)}`);
        this._needsAir = false;
        this._breathingAtSurface = false;
      }
    } else {
      // Underwater — deplete oxygen
      this._oxygen = Math.max(0, this._oxygen - o2cfg.depleteRate * dt);
      this._breathingAtSurface = false;
    }

    // Decide if we need to surface
    if (this._oxygen <= o2cfg.criticalThreshold) {
      // Critical — override everything, must breathe
      if (DEBUG_LOG && !this._needsAir) console.log(`[${this.type}] ★ OXYGEN CRITICAL (${(this._oxygen * 100).toFixed(0)}%) — must surface NOW, y=${this.body.position.y.toFixed(1)}`);
      this._needsAir = true;
      this.foodTarget = null;
      this.isFleeing = false;
    } else if (this._oxygen <= o2cfg.urgentThreshold && !this._needsAir) {
      // Urgent — head to surface unless actively eating
      if (DEBUG_LOG) console.log(`[${this.type}] ★ OXYGEN LOW (${(this._oxygen * 100).toFixed(0)}%) — heading to surface, y=${this.body.position.y.toFixed(1)}`);
      this._needsAir = true;
    }
  }

  /**
   * Steer toward the surface to breathe.
   * Two phases:
   *   1. Ascending — point upward and swim to the surface
   *   2. Breathing — cruise parallel to the surface (horizontal) until oxygen is full
   *
   * Uses the actual wave surface height for bobbing in sync with water animation.
   */
  _navigateToSurface(dt, o2cfg, elapsed = 0) {
    const nearSurface = this.body.position.y >= o2cfg.surfaceY - 1.5;

    if (nearSurface) {
      // ── Phase 2: At/near surface — swim horizontally while breathing ──
      // Match the actual water surface wave height at this creature's XZ position
      const waveHeight = getMacroWaveHeight(this.body.position.x, this.body.position.z, elapsed);
      const targetSurfaceY = o2cfg.surfaceY + waveHeight;
      this.body.position.y = Math.max(this.body.position.y, targetSurfaceY - 0.5);

      // Get current forward direction and flatten it to horizontal
      _direction.set(0, 0, 1).applyQuaternion(this.body.rotation);
      _direction.y = 0;
      if (_direction.lengthSq() < 0.001) _direction.set(1, 0, 0); // fallback
      _direction.normalize();

      // Smoothly level out to horizontal
      _negDir.copy(_direction).negate();
      _origin.set(0, 0, 0);
      _lookMatrix.lookAt(_origin, _negDir, _up);
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      this.body.rotation.slerp(_targetQuat, Math.min(1, dt * 4.0)); // fast level-out

      // Gentle forward cruise at half speed
      this.enginesOn = true;
      this._throttle = 0.4;

      // Clear breath target once we've arrived
      this._breathTarget = null;
    } else {
      // ── Phase 1: Ascending — aim for a lateral-offset breath spot ──
      // Pick a surface point offset from the last feeding position so the
      // dolphin swims diagonally instead of straight up from its kill.
      if (!this._breathTarget) {
        const lateralDist = 5.0; // minimum XZ offset from last feed
        const angle = Math.random() * Math.PI * 2;
        this._breathTarget = new THREE.Vector3(
          this._lastFeedPos.x + Math.cos(angle) * lateralDist,
          o2cfg.surfaceY,
          this._lastFeedPos.z + Math.sin(angle) * lateralDist
        );
      }

      _direction.copy(this._breathTarget).sub(this.body.position);

      const dist = _direction.length();
      if (dist > 0.01) _direction.divideScalar(dist);

      if (_direction.lengthSq() > 0.001) {
        _negDir.copy(_direction).negate();
        _origin.set(0, 0, 0);
        _lookMatrix.lookAt(_origin, _negDir, _up);
        _targetQuat.setFromRotationMatrix(_lookMatrix);
        this.body.rotation.slerp(_targetQuat, Math.min(1, dt * this.lookTime * 2));
      }

      this.enginesOn = true;
    }
  }

  /**
   * World-space mouth position (creature origin + forward offset).
   * Returns a volatile temp vector — use immediately.
   */
  getMouthPosition() {
    const offset = this.cfg.mouthOffset || 0;
    if (offset > 0) {
      const fwd = this.body.getForwardDirection();
      return _mouthPos.copy(this.mesh.position).addScaledVector(fwd, offset);
    }
    return _mouthPos.copy(this.mesh.position);
  }

  checkEating(targets, callbacks) {
    const mouthRadius = this.cfg.mouthRadius;
    const mouth = this.getMouthPosition();
    const mx = mouth.x, my = mouth.y, mz = mouth.z;

    const chainEntry = CONFIG.foodChain[this.type];
    const eatCategory = chainEntry ? chainEntry.eatCategory : 'food';
    const preyTypes = chainEntry ? chainEntry.preyTypes : [];

    if (eatCategory === 'food') {
      // Use spatial hash for food — O(nearby) instead of O(all food)
      if (targets.foodHash) {
        targets.foodHash.query(mx, mz, mouthRadius + 1.0, _eatHashResults);
        for (let i = 0; i < _eatHashResults.length; i++) {
          const target = _eatHashResults[i];
          if (!target.active) continue;
          // Held food (VR): mesh.position is in local grip space, so
          // use body.position (synced to grip world pos) instead.
          const tp = target.held ? target.body.position : target.mesh.position;
          const dx = mx - tp.x, dy = my - tp.y, dz = mz - tp.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          const targetRadius = target.joltBodyID != null && target.targetScale
            ? target.targetScale * 0.25 : 0;
          const reach = mouthRadius + targetRadius;
          if (distSq < reach * reach) {
            this.eatTarget(target, callbacks);
            return;
          }
        }
      }
    } else if (eatCategory === 'creature') {
      // Hunt specific creature types — use creature spatial hash
      if (targets.creatureHash) {
        targets.creatureHash.query(mx, mz, mouthRadius + 1.0, _eatHashResults);
        for (let i = 0; i < _eatHashResults.length; i++) {
          const target = _eatHashResults[i];
          if (!target.active || !preyTypes.includes(target.type)) continue;
          const tp = target.body.position;
          const dx = mx - tp.x, dy = my - tp.y, dz = mz - tp.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (target.dead) {
            // Scavenge corpses
            if (distSq < mouthRadius * mouthRadius) {
              this.eatCorpse(target, callbacks);
              return;
            }
          } else {
            // Hunt live fish
            if (distSq < mouthRadius * mouthRadius) {
              this.eatTarget(target, callbacks);
              return;
            }
          }
        }
      }
    } else if (eatCategory === 'plant') {
      // Herbivores eat plants — check current food target first (most likely hit),
      // then fall back to scanning nearby plants
      if (this.foodTarget && this.foodTarget.active && !this.foodTarget.dead) {
        let targetPos;
        if (this._grazingNodeIdx != null && this.foodTarget.getVerletNodePos) {
          targetPos = this.foodTarget.getVerletNodePos(this._grazingNodeIdx);
        } else {
          targetPos = this.foodTarget.getMidpoint ? this.foodTarget.getMidpoint() : this.foodTarget.mesh.position;
        }
        if (targetPos) {
          const dx = mx - targetPos.x, dy = my - targetPos.y, dz = mz - targetPos.z;
          if (dx * dx + dy * dy + dz * dz < mouthRadius * mouthRadius) {
            this.eatTarget(this.foodTarget, callbacks);
            return;
          }
        }
      }
      // Also scavenge corpses via creature hash
      if (targets.creatureHash) {
        targets.creatureHash.query(mx, mz, mouthRadius + 1.0, _eatHashResults);
        for (let i = 0; i < _eatHashResults.length; i++) {
          const target = _eatHashResults[i];
          if (!target.active || !target.dead) continue;
          const tp = target.body.position;
          const dx = mx - tp.x, dy = my - tp.y, dz = mz - tp.z;
          if (dx * dx + dy * dy + dz * dz < mouthRadius * mouthRadius) {
            this.eatCorpse(target, callbacks);
            return;
          }
        }
      }
    }
  }

  eatTarget(target, callbacks) {
    // Deactivate/kill the target
    const chainEntry = CONFIG.foodChain[this.type];
    const eatCategory = chainEntry ? chainEntry.eatCategory : 'food';

    if (eatCategory === 'food') {
      if (callbacks.onFoodConsumed) callbacks.onFoodConsumed(target, this);
    } else if (eatCategory === 'creature') {
      if (callbacks.onCreatureEaten) callbacks.onCreatureEaten(target);
    } else if (eatCategory === 'plant') {
      this.lastPlantEaten = target;
      if (callbacks.onPlantEaten) callbacks.onPlantEaten(target);
      // Force search for a new plant — the eaten plant stays active (regrows),
      // so without this the manatee would keep grazing the same one forever.
      this.foodTarget = null;
      this.needsNewTarget = true;
    }

    this.eatCooldown = this.cfg.killSprint ? 3.0 : 2.0; // Predators need longer cooldown between kills
    this._sprintHoldTimer = randomRange(0.3, 0.6); // Keep killing sprint to dart past target
    this.reproFoodCounter++;
    this.wasteCounter++;
    this.metabolism += this.cfg.foodEnergy;

    // Eating burns oxygen — each meal costs 33% of max tank
    if (this.cfg.oxygen) {
      this._oxygen = Math.max(0, this._oxygen - this.cfg.oxygen.max * 0.33);
      // Remember where we ate so we surface away from the hunting spot
      this._lastFeedPos.copy(this.body.position);
      this._breathTarget = null; // force recalc on next breath
    }
    if (DEBUG_LOG) console.log(`[${this.type}] Ate! food:${this.reproFoodCounter}/${this.cfg.foodToReproduce+1} waste:${this.wasteCounter}/${this.cfg.foodToLeaveWaste}`);

    // Scale growth
    this._applyScale();

    // Reproduction check — gated by cooldown and offspring cap
    if (this.reproFoodCounter >= this.cfg.foodToReproduce + 1) {
      // Drop one size step instead of resetting to smallest
      this.reproFoodCounter = Math.max(1, this.cfg.foodToReproduce - 1);
      this._applyScale();
      if (this.reproCooldown <= 0 && this.offspringCount < CONFIG.maxOffspring) {
        this.metabolism *= 0.5;
        this.reproCooldown = CONFIG.reproCooldown;
        this.offspringCount++;
        if (callbacks.onReproduce) {
          const offset = randomInsideSphere(randomRange(0.5, 1.2));
          const childPos = this.mesh.position.clone().add(offset);
          callbacks.onReproduce(this.type, childPos, this.speed);
        }
      }
    }

    // Waste check — only if creature type produces waste
    if (this.cfg.leaveWaste && this.wasteCounter >= this.cfg.foodToLeaveWaste) {
      this.wasteCounter = 0;
      if (callbacks.onProduceWaste) {
        const fwd = this.body.getForwardDirection();
        _wastePos.copy(this.mesh.position).addScaledVector(fwd, 1.5);
        if (DEBUG_LOG) console.log(`[${this.type}] Producing waste (seed) at`, _wastePos.toArray().map(v => v.toFixed(1)));
        callbacks.onProduceWaste(_wastePos);
      }
    }
  }

  eatCorpse(corpse, callbacks) {
    // Deactivate the corpse (remove it from the scene)
    if (callbacks.onCorpseConsumed) callbacks.onCorpseConsumed(corpse);
    corpse.deactivate();

    this.eatCooldown = 2.0;
    this._sprintHoldTimer = randomRange(0.1, 0.33); // Keep sprinting briefly past corpse
    this.reproFoodCounter++;
    this.wasteCounter++;
    this.metabolism += this.cfg.foodEnergy;
    this.needsNewTarget = true;
    if (DEBUG_LOG) console.log(`[${this.type}] Scavenged corpse! food:${this.reproFoodCounter}/${this.cfg.foodToReproduce+1}`);

    // Scale growth
    this._applyScale();

    // Reproduction check — gated by cooldown and offspring cap
    if (this.reproFoodCounter >= this.cfg.foodToReproduce + 1) {
      // Drop one size step instead of resetting to smallest
      this.reproFoodCounter = Math.max(1, this.cfg.foodToReproduce - 1);
      this._applyScale();
      if (this.reproCooldown <= 0 && this.offspringCount < CONFIG.maxOffspring) {
        this.metabolism *= 0.5;
        this.reproCooldown = CONFIG.reproCooldown;
        this.offspringCount++;
        if (callbacks.onReproduce) {
          const offset = randomInsideSphere(randomRange(0.5, 1.2));
          const childPos = this.mesh.position.clone().add(offset);
          callbacks.onReproduce(this.type, childPos, this.speed);
        }
      }
    }

    // Waste check
    if (this.cfg.leaveWaste && this.wasteCounter >= this.cfg.foodToLeaveWaste) {
      this.wasteCounter = 0;
      if (callbacks.onProduceWaste) {
        const fwd = this.body.getForwardDirection();
        const offset = -(this.cfg.mouthOffset || 0.3);
        _wastePos.copy(this.mesh.position).addScaledVector(fwd, offset);
        _wastePos.y -= 0.3; // drop below the body
        callbacks.onProduceWaste(_wastePos);
      }
    }
  }

  die(callbacks = {}) {
    this.dead = true;
    // mesh.visible stays false — instanced rendering handles dead creatures
    // with a per-instance death tint (red) in the fragment shader
    this.enginesOn = false;
    this.body.useGravity = true;
    this.body.drag = 4.0; // High drag for gentle underwater float-down
    this._bellyUpProgress = 0; // Smooth roll to belly-up over time
    this._deathStartQuat = this.body.rotation.clone(); // Capture orientation at death

    // Stop swim animation (shader stops when swimData is cleared on deactivate)
    this.swimData = null;

    // Destroy Jolt physics body immediately — dead creatures don't need collision.
    // The PhysicsBody fallback in updateDead() handles sinking via simple gravity.
    if (this.joltBodyID !== null && physicsProxy) {
      physicsProxy.removeBody(this.joltBodyID);
      this.joltBodyID = null;
    }
    // PhysicsBody was skipping position integration while Jolt managed it.
    // Now that Jolt body is gone, re-enable so body.update(dt) moves the corpse.
    this.body.externalPosition = false;

    // Decomposition timer — corpse becomes a plant after a while
    this.decomposeTimer = 0;
    this.decomposeTime = randomRange(0.3, 2);
    this._deathAge = 0; // Safety net — force deactivate if stuck too long

    if (callbacks.onDeath) callbacks.onDeath(this);
  }

  updateDead(dt, callbacks) {
    if (!this.dead) return;

    // Safety net — if dead creature is stuck (e.g. invalid physics body returning
    // origin position), force-deactivate after a generous timeout so corpses
    // don't pile up at world origin forever.
    this._deathAge = (this._deathAge || 0) + dt;
    if (this._deathAge > 5) {
      this.deactivate();
      return;
    }

    // Smoothly roll to belly-up (180° around local Z) over ~2 seconds
    if (this._bellyUpProgress < 1.0) {
      this._bellyUpProgress = Math.min(1.0, this._bellyUpProgress + dt * 0.5);
      const ease = this._bellyUpProgress * this._bellyUpProgress * (3 - 2 * this._bellyUpProgress); // smoothstep
      const rollAngle = Math.PI * ease; // 0 → 180°
      _direction.set(0, 0, 1); // local forward axis
      _bankQuat.setFromAxisAngle(_direction, rollAngle);
      // Apply roll on top of death orientation
      this.body.rotation.copy(this._deathStartQuat).multiply(_bankQuat);
    }

    // Sink the corpse via physics gravity + a gentle downward nudge.
    if (this.joltBodyID !== null && physicsProxy) {
      // Gentle sink velocity — physics gravity also contributes
      physicsProxy.setLinearVelocity(this.joltBodyID, 0, -2.0, 0);

      // Read physics-resolved position back into PhysicsBody so it actually moves.
      const jPos = physicsProxy.getPosition(this.joltBodyID);
      this.body.position.set(jPos.x, jPos.y, jPos.z);
    } else {
      // No physics proxy — use PhysicsBody gravity directly
      this.body.update(dt);
    }

    // Ground collision — dead creatures settle smoothly onto the terrain.
    const pos = this.body.position;
    const terrain = checkTerrainCollision(pos.x, pos.y, pos.z);
    const groundMargin = (this.cfg.capsuleRadius || 0.2) * 2 + 0.5;
    if (pos.y <= terrain.surfaceY + groundMargin) {
      // Smoothly lerp to terrain instead of snapping (prevents visual pop)
      const settleSpeed = 3.0; // units/sec approach rate
      const targetY = terrain.surfaceY;
      if (pos.y > targetY + 0.02) {
        pos.y = Math.max(targetY, pos.y - settleSpeed * dt);
      } else {
        pos.y = targetY;
      }
      this.body.velocity.set(0, 0, 0);
      this.body.useGravity = false;

      // Stop physics from continuing to push downward
      if (this.joltBodyID !== null && physicsProxy) {
        physicsProxy.setLinearVelocity(this.joltBodyID, 0, 0, 0);
      }

      // Decompose into a plant (only once fully settled)
      this.decomposeTimer += dt;
      if (this.decomposeTimer >= this.decomposeTime) {
        if (callbacks.onDecompose) {
          callbacks.onDecompose(this.body.position.clone());
        }
        this.deactivate();
        return;
      }
    }

    this.body.syncToMesh(this.mesh);
  }

  storeMaterials() {
    // Store references to the shared materials (NOT clones).
    // ModelLoader.getModelClone() already ensures all instances share
    // the same material per mesh, so we just store references for later restoration.
    // This is much cheaper than cloning and still allows swim shader patches
    // (which operate on shared materials via onBeforeCompile hooks).
    this.originalMaterials = [];
    this.mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        // Just store a reference — material is shared from ModelLoader
        this.originalMaterials.push({ mesh: child, material: child.material });
      }
    });
  }

  restoreMaterials() {
    this.originalMaterials.forEach(({ mesh, material }) => {
      mesh.material = material;
      // Keep _swimPatched and _swimUniforms on the material — applySwimMaterial
      // reuses the uniform objects already wired into the compiled shader,
      // avoiding Three.js shader program cache issues on reactivation.
    });
    this.deathMaterial = null;
  }

  // Mutate stats for offspring
  mutateFrom(parentSpeed) {
    this.speed = parentSpeed * randomRange(0.6, 1.5);
    this.engineBurnDuration = this.cfg.engineBurnTime * randomRange(0.9, 1.1);
    this.body.drag = this.cfg.drag * randomRange(0.8, 1.2);
  }

  // ── Debug visualization ──────────────────────────────────────

  _ensureDebugObjects(scene) {
    if (this._debugSphere) return;
    this._debugScene = scene;

    // Wireframe sphere at food target
    const sphereGeo = new THREE.SphereGeometry(0.4, 8, 6);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });
    this._debugSphere = new THREE.Mesh(sphereGeo, sphereMat);
    this._debugSphere.visible = false;
    this._debugSphere.renderOrder = 999;
    scene.add(this._debugSphere);

    // Mouth radius sphere (centered on creature)
    const mouthGeo = new THREE.SphereGeometry(1, 12, 8);
    const mouthMat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      wireframe: true,
      depthTest: false,
      transparent: true,
      opacity: 0.5,
    });
    this._debugMouth = new THREE.Mesh(mouthGeo, mouthMat);
    this._debugMouth.visible = false;
    this._debugMouth.renderOrder = 999;
    scene.add(this._debugMouth);

    // Line from creature to target
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(),
    ]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      depthTest: false,
      transparent: true,
      opacity: 0.6,
    });
    this._debugLine = new THREE.Line(lineGeo, lineMat);
    this._debugLine.visible = false;
    this._debugLine.renderOrder = 999;
    scene.add(this._debugLine);
  }

  updateDebug(scene, enabled) {
    this._ensureDebugObjects(scene);

    if (!enabled || !this.active || this.dead) {
      this._debugSphere.visible = false;
      this._debugLine.visible = false;
      this._debugMouth.visible = false;
      return;
    }

    // Mouth radius sphere — positioned at mouth point
    const mouthRadius = this.cfg.mouthRadius;
    const mouth = this.getMouthPosition();
    this._debugMouth.position.copy(mouth);
    this._debugMouth.scale.setScalar(mouthRadius);
    this._debugMouth.visible = true;

    // Target sphere + line — only when there's a food target
    if (!this.foodTarget) {
      this._debugSphere.visible = false;
      this._debugLine.visible = false;
      return;
    }

    const targetPos = this._getTargetPosition();
    if (!targetPos) {
      this._debugSphere.visible = false;
      this._debugLine.visible = false;
      return;
    }

    // Position sphere at target
    this._debugSphere.position.copy(targetPos);
    this._debugSphere.visible = true;

    // Update line endpoints
    const positions = this._debugLine.geometry.attributes.position;
    positions.setXYZ(0, this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
    positions.setXYZ(1, targetPos.x, targetPos.y, targetPos.z);
    positions.needsUpdate = true;
    this._debugLine.visible = true;
  }

  disposeDebug() {
    // Clean up physics body
    if (this.joltBodyID !== null && physicsProxy) {
      physicsProxy.removeBody(this.joltBodyID);
      this.joltBodyID = null;
    }

    for (const key of ['_debugSphere', '_debugLine', '_debugMouth']) {
      if (this[key] && this._debugScene) {
        this._debugScene.remove(this[key]);
        this[key].geometry.dispose();
        this[key].material.dispose();
        this[key] = null;
      }
    }
    this._debugScene = null;
  }

}

// Pre-allocated temp objects for other purposes

// Pre-allocated temp arrays for findFood() — avoids per-call allocation
Creature._corpseTemp = [];
Creature._foodHashTemp = [];
