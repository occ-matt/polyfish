/**
 * PhysicsProxy — Main-thread interface that mirrors JoltWorld's API
 * but delegates physics stepping to a Web Worker.
 *
 * Design:
 *   - Body creation/removal: postMessage (async, returns Promise)
 *   - Per-frame commands (setVelocity, setPosition, addImpulse): written to SharedArrayBuffer
 *   - Transform reads (getPosition, getRotation): read from SharedArrayBuffer
 *   - Physics step: signals worker via SAB, worker steps & writes results
 *
 * Slot allocation: each body gets a unique slot (0..MAX_BODIES-1) that maps to
 * its position in the SharedArrayBuffer. Entities store their slot instead of
 * a Jolt bodyID (which only exists in the worker).
 *
 * Fallback: If SharedArrayBuffer is not available (missing COOP/COEP headers),
 * falls back to the original synchronous JoltWorld on the main thread.
 */

import joltWasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';
import {
  MAX_BODIES,
  FLOATS_PER_COMMAND,
  CTRL_STEP_REQUESTED,
  CTRL_STEP_COMPLETE,
  CTRL_DT,
  CTRL_COMMAND_COUNT,
  CMD_SET_VELOCITY,
  CMD_SET_POSITION,
  CMD_ADD_IMPULSE,
  CMD_SET_GRAVITY_FACTOR,
  CMD_ACTIVATE,
  bodyOffset,
  createPhysicsBuffers,
} from './PhysicsBuffers.js';

export class PhysicsProxy {
  constructor() {
    /** Whether the worker is initialized and ready */
    this.ready = false;

    /** Whether we're using the worker (true) or synchronous fallback (false) */
    this.useWorker = false;

    /** The Web Worker running Jolt */
    this._worker = null;

    /** SharedArrayBuffer views */
    this._transforms = null;  // Float32Array
    this._commands = null;    // Float32Array
    this._transformSAB = null;
    this._commandSAB = null;

    /** Slot allocator: tracks which slots are free */
    this._freeSlots = [];
    this._slotInUse = new Uint8Array(MAX_BODIES);
    for (let i = MAX_BODIES - 1; i >= 0; i--) {
      this._freeSlots.push(i);
    }

    /** Command write cursor (reset each frame) */
    this._commandCount = 0;

    /** Pending promises for body creation */
    this._pendingCreations = new Map();

    /** Synchronous fallback reference */
    this._syncJoltWorld = null;

    /** Fake Jolt reference for compatibility checks (entities check joltWorld.Jolt) */
    this.Jolt = null;

    /** Fake bodyInterface for direct calls (used in fallback mode) */
    this.bodyInterface = null;

    /** Terrain body slot (for reference) */
    this.terrainBodySlot = null;
  }

  /**
   * Initialize the physics system.
   * Tries to start a Web Worker with SharedArrayBuffer.
   * Falls back to synchronous JoltWorld if SAB unavailable.
   */
  async init() {
    // Check for SharedArrayBuffer support (requires COOP/COEP headers)
    const sabAvailable = typeof SharedArrayBuffer !== 'undefined';

    if (sabAvailable) {
      try {
        await this._initWorker();
        return;
      } catch (e) {
        console.warn('[PhysicsProxy] Worker init failed, falling back to sync:', e);
      }
    } else {
      console.log('[PhysicsProxy] SharedArrayBuffer unavailable, using synchronous fallback');
    }

    // Fallback: use original JoltWorld on main thread
    await this._initSyncFallback();
  }

  async _initWorker() {
    // Create shared buffers
    const buffers = createPhysicsBuffers();
    this._transformSAB = buffers.transformSAB;
    this._commandSAB = buffers.commandSAB;
    this._transforms = buffers.transforms;
    this._commands = buffers.commands;

    // Create worker
    this._worker = new Worker(
      new URL('./physics.worker.js', import.meta.url),
      { type: 'module' }
    );

    // Wait for initialization
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10000);

      this._worker.onmessage = (e) => {
        if (e.data.type === 'initialized') {
          clearTimeout(timeout);
          this._setupWorkerMessageHandler();
          resolve();
        }
      };

      this._worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(e);
      };

      this._worker.postMessage({
        type: 'init',
        transformSAB: this._transformSAB,
        commandSAB: this._commandSAB,
        wasmUrl: joltWasmUrl,
      });
    });

    this.useWorker = true;
    this.ready = true;
    this.Jolt = true; // Truthy so `if (physicsProxy.Jolt)` checks pass
    console.log('[PhysicsProxy] Worker mode ready');
  }

  _setupWorkerMessageHandler() {
    this._worker.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'bodyCreated': {
          const resolve = this._pendingCreations.get(msg.slot);
          if (resolve) {
            this._pendingCreations.delete(msg.slot);
            resolve(msg.slot);
          }
          break;
        }
        case 'terrainCreated':
          console.log('[PhysicsProxy] Terrain body created in worker');
          break;
      }
    };
  }

  async _initSyncFallback() {
    // Import and use the original JoltWorld directly
    const { default: joltWorld } = await import('./JoltWorld.js');
    await joltWorld.init();
    this._syncJoltWorld = joltWorld;
    this._syncSlotMap = new Map();
    this.Jolt = joltWorld.Jolt;
    this.bodyInterface = joltWorld.bodyInterface;
    this.useWorker = false;
    this.ready = true;
    console.log('[PhysicsProxy] Synchronous fallback mode ready');
  }

  // ── Slot Allocation ──────────────────────────────────────────

  _allocSlot() {
    if (this._freeSlots.length === 0) {
      // Throttle warning to once per second to avoid console flood
      const now = performance.now();
      if (!this._lastSlotWarn || now - this._lastSlotWarn > 1000) {
        console.warn(`[PhysicsProxy] No free body slots! (${MAX_BODIES} in use)`);
        this._lastSlotWarn = now;
      }
      return -1;
    }
    const slot = this._freeSlots.pop();
    this._slotInUse[slot] = 1;
    return slot;
  }

  _freeSlot(slot) {
    if (slot >= 0 && this._slotInUse[slot]) {
      this._slotInUse[slot] = 0;
      this._freeSlots.push(slot);
    }
  }

  // ── Body Creation / Removal ──────────────────────────────────

  /**
   * Create a physics body. Returns a slot index (not a Jolt bodyID).
   * In worker mode, this is async. In sync mode, it creates immediately.
   *
   * @param {object} shapeDesc — { type: 'sphere'|'capsule'|'box', radius?, halfHeight?, halfExtents? }
   * @param {{x,y,z}} position
   * @param {{x,y,z,w}} rotation
   * @param {string} motionType — 'static' | 'kinematic' | 'dynamic'
   * @param {number} layer — 0 (static) or 1 (moving)
   * @param {object} options — { mass, restitution, friction, linearDamping, angularDamping, gravityFactor }
   * @returns {number} slot index
   */
  createBody(shapeDesc, position, rotation, motionType, layer, options = {}) {
    const slot = this._allocSlot();
    if (slot < 0) return -1;

    if (this.useWorker) {
      this._worker.postMessage({
        type: 'createBody',
        slot,
        shape: shapeDesc,
        position,
        rotation,
        motionType,
        layer,
        options,
      });
      // Body creation is async in worker, but we return slot immediately
      // so entities can start using it. The worker will process commands
      // for this slot once the body is created.
      return slot;
    }

    // Synchronous fallback — create Jolt body directly
    const jw = this._syncJoltWorld;
    const Jolt = jw.Jolt;

    let shape;
    switch (shapeDesc.type) {
      case 'sphere': shape = new Jolt.SphereShape(shapeDesc.radius); break;
      case 'capsule': shape = new Jolt.CapsuleShape(shapeDesc.halfHeight, shapeDesc.radius); break;
      case 'box': {
        const he = new Jolt.Vec3(shapeDesc.halfExtents.x, shapeDesc.halfExtents.y, shapeDesc.halfExtents.z);
        shape = new Jolt.BoxShape(he, shapeDesc.convexRadius ?? 0.05);
        Jolt.destroy(he);
        break;
      }
      default: return -1;
    }

    const motionMap = { static: Jolt.EMotionType_Static, kinematic: Jolt.EMotionType_Kinematic };
    const mt = motionMap[motionType] ?? Jolt.EMotionType_Dynamic;

    const bodyID = jw.createBody(shape, position, rotation, mt, layer, options);
    this._syncSlotMap = this._syncSlotMap || new Map();
    this._syncSlotMap.set(slot, bodyID);
    return slot;
  }

  /**
   * Remove a physics body by slot.
   */
  removeBody(slot) {
    if (slot < 0) return;

    if (this.useWorker) {
      this._worker.postMessage({ type: 'removeBody', slot });
    } else if (this._syncJoltWorld && this._syncSlotMap) {
      const bodyID = this._syncSlotMap.get(slot);
      if (bodyID) {
        this._syncJoltWorld.removeBody(bodyID);
        this._syncSlotMap.delete(slot);
      }
    }

    this._freeSlot(slot);
  }

  // ── Transform Reads (zero-copy from SAB) ─────────────────────

  /**
   * Get position of a body. Returns plain object.
   */
  getPosition(slot) {
    if (this.useWorker) {
      const o = bodyOffset(slot);
      return {
        x: this._transforms[o],
        y: this._transforms[o + 1],
        z: this._transforms[o + 2],
      };
    }
    const bodyID = this._syncSlotMap?.get(slot);
    return bodyID ? this._syncJoltWorld.getPosition(bodyID) : { x: 0, y: 0, z: 0 };
  }

  /**
   * Get rotation of a body (quaternion).
   */
  getRotation(slot) {
    if (this.useWorker) {
      const o = bodyOffset(slot);
      return {
        x: this._transforms[o + 3],
        y: this._transforms[o + 4],
        z: this._transforms[o + 5],
        w: this._transforms[o + 6],
      };
    }
    const bodyID = this._syncSlotMap?.get(slot);
    return bodyID ? this._syncJoltWorld.getRotation(bodyID) : { x: 0, y: 0, z: 0, w: 1 };
  }

  /**
   * Get linear velocity of a body.
   */
  getLinearVelocity(slot) {
    if (this.useWorker) {
      const o = bodyOffset(slot);
      return {
        x: this._transforms[o + 7],
        y: this._transforms[o + 8],
        z: this._transforms[o + 9],
      };
    }
    const bodyID = this._syncSlotMap?.get(slot);
    return bodyID ? this._syncJoltWorld.getLinearVelocity(bodyID) : { x: 0, y: 0, z: 0 };
  }

  // ── Per-Frame Commands (written to SAB command buffer) ───────

  /**
   * Set linear velocity for next step.
   */
  setLinearVelocity(slot, x, y, z) {
    if (this.useWorker) {
      this._writeCommand(CMD_SET_VELOCITY, slot, x, y, z);
    } else {
      const bodyID = this._syncSlotMap?.get(slot);
      if (bodyID) this._syncJoltWorld.setLinearVelocity(bodyID, x, y, z);
    }
  }

  setAngularVelocity(slot, x, y, z) {
    if (this.useWorker) {
      // Not yet supported in worker mode — angular velocity is set at creation only
    } else {
      const bodyID = this._syncSlotMap?.get(slot);
      if (bodyID) this._syncJoltWorld.setAngularVelocity(bodyID, x, y, z);
    }
  }

  /**
   * Set body position.
   * @param {number} activation — 0 = activate, 1 = don't activate
   */
  setPosition(slot, x, y, z, activation = 0) {
    if (this.useWorker) {
      this._writeCommand(CMD_SET_POSITION, slot, x, y, z, activation);
    } else {
      const bodyID = this._syncSlotMap?.get(slot);
      if (bodyID) {
        const jw = this._syncJoltWorld;
        jw._tempRVec3.Set(x, y, z);
        jw.bodyInterface.SetPosition(bodyID, jw._tempRVec3, activation);
      }
    }
  }

  /**
   * Add impulse to a body.
   */
  addImpulse(slot, x, y, z) {
    if (this.useWorker) {
      this._writeCommand(CMD_ADD_IMPULSE, slot, x, y, z);
    } else {
      const bodyID = this._syncSlotMap?.get(slot);
      if (bodyID) {
        const jw = this._syncJoltWorld;
        jw._tempVec3.Set(x, y, z);
        jw.bodyInterface.AddImpulse(bodyID, jw._tempVec3);
      }
    }
  }

  /**
   * Set gravity factor for a body.
   */
  setGravityFactor(slot, factor) {
    if (this.useWorker) {
      this._writeCommand(CMD_SET_GRAVITY_FACTOR, slot, factor);
    } else {
      const bodyID = this._syncSlotMap?.get(slot);
      if (bodyID) this._syncJoltWorld.bodyInterface.SetGravityFactor(bodyID, factor);
    }
  }

  /** Write a command to the shared command buffer */
  _writeCommand(type, slot, f0 = 0, f1 = 0, f2 = 0, f3 = 0, f4 = 0, f5 = 0) {
    if (this._commandCount >= 512) {
      console.warn('[PhysicsProxy] Command buffer full!');
      return;
    }
    const o = this._commandCount * FLOATS_PER_COMMAND;
    this._commands[o]     = type;
    this._commands[o + 1] = slot;
    this._commands[o + 2] = f0;
    this._commands[o + 3] = f1;
    this._commands[o + 4] = f2;
    this._commands[o + 5] = f3;
    this._commands[o + 6] = f4;
    this._commands[o + 7] = f5;
    this._commandCount++;
  }

  // ── Step ─────────────────────────────────────────────────────

  /**
   * Request a physics step. In worker mode, writes dt to SAB and signals worker.
   * In sync mode, steps directly.
   *
   * @param {number} dt — delta time
   */
  step(dt) {
    if (this.useWorker) {
      // Write command count and dt
      this._transforms[CTRL_COMMAND_COUNT] = this._commandCount;
      this._transforms[CTRL_DT] = dt;

      // Signal worker to step
      this._transforms[CTRL_STEP_COMPLETE] = 0;
      this._transforms[CTRL_STEP_REQUESTED] = 1;

      // Reset command buffer for next frame
      this._commandCount = 0;
    } else if (this._syncJoltWorld) {
      this._syncJoltWorld.step(dt);
    }
  }

  /**
   * Check if the last step has completed (worker mode only).
   * In sync mode, always returns true.
   * @returns {boolean}
   */
  isStepComplete() {
    if (!this.useWorker) return true;
    return this._transforms[CTRL_STEP_COMPLETE] === 1;
  }

  /**
   * Blocking wait for step completion (for compatibility with sync code).
   * In practice, the worker should finish before the next frame at 90fps.
   */
  waitForStep() {
    if (!this.useWorker) return;
    // Spin-wait (should be very brief — worker step takes <1ms for ~200 bodies)
    while (this._transforms[CTRL_STEP_COMPLETE] !== 1) {
      // Busy wait — acceptable because the wait is typically <1ms
    }
  }

  // ── Terrain ──────────────────────────────────────────────────

  /**
   * Create the terrain heightfield body (or box fallback).
   * In worker mode, sends height data to worker.
   * In sync mode, delegates to JoltWorld.createTerrainBody().
   */
  createTerrainBody(heightData, samples, terrainSize, centerX, centerZ) {
    if (this.useWorker) {
      this._worker.postMessage({
        type: 'createTerrain',
        heightData: Array.from(heightData), // Can't transfer Float32Array directly with SAB
        samples,
        terrainSize,
        centerX,
        centerZ,
      });
    } else if (this._syncJoltWorld) {
      this._syncJoltWorld.createTerrainBody();
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────

  dispose() {
    if (this._worker) {
      this._worker.postMessage({ type: 'stop' });
      this._worker.terminate();
      this._worker = null;
    }
    this.ready = false;
  }
}
