/**
 * VerletChain — cascading follow-chain with ocean current for kelp stalks.
 *
 * Two systems working together:
 *
 * 1. OCEAN CURRENT: a global flow field that varies with height and time.
 *    Each node gets a direct lateral offset based on its position in the chain.
 *    The phase shifts with height, creating the signature kelp wave shape.
 *    This is the ambient "flowing in the ocean" motion.
 *
 * 2. CASCADE FOLLOW + IMPULSE: when a creature pushes a node, the displacement
 *    propagates through the chain via impulse diffusion and the follow-the-leader
 *    cascade. This is the reactive "something bumped me" motion.
 *
 * The current applies every frame as a position offset (not a force).
 * Impulses decay and spread through neighbors over time.
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const _diff = new THREE.Vector3();
const _push = new THREE.Vector3();

export class VerletChain {
  constructor(nodeCount, opts = {}) {
    this.nodeCount = nodeCount;

    /** @type {THREE.Vector3[]} */ this.pos = [];
    /** @type {THREE.Vector3[]} */ this.prev = [];
    /** @type {THREE.Vector3[]} */ this.restPos = [];
    /** @type {THREE.Vector3[]} */ this.impulse = [];
    /** @type {number[]} */        this.restLengths = [];
    /** @type {number[]} */        this.invMass = [];

    // Ocean current: dominant directional flow + oscillation
    this.currentAmplitude = opts.currentAmplitude ?? 1.5;  // max lateral displacement at tip
    this.currentSpeed = opts.currentSpeed ?? 0.15;         // how fast the wave moves (lower = slower sway)
    this.currentPhaseSpan = opts.currentPhaseSpan ?? 3.0;  // phase shift from base to tip (radians)
    this.currentDirection = opts.currentDirection ?? 0.6;   // dominant flow angle in radians (≈ 34°, NE-ish)
    this.currentDirectionBias = opts.currentDirectionBias ?? 0.7; // 0 = pure oscillation, 1 = fully directional

    // Cached trig for direction angles (constant per chain, no need to recompute per frame)
    const dirAngle = this.currentDirection;
    const crossAngle = dirAngle + Math.PI * 0.5;
    this._cosPrimary = Math.cos(dirAngle);
    this._sinPrimary = Math.sin(dirAngle);
    this._cosCross = Math.cos(crossAngle);
    this._sinCross = Math.sin(crossAngle);

    // Impulse response
    this.inertia = opts.inertia ?? 0.92;
    this.impulseDecay = opts.impulseDecay ?? 0.96;
    this.impulseSpread = opts.impulseSpread ?? 0.35;

    // Structure
    this.stiffness = opts.stiffness ?? 2;
    this.compliance = opts.compliance ?? 1.0;  // 0–1: fraction of distance correction applied (lower = softer chain)
    this.buoyancy = opts.buoyancy ?? 0.6;
    this.collisionRadius = opts.collisionRadius ?? 0.5;

    // Debug force recording (only populated when debugForces = true)
    this.debugForces = false;
    this.dbgCurrent = [];  // ocean current force per node
    this.dbgSpring = [];   // restoring spring per node
    this.dbgBuoyancy = []; // buoyancy per node
    this.dbgImpulse = [];  // creature impulse per node

    // Pre-allocated temp arrays for impulse propagation (avoids per-frame allocation)
    this._tempX = new Float32Array(nodeCount);
    this._tempY = new Float32Array(nodeCount);
    this._tempZ = new Float32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      this.pos.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
      this.restPos.push(new THREE.Vector3());
      this.impulse.push(new THREE.Vector3());
      this.invMass.push(1.0);
      this.dbgCurrent.push(new THREE.Vector3());
      this.dbgSpring.push(new THREE.Vector3());
      this.dbgBuoyancy.push(new THREE.Vector3());
      this.dbgImpulse.push(new THREE.Vector3());
    }
  }

  init(anchor, direction, segmentLength) {
    for (let i = 0; i < this.nodeCount; i++) {
      const p = anchor.clone().addScaledVector(direction, i * segmentLength);
      this.pos[i].copy(p);
      this.prev[i].copy(p);
      this.restPos[i].copy(p);
      this.impulse[i].set(0, 0, 0);
    }
    this.invMass[0] = 0.0;

    this.restLengths = [];
    for (let i = 0; i < this.nodeCount - 1; i++) {
      this.restLengths.push(segmentLength);
    }
  }

  setAnchor(position) {
    this.pos[0].copy(position);
  }

  /**
   * Step the simulation.
   * @param {number} dt — delta time
   * @param {number} time — total elapsed time (for current wave phase)
   * @param {number} [phaseOffset=0] — per-plant phase offset for variety
   * @param {number} [constraintIterations] — number of constraint solve iterations (default: this.stiffness)
   */
  update(dt, time, phaseOffset = 0, constraintIterations = null) {
    const dtScale = dt * 60.0;

    // ── 1. Propagate impulses ─────────────────────────────────
    this._propagateImpulses(dtScale);

    // ── 2. Apply inertia + buoyancy ───────────────────────────
    for (let i = 1; i < this.nodeCount; i++) {
      const p = this.pos[i];
      const pp = this.prev[i];
      const heightFactor = i / (this.nodeCount - 1); // 0 at anchor, 1 at tip

      // Inertia
      const inertiaScale = Math.pow(this.inertia, dtScale);
      const velX = (p.x - pp.x) * inertiaScale;
      const velY = (p.y - pp.y) * inertiaScale;
      const velZ = (p.z - pp.z) * inertiaScale;

      pp.copy(p);
      p.x += velX;
      p.y += velY;
      p.z += velZ;

      // Buoyancy across the whole chain — stronger toward the tip.
      // Keeps the stalk upright instead of sagging in the middle.
      if (this.buoyancy > 0) {
        const buoyAmt = this.buoyancy * heightFactor * dt;
        p.y += buoyAmt;
        if (this.debugForces) {
          // Use fixed reference dt so arrows don't pulse with frame jitter
          const refBuoy = this.buoyancy * heightFactor * (1 / 60);
          this.dbgBuoyancy[i].set(0, refBuoy * 60, 0);
        }
      }
    }

    // ── 3. Ocean current + restoring spring ──────────────────────
    // Current pushes nodes laterally (as a force, not a blend).
    // A gentle spring pulls them back toward rest so they don't drift away.
    for (let i = 1; i < this.nodeCount; i++) {
      const p = this.pos[i];
      const rest = this.restPos[i];
      const imp = this.impulse[i];
      const heightFactor = i / (this.nodeCount - 1);
      const amp = heightFactor * heightFactor * this.currentAmplitude;

      // Phase varies with height → traveling wave up the stalk
      const phase = time * this.currentSpeed + heightFactor * this.currentPhaseSpan + phaseOffset;

      // Current force — oscillates back and forth along a dominant axis.
      // Primary wave swings +/- along currentDirection (like tidal sway).
      // Secondary wave adds smaller cross-axis motion for organic feel.
      const spd = this.currentSpeed;
      const bias = this.currentDirectionBias;

      // Primary: oscillates along the dominant axis (positive ↔ negative)
      const primaryWave = Math.sin(phase)
                        + 0.3 * Math.sin(phase * 0.37 + 1.7);  // harmonic layer
      const primaryX = this._cosPrimary * primaryWave * spd;
      const primaryZ = this._sinPrimary * primaryWave * spd;

      // Secondary: cross-axis sway (perpendicular to dominant direction)
      const crossWave = Math.sin(phase * 0.7 + 0.5) * 0.4
                       + Math.sin(phase * 0.25 + 2.1) * 0.2;
      const crossX = this._cosCross * crossWave * spd;
      const crossZ = this._sinCross * crossWave * spd;

      // Blend: bias controls how much is along the dominant axis vs cross-axis
      const forceX = (primaryX * bias + crossX * (1.0 - bias)) * amp;
      const forceZ = (primaryZ * bias + crossZ * (1.0 - bias)) * amp;

      // Restoring spring — pulls nodes back toward rest in all 3 axes.
      // Y spring is stronger to keep the chain upright; XZ is very loose for wiggly sway.
      const springXZ = 0.008 * (1.0 - heightFactor * 0.9);
      const springY  = 0.06 * (1.0 - heightFactor * 0.5);
      const restoreX = (rest.x - p.x) * springXZ;
      const restoreZ = (rest.z - p.z) * springXZ;
      const restoreY = (rest.y - p.y) * springY;

      // Current force + spring + impulse — strength is high so rigid segments
      // actually deflect enough to create visible bone rotations.
      const strength = 0.9 * dt;
      p.x += forceX * strength + restoreX * dt + imp.x * strength;
      p.y += restoreY * dt;
      p.z += forceZ * strength + restoreZ * dt + imp.z * strength;

      // Record debug forces — use raw magnitudes (no dt) so arrows don't
      // pulse with frame-rate jitter.  A fixed reference dt (1/60) keeps
      // the visualization scale consistent regardless of actual frame time.
      if (this.debugForces) {
        const vis = 30;            // visualization scale
        const refDt = 1 / 60;     // fixed reference dt for consistent arrow size
        const refStr = 1.8 * refDt;
        this.dbgCurrent[i].set(forceX * refStr * vis, 0, forceZ * refStr * vis);
        this.dbgSpring[i].set(restoreX * refDt * vis, restoreY * refDt * vis, restoreZ * refDt * vis);
        this.dbgImpulse[i].set(imp.x * refStr * vis, imp.y * refStr * vis, imp.z * refStr * vis);
      }
    }

    // ── 3b. Pin bottom 3 nodes toward rest — keeps base grounded while top whips ──
    const pinCount = Math.min(3, this.nodeCount - 1);
    for (let i = 1; i <= pinCount; i++) {
      const t = (i - 1) / Math.max(pinCount - 1, 1); // 0 at node 1, 1 at node 3
      const pin = 0.5 * (1.0 - t);       // linear: 0.5 → 0
      if (pin < 0.001) continue;
      const p = this.pos[i];
      const rest = this.restPos[i];
      p.x += (rest.x - p.x) * pin;
      p.y += (rest.y - p.y) * pin;
      p.z += (rest.z - p.z) * pin;
    }

    // ── 4. Distance constraints ───────────────────────────────
    const iterations = constraintIterations ?? this.stiffness;
    for (let iter = 0; iter < iterations; iter++) {
      this._solveDistanceConstraints();
    }

    // ── 5. Clamp to surface — nothing grows above the water line ──
    const surfY = CONFIG.surfaceY;
    for (let i = 1; i < this.nodeCount; i++) {
      if (this.pos[i].y > surfY) {
        this.pos[i].y = surfY;
      }
    }
  }

  pushFrom(center, radius, strength = 1.0) {
    for (let i = 1; i < this.nodeCount; i++) {
      _diff.subVectors(this.pos[i], center);
      const dist = _diff.length();
      if (dist < radius && dist > 0.001) {
        const overlap = radius - dist;
        _push.copy(_diff).normalize().multiplyScalar(overlap * strength * this.invMass[i]);
        this.impulse[i].add(_push);
      }
    }
  }

  /**
   * Drag nearby nodes along with a moving object (wrap/drape effect).
   * Instead of pushing outward, nodes are nudged in the creature's velocity
   * direction — they get swept into its wake and peel off naturally.
   * A small outward push keeps the node from tunneling through the creature.
   * @param {THREE.Vector3} center — creature world position
   * @param {number} radius — interaction radius
   * @param {THREE.Vector3} velocity — creature velocity vector
   * @param {number} strength — drag strength (0–1)
   */
  dragAlong(center, radius, velocity, strength = 0.4) {
    const speed = velocity.length();
    if (speed < 0.01) return; // stationary creature — no drag

    for (let i = 1; i < this.nodeCount; i++) {
      _diff.subVectors(this.pos[i], center);
      const dist = _diff.length();
      if (dist < radius && dist > 0.001) {
        const closeness = 1.0 - dist / radius; // 1 at center, 0 at edge
        // Sharper falloff — most force on the closest nodes, drops fast at edges
        const localFactor = closeness * closeness;
        const inv = this.invMass[i];

        // Direct position displacement (immediate, localized — the "bend")
        // This is the bulk of the response: node moves right now, no spreading.
        const directScale = localFactor * strength * inv * speed * 0.25;
        _push.copy(velocity).normalize().multiplyScalar(directScale);
        this.pos[i].add(_push);

        // Smaller impulse for trailing wake/wrap (this DOES spread to neighbors)
        const impulseScale = localFactor * strength * inv * speed * 0.08;
        _push.copy(velocity).normalize().multiplyScalar(impulseScale);
        this.impulse[i].add(_push);

        // Gentle outward push to prevent tunneling
        const pushScale = localFactor * 0.06 * inv;
        _push.copy(_diff).normalize().multiplyScalar(pushScale);
        this.pos[i].add(_push);
      }
    }
  }

  _propagateImpulses(dtScale) {
    const decay = Math.pow(this.impulseDecay, dtScale);
    const spread = this.impulseSpread * Math.min(dtScale, 2.0);

    const nc = this.nodeCount;
    const tempX = this._tempX;
    const tempY = this._tempY;
    const tempZ = this._tempZ;
    tempX.fill(0);
    tempY.fill(0);
    tempZ.fill(0);
    for (let i = 1; i < nc; i++) {
      tempX[i] = this.impulse[i].x;
      tempY[i] = this.impulse[i].y;
      tempZ[i] = this.impulse[i].z;
    }

    for (let i = 1; i < nc; i++) {
      const imp = this.impulse[i];
      let avgX = tempX[i], avgY = tempY[i], avgZ = tempZ[i];
      let count = 1;
      if (i > 1) { avgX += tempX[i-1]; avgY += tempY[i-1]; avgZ += tempZ[i-1]; count++; }
      if (i < nc-1) { avgX += tempX[i+1]; avgY += tempY[i+1]; avgZ += tempZ[i+1]; count++; }
      avgX /= count; avgY /= count; avgZ /= count;

      imp.x = tempX[i] + (avgX - tempX[i]) * spread;
      imp.y = tempY[i] + (avgY - tempY[i]) * spread;
      imp.z = tempZ[i] + (avgZ - tempZ[i]) * spread;

      imp.x *= decay; imp.y *= decay; imp.z *= decay;
      if (Math.abs(imp.x) < 0.0001) imp.x = 0;
      if (Math.abs(imp.y) < 0.0001) imp.y = 0;
      if (Math.abs(imp.z) < 0.0001) imp.z = 0;
    }
  }

  _solveDistanceConstraints() {
    for (let i = 0; i < this.nodeCount - 1; i++) {
      const a = this.pos[i];
      const b = this.pos[i + 1];
      _diff.subVectors(b, a);
      const dist = _diff.length();
      if (dist < 0.0001) continue;

      const error = (dist - this.restLengths[i]) / dist;
      const wA = this.invMass[i];
      const wB = this.invMass[i + 1];
      const totalW = wA + wB;
      if (totalW === 0) continue;

      const c = this.compliance;
      const corrA = error * (wA / totalW) * c;
      const corrB = error * (wB / totalW) * c;

      a.x += _diff.x * corrA;  a.y += _diff.y * corrA;  a.z += _diff.z * corrA;
      b.x -= _diff.x * corrB;  b.y -= _diff.y * corrB;  b.z -= _diff.z * corrB;
    }
  }
}
