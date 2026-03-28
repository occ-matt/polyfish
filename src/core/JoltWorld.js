/**
 * JoltWorld — Singleton managing the Jolt Physics world.
 *
 * Provides collision filtering (static vs moving layers), a stepped simulation
 * with underwater-style gravity, and helpers to create / query / remove bodies.
 */
import initJolt from 'jolt-physics/wasm';
import joltWasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';
import { getTerrainHeight, TERRAIN_SIZE, TERRAIN_CENTER_X, TERRAIN_CENTER_Z } from '../utils/Terrain.js';

// Collision layers
const LAYER_STATIC = 0;   // terrain, plants
const LAYER_MOVING = 1;   // creatures, seeds

class JoltWorld {
  constructor() {
    this.Jolt = null;
    this.joltInterface = null;
    this.physicsSystem = null;
    this.bodyInterface = null;
    this.terrainBodyID = null;
  }

  // ── Initialisation ──────────────────────────────────────────
  async init() {
    const Jolt = await initJolt({ locateFile: () => joltWasmUrl });
    this.Jolt = Jolt;

    // -- Collision filtering (2 object layers) --
    const objectFilter = new Jolt.ObjectLayerPairFilterTable(2);
    objectFilter.EnableCollision(LAYER_STATIC, LAYER_MOVING);  // static ↔ moving
    objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);  // moving ↔ moving
    // static ↔ static is disabled by default

    // -- Broadphase layer mapping --
    const BP_NON_MOVING = new Jolt.BroadPhaseLayer(0);
    const BP_MOVING     = new Jolt.BroadPhaseLayer(1);

    const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_STATIC, BP_NON_MOVING);
    bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, BP_MOVING);

    // -- Jolt settings --
    const settings = new Jolt.JoltSettings();
    settings.mObjectLayerPairFilter = objectFilter;
    settings.mBroadPhaseLayerInterface = bpInterface;
    settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(
      settings.mBroadPhaseLayerInterface, 2,
      settings.mObjectLayerPairFilter, 2,
    );

    this.joltInterface = new Jolt.JoltInterface(settings);
    Jolt.destroy(settings);

    this.physicsSystem = this.joltInterface.GetPhysicsSystem();
    this.bodyInterface = this.physicsSystem.GetBodyInterface();

    // Underwater gravity — gentle downward pull
    const gravity = new Jolt.Vec3(0, -2.0, 0);
    this.physicsSystem.SetGravity(gravity);
    Jolt.destroy(gravity);

    this._initTempObjects();
    console.log('[JoltWorld] Physics initialised.');
  }

  /** Pre-allocate reusable WASM objects to avoid per-frame allocations. */
  _initTempObjects() {
    const Jolt = this.Jolt;
    this._tempVec3 = new Jolt.Vec3(0, 0, 0);
    this._tempRVec3 = new Jolt.RVec3(0, 0, 0);
    this._tempQuat = new Jolt.Quat(0, 0, 0, 1);
  }

  // ── Step ────────────────────────────────────────────────────
  step(dt) {
    if (!this.joltInterface) return;
    // Clamp dt to safe range
    const clampedDt = Math.max(1 / 240, Math.min(1 / 20, dt));
    // Use 2 substeps when frame time is long
    const numSteps = clampedDt > 1 / 55 ? 2 : 1;
    this.joltInterface.Step(clampedDt, numSteps);
  }

  // ── Body helpers ────────────────────────────────────────────

  /**
   * Create a physics body, add it to the world, and return its BodyID.
   * @param {*} shape       — Jolt shape (BoxShape, SphereShape, HeightFieldShape …)
   * @param {{x:number,y:number,z:number}} position
   * @param {{x:number,y:number,z:number,w:number}} rotation — quaternion, defaults to identity
   * @param {number} motionType — Jolt.EMotionType_Static / _Kinematic / _Dynamic
   * @param {number} layer — LAYER_STATIC or LAYER_MOVING
   * @param {object} options — { mass, restitution, friction, linearDamping, angularDamping }
   */
  createBody(shape, position, rotation, motionType, layer, options = {}) {
    const Jolt = this.Jolt;
    const pos = new Jolt.RVec3(position.x, position.y, position.z);
    const rot = new Jolt.Quat(
      rotation?.x ?? 0,
      rotation?.y ?? 0,
      rotation?.z ?? 0,
      rotation?.w ?? 1,
    );

    const creationSettings = new Jolt.BodyCreationSettings(shape, pos, rot, motionType, layer);

    if (options.mass !== undefined) {
      creationSettings.mMassPropertiesOverride.mMass = options.mass;
      creationSettings.mOverrideMassProperties = Jolt.EOverrideMassProperties_CalculateInertia;
    }
    if (options.restitution !== undefined)    creationSettings.mRestitution = options.restitution;
    if (options.friction !== undefined)       creationSettings.mFriction = options.friction;
    if (options.linearDamping !== undefined)  creationSettings.mLinearDamping = options.linearDamping;
    if (options.angularDamping !== undefined) creationSettings.mAngularDamping = options.angularDamping;
    if (options.gravityFactor !== undefined)  creationSettings.mGravityFactor = options.gravityFactor;

    const body = this.bodyInterface.CreateBody(creationSettings);
    const bodyID = body.GetID();
    this.bodyInterface.AddBody(bodyID, Jolt.EActivation_Activate);

    // Set gravity factor on body directly (BodyCreationSettings may not always apply)
    if (options.gravityFactor !== undefined) {
      this.bodyInterface.SetGravityFactor(bodyID, options.gravityFactor);
    }

    Jolt.destroy(creationSettings);
    Jolt.destroy(pos);
    Jolt.destroy(rot);

    return bodyID;
  }

  removeBody(bodyID) {
    this.bodyInterface.RemoveBody(bodyID);
    this.bodyInterface.DestroyBody(bodyID);
  }

  getPosition(bodyID) {
    const pos = this.bodyInterface.GetPosition(bodyID);
    return { x: pos.GetX(), y: pos.GetY(), z: pos.GetZ() };
  }

  getRotation(bodyID) {
    const rot = this.bodyInterface.GetRotation(bodyID);
    return { x: rot.GetX(), y: rot.GetY(), z: rot.GetZ(), w: rot.GetW() };
  }

  setLinearVelocity(bodyID, x, y, z) {
    this._tempVec3.Set(x, y, z);
    this.bodyInterface.SetLinearVelocity(bodyID, this._tempVec3);
  }

  setAngularVelocity(bodyID, x, y, z) {
    this._tempVec3.Set(x, y, z);
    this.bodyInterface.SetAngularVelocity(bodyID, this._tempVec3);
  }

  getLinearVelocity(bodyID) {
    const vel = this.bodyInterface.GetLinearVelocity(bodyID);
    return { x: vel.GetX(), y: vel.GetY(), z: vel.GetZ() };
  }

  /**
   * Set a SwingTwist constraint's target orientation using the reusable temp Quat.
   * Avoids per-frame Jolt.Quat allocation/destruction.
   */
  setSwingTwistTarget(stConstraint, x, y, z, w) {
    this._tempQuat.Set(x, y, z, w);
    stConstraint.SetTargetOrientationCS(this._tempQuat);
  }

  // ── Constraints ───────────────────────────────────────────────

  /**
   * Create a SwingTwist constraint between two bodies.
   * @param {*} bodyIDA — first body ID
   * @param {*} bodyIDB — second body ID
   * @param {object} opts — { position, twistAxis, planeAxis, swingAngle, twistAngle, motorFrequency, motorDamping }
   * @returns the Jolt constraint object (keep reference for motor updates)
   */
  createSwingTwistConstraint(bodyIDA, bodyIDB, opts) {
    const Jolt = this.Jolt;
    const settings = new Jolt.SwingTwistConstraintSettings();

    const pos = new Jolt.RVec3(opts.position.x, opts.position.y, opts.position.z);
    settings.mPosition1 = pos;
    settings.mPosition2 = pos;

    const twist = new Jolt.Vec3(opts.twistAxis.x, opts.twistAxis.y, opts.twistAxis.z);
    settings.mTwistAxis1 = twist;
    settings.mTwistAxis2 = twist;

    const plane = new Jolt.Vec3(opts.planeAxis.x, opts.planeAxis.y, opts.planeAxis.z);
    settings.mPlaneAxis1 = plane;
    settings.mPlaneAxis2 = plane;

    const swingRad = (opts.swingAngle ?? 30) * Math.PI / 180;
    const twistRad = (opts.twistAngle ?? 15) * Math.PI / 180;
    settings.mNormalHalfConeAngle = swingRad;
    settings.mPlaneHalfConeAngle = swingRad;
    settings.mTwistMinAngle = -twistRad;
    settings.mTwistMaxAngle = twistRad;

    // Configure motor spring
    if (opts.motorFrequency !== undefined) {
      const freq = opts.motorFrequency;
      const damp = opts.motorDamping ?? 0.3;
      settings.mSwingMotorSettings.mSpringSettings.mFrequency = freq;
      settings.mSwingMotorSettings.mSpringSettings.mDamping = damp;
      settings.mTwistMotorSettings.mSpringSettings.mFrequency = freq;
      settings.mTwistMotorSettings.mSpringSettings.mDamping = damp;
    }

    const bodyA = this.physicsSystem.GetBodyLockInterfaceNoLock().TryGetBody(bodyIDA);
    const bodyB = this.physicsSystem.GetBodyLockInterfaceNoLock().TryGetBody(bodyIDB);
    const constraint = settings.Create(bodyA, bodyB);
    this.physicsSystem.AddConstraint(constraint);

    Jolt.destroy(settings);
    Jolt.destroy(pos);
    Jolt.destroy(twist);
    Jolt.destroy(plane);

    return constraint;
  }

  /**
   * Remove a constraint from the physics system.
   */
  removeConstraint(constraint) {
    if (constraint) {
      this.physicsSystem.RemoveConstraint(constraint);
    }
  }

  // ── Terrain HeightField ─────────────────────────────────────

  /**
   * Build a physics collider that matches the visual terrain.
   * Tries HeightFieldShape first; falls back to a flat BoxShape ground plane.
   */
  createTerrainBody() {
    const Jolt = this.Jolt;

    let shape = null;
    let useHeightField = false;

    try {
      shape = this._createHeightFieldShape();
      useHeightField = true;
    } catch (e) {
      console.warn('[JoltWorld] HeightFieldShape failed, falling back to BoxShape:', e);
      shape = null;
    }

    if (!shape) {
      shape = this._createFallbackBoxShape();
    }

    // HeightField grid starts at local (0,0) extending in +X/+Z.
    // Position body so the grid aligns with the visual terrain centered at (cx, cz).
    const halfSize = TERRAIN_SIZE / 2;
    const bodyPos = useHeightField
      ? { x: TERRAIN_CENTER_X - halfSize, y: 0, z: TERRAIN_CENTER_Z - halfSize }
      : { x: TERRAIN_CENTER_X, y: -8.81, z: TERRAIN_CENTER_Z };

    const bodyID = this.createBody(
      shape,
      bodyPos,
      { x: 0, y: 0, z: 0, w: 1 },
      Jolt.EMotionType_Static,
      LAYER_STATIC,
      { restitution: 0.3, friction: 0.5 },
    );

    this.terrainBodyID = bodyID;
    console.log('[JoltWorld] Terrain body created.');
    return bodyID;
  }

  /** @private */
  _createHeightFieldShape() {
    const Jolt = this.Jolt;
    const samples = 257; // power-of-2 + 1, close to visual mesh (321) for accurate collision

    // Sample the terrain height at each grid point.
    // HeightField grid starts at body origin (0,0) in local space.
    // Body will be placed at (cx - halfSize, 0, cz - halfSize),
    // so local (0,0) maps to world (cx - halfSize, cz - halfSize)
    // and local (512, 512) maps to world (cx + halfSize, cz + halfSize).
    const heightData = new Float32Array(samples * samples);
    const halfSize = TERRAIN_SIZE / 2;

    for (let row = 0; row < samples; row++) {
      for (let col = 0; col < samples; col++) {
        const worldX = (TERRAIN_CENTER_X - halfSize) + (col / (samples - 1)) * TERRAIN_SIZE;
        const worldZ = (TERRAIN_CENTER_Z - halfSize) + (row / (samples - 1)) * TERRAIN_SIZE;
        heightData[row * samples + col] = getTerrainHeight(worldX, worldZ);
      }
    }

    const shapeSettings = new Jolt.HeightFieldShapeSettings();
    const offset = new Jolt.Vec3(0, 0, 0);
    const scale = new Jolt.Vec3(TERRAIN_SIZE / (samples - 1), 1, TERRAIN_SIZE / (samples - 1));
    shapeSettings.mOffset = offset;
    shapeSettings.mScale = scale;
    shapeSettings.mSampleCount = samples;

    // ArrayFloat API: reserve + push_back
    const heightSamples = shapeSettings.mHeightSamples;
    heightSamples.reserve(samples * samples);
    for (let i = 0; i < samples * samples; i++) {
      heightSamples.push_back(heightData[i]);
    }

    const shapeResult = shapeSettings.Create();
    if (shapeResult.HasError()) {
      const err = shapeResult.GetError().c_str();
      Jolt.destroy(shapeSettings);
      throw new Error(`HeightFieldShape creation failed: ${err}`);
    }

    const shape = shapeResult.Get();
    shape.AddRef(); // prevent premature release
    Jolt.destroy(shapeSettings);

    return shape;
  }

  /** @private — flat box 1m thick as fallback ground plane. */
  _createFallbackBoxShape() {
    const Jolt = this.Jolt;
    const halfExtents = new Jolt.Vec3(TERRAIN_SIZE / 2, 1, TERRAIN_SIZE / 2);
    const shape = new Jolt.BoxShape(halfExtents, 0.05);
    Jolt.destroy(halfExtents);
    return shape;
  }
}

const joltWorld = new JoltWorld();

export { LAYER_STATIC, LAYER_MOVING };
export default joltWorld;
