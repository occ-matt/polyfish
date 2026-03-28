/**
 * physics.worker.js — Jolt Physics runs here, off the main thread.
 *
 * Communication:
 *   - SharedArrayBuffer (transforms): worker writes positions/rotations/velocities after each step
 *   - SharedArrayBuffer (commands): main thread writes velocity/position/impulse commands
 *   - postMessage: infrequent ops (createBody, removeBody, init, createTerrain)
 *
 * Flow per frame:
 *   1. Main thread writes commands to command SAB, sets CTRL_STEP_REQUESTED=1, CTRL_DT=dt
 *   2. Worker polls for CTRL_STEP_REQUESTED, processes commands, runs joltInterface.Step(dt)
 *   3. Worker writes all body transforms to transform SAB, sets CTRL_STEP_COMPLETE=1
 *   4. Main thread reads transforms
 */

import {
  MAX_BODIES,
  CONTROL_FLOATS,
  FLOATS_PER_BODY,
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
} from './PhysicsBuffers.js';

// ── State ──────────────────────────────────────────────────────

let Jolt = null;
let joltInterface = null;
let physicsSystem = null;
let bodyInterface = null;

/** Map: slot index → Jolt BodyID */
const slotToBodyID = new Map();

/** Reusable temp WASM objects (avoid per-frame alloc) */
let _tempVec3 = null;
let _tempRVec3 = null;
let _tempQuat = null;

/** SharedArrayBuffer views */
let transforms = null;   // Float32Array over transform SAB
let commands = null;      // Float32Array over command SAB
let controlInt32 = null;  // Int32Array over transform SAB (for Atomics)

// Collision layers
const LAYER_STATIC = 0;
const LAYER_MOVING = 1;

// ── Initialisation ─────────────────────────────────────────────

async function initJoltPhysics(wasmUrl) {
  // Dynamic import of jolt-physics in the worker context.
  // The main thread passes the WASM URL so we can locate the file.
  const initJoltModule = (await import('jolt-physics/wasm')).default;

  Jolt = await initJoltModule({ locateFile: () => wasmUrl });

  // Collision filtering (2 layers)
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(2);
  objectFilter.EnableCollision(LAYER_STATIC, LAYER_MOVING);
  objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);

  const BP_NON_MOVING = new Jolt.BroadPhaseLayer(0);
  const BP_MOVING = new Jolt.BroadPhaseLayer(1);

  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, BP_NON_MOVING);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_MOVING);

  const settings = new Jolt.JoltSettings();
  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
    settings.mBroadPhaseLayerInterface, 2,
    settings.mObjectLayerPairFilter, 2,
  );

  joltInterface = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);

  physicsSystem = joltInterface.GetPhysicsSystem();
  bodyInterface = physicsSystem.GetBodyInterface();

  // Underwater gravity
  const gravity = new Jolt.Vec3(0, -2.0, 0);
  physicsSystem.SetGravity(gravity);
  Jolt.destroy(gravity);

  // Reusable temp WASM objects
  _tempVec3 = new Jolt.Vec3(0, 0, 0);
  _tempRVec3 = new Jolt.RVec3(0, 0, 0);
  _tempQuat = new Jolt.Quat(0, 0, 0, 1);

  console.log('[PhysicsWorker] Jolt initialized');
  postMessage({ type: 'initialized' });
}

// ── Body Creation / Removal ────────────────────────────────────

function createBody(msg) {
  const { slot, shape, position, rotation, motionType, layer, options } = msg;

  // Build Jolt shape from descriptor
  let joltShape;
  switch (shape.type) {
    case 'sphere':
      joltShape = new Jolt.SphereShape(shape.radius);
      break;
    case 'capsule':
      joltShape = new Jolt.CapsuleShape(shape.halfHeight, shape.radius);
      break;
    case 'box': {
      const he = new Jolt.Vec3(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
      joltShape = new Jolt.BoxShape(he, shape.convexRadius ?? 0.05);
      Jolt.destroy(he);
      break;
    }
    default:
      console.warn('[PhysicsWorker] Unknown shape type:', shape.type);
      return;
  }

  // Map motion type string to Jolt enum
  let joltMotionType;
  switch (motionType) {
    case 'static': joltMotionType = Jolt.EMotionType_Static; break;
    case 'kinematic': joltMotionType = Jolt.EMotionType_Kinematic; break;
    default: joltMotionType = Jolt.EMotionType_Dynamic;
  }

  const pos = new Jolt.RVec3(position.x, position.y, position.z);
  const rot = new Jolt.Quat(
    rotation?.x ?? 0,
    rotation?.y ?? 0,
    rotation?.z ?? 0,
    rotation?.w ?? 1,
  );

  const creationSettings = new Jolt.BodyCreationSettings(joltShape, pos, rot, joltMotionType, layer);

  if (options.mass !== undefined) {
    creationSettings.mMassPropertiesOverride.mMass = options.mass;
    creationSettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
  }
  if (options.restitution !== undefined)    creationSettings.mRestitution = options.restitution;
  if (options.friction !== undefined)       creationSettings.mFriction = options.friction;
  if (options.linearDamping !== undefined)  creationSettings.mLinearDamping = options.linearDamping;
  if (options.angularDamping !== undefined) creationSettings.mAngularDamping = options.angularDamping;
  if (options.gravityFactor !== undefined)  creationSettings.mGravityFactor = options.gravityFactor;

  const body = bodyInterface.CreateBody(creationSettings);
  const bodyID = body.GetID();
  bodyInterface.AddBody(bodyID, Jolt.EActivation_Activate);

  if (options.gravityFactor !== undefined) {
    bodyInterface.SetGravityFactor(bodyID, options.gravityFactor);
  }

  // Store mapping
  slotToBodyID.set(slot, bodyID);

  Jolt.destroy(creationSettings);
  Jolt.destroy(pos);
  Jolt.destroy(rot);

  // ACK back to main thread
  postMessage({ type: 'bodyCreated', slot });
}

function removeBody(msg) {
  const { slot } = msg;
  const bodyID = slotToBodyID.get(slot);
  if (bodyID) {
    bodyInterface.RemoveBody(bodyID);
    bodyInterface.DestroyBody(bodyID);
    slotToBodyID.delete(slot);
  }
}

function createTerrainHeightField(msg) {
  const { heightData, samples, terrainSize, centerX, centerZ } = msg;

  let shape = null;
  let useHeightField = false;

  try {
    const shapeSettings = new Jolt.HeightFieldShapeSettings();
    const offset = new Jolt.Vec3(0, 0, 0);
    const scale = new Jolt.Vec3(terrainSize / (samples - 1), 1, terrainSize / (samples - 1));
    shapeSettings.mOffset = offset;
    shapeSettings.mScale = scale;
    shapeSettings.mSampleCount = samples;

    const heightSamples = shapeSettings.mHeightSamples;
    heightSamples.reserve(samples * samples);
    for (let i = 0; i < samples * samples; i++) {
      heightSamples.push_back(heightData[i]);
    }

    const shapeResult = shapeSettings.Create();
    if (shapeResult.HasError()) {
      throw new Error(shapeResult.GetError().c_str());
    }

    shape = shapeResult.Get();
    shape.AddRef();
    Jolt.destroy(shapeSettings);
    useHeightField = true;
  } catch (e) {
    console.warn('[PhysicsWorker] HeightFieldShape failed, using box fallback:', e);
    const he = new Jolt.Vec3(terrainSize / 2, 1, terrainSize / 2);
    shape = new Jolt.BoxShape(he, 0.05);
    Jolt.destroy(he);
  }

  const halfSize = terrainSize / 2;
  const bodyPos = useHeightField
    ? { x: centerX - halfSize, y: 0, z: centerZ - halfSize }
    : { x: centerX, y: -8.81, z: centerZ };

  const pos = new Jolt.RVec3(bodyPos.x, bodyPos.y, bodyPos.z);
  const rot = new Jolt.Quat(0, 0, 0, 1);
  const cs = new Jolt.BodyCreationSettings(shape, pos, rot, Jolt.EMotionType_Static, LAYER_STATIC);
  cs.mRestitution = 0.3;
  cs.mFriction = 0.5;

  const body = bodyInterface.CreateBody(cs);
  const bodyID = body.GetID();
  bodyInterface.AddBody(bodyID, Jolt.EActivation_DontActivate);

  Jolt.destroy(cs);
  Jolt.destroy(pos);
  Jolt.destroy(rot);

  postMessage({ type: 'terrainCreated' });
}

// ── Per-Frame Command Processing ───────────────────────────────

function processCommands() {
  const count = transforms[CTRL_COMMAND_COUNT];
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_COMMAND;
    const type = commands[o];
    const slot = commands[o + 1] | 0;
    const bodyID = slotToBodyID.get(slot);
    if (!bodyID) continue;

    switch (type) {
      case CMD_SET_VELOCITY:
        _tempVec3.Set(commands[o + 2], commands[o + 3], commands[o + 4]);
        bodyInterface.SetLinearVelocity(bodyID, _tempVec3);
        break;

      case CMD_SET_POSITION:
        _tempRVec3.Set(commands[o + 2], commands[o + 3], commands[o + 4]);
        bodyInterface.SetPosition(bodyID, _tempRVec3, commands[o + 5] | 0);
        break;

      case CMD_ADD_IMPULSE:
        _tempVec3.Set(commands[o + 2], commands[o + 3], commands[o + 4]);
        bodyInterface.AddImpulse(bodyID, _tempVec3);
        break;

      case CMD_SET_GRAVITY_FACTOR:
        bodyInterface.SetGravityFactor(bodyID, commands[o + 2]);
        break;

      case CMD_ACTIVATE:
        bodyInterface.ActivateBody(bodyID);
        break;
    }
  }
}

// ── Physics Step ───────────────────────────────────────────────

function stepAndWriteTransforms(dt) {
  // Step Jolt
  const clampedDt = Math.max(1 / 240, Math.min(1 / 20, dt));
  const numSteps = clampedDt > 1 / 55 ? 2 : 1;
  joltInterface.Step(clampedDt, numSteps);

  // Write all body transforms to shared buffer
  for (const [slot, bodyID] of slotToBodyID) {
    const o = CONTROL_FLOATS + slot * FLOATS_PER_BODY;

    const pos = bodyInterface.GetPosition(bodyID);
    transforms[o]     = pos.GetX();
    transforms[o + 1] = pos.GetY();
    transforms[o + 2] = pos.GetZ();

    const rot = bodyInterface.GetRotation(bodyID);
    transforms[o + 3] = rot.GetX();
    transforms[o + 4] = rot.GetY();
    transforms[o + 5] = rot.GetZ();
    transforms[o + 6] = rot.GetW();

    const vel = bodyInterface.GetLinearVelocity(bodyID);
    transforms[o + 7] = vel.GetX();
    transforms[o + 8] = vel.GetY();
    transforms[o + 9] = vel.GetZ();
  }
}

// ── Main Loop (polling) ────────────────────────────────────────

let running = false;

function runLoop() {
  if (!running) return;

  // Check if main thread requested a step
  if (transforms[CTRL_STEP_REQUESTED] === 1) {
    transforms[CTRL_STEP_REQUESTED] = 0;

    const dt = transforms[CTRL_DT];

    // Process commands from main thread
    processCommands();

    // Step physics and write results
    stepAndWriteTransforms(dt);

    // Signal completion
    transforms[CTRL_STEP_COMPLETE] = 1;
  }

  // Schedule next check — use setTimeout(0) for consistent polling
  // In practice, main thread sends step request at ~60-90Hz
  setTimeout(runLoop, 0);
}

// ── Message Handler ────────────────────────────────────────────

self.onmessage = async (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      // Store SAB views
      transforms = new Float32Array(msg.transformSAB);
      commands = new Float32Array(msg.commandSAB);
      controlInt32 = new Int32Array(msg.transformSAB);

      await initJoltPhysics(msg.wasmUrl);

      // Start the polling loop
      running = true;
      runLoop();
      break;

    case 'createBody':
      createBody(msg);
      break;

    case 'removeBody':
      removeBody(msg);
      break;

    case 'createTerrain':
      createTerrainHeightField(msg);
      break;

    case 'stop':
      running = false;
      break;
  }
};
