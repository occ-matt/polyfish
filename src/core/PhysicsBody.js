import * as THREE from 'three';

const GRAVITY = new THREE.Vector3(0, -9.81, 0);

// Module-level temp vectors to eliminate per-frame allocations.
// These are volatile — never return them directly from public methods.
const _tempForce = new THREE.Vector3();
const _tempDir = new THREE.Vector3();

/**
 * Simple Euler integration physics body
 */
export class PhysicsBody {
  constructor(options = {}) {
    // Position and rotation
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();

    // Velocity
    this.velocity = new THREE.Vector3();
    this.angularDrag = options.angularDrag !== undefined ? options.angularDrag : 0.5;
    this.angularVelocity = new THREE.Vector3();

    // Physics properties
    this._mass = options.mass !== undefined ? options.mass : 1.0;
    this.drag = options.drag !== undefined ? options.drag : 0.1;
    this.useGravity = options.useGravity !== undefined ? options.useGravity : false;
    this.frozen = options.frozen !== undefined ? options.frozen : false;
    this.externalPosition = false; // true when Jolt manages position (skip integration)

    // Pre-computed gravity * mass vector; updated automatically when mass changes
    this._gravityForce = new THREE.Vector3();
    this._updateGravityForce();

    // Accumulated forces (applied then reset each update)
    this.forces = new THREE.Vector3();

    // Temporary vectors for calculation
    this._tempVector = new THREE.Vector3();
    this._tempQuaternion = new THREE.Quaternion();
  }

  get mass() {
    return this._mass;
  }

  set mass(value) {
    this._mass = value;
    // Keep cached gravity force in sync
    if (this._gravityForce) {
      this._updateGravityForce();
    }
  }

  /** @private */
  _updateGravityForce() {
    this._gravityForce.copy(GRAVITY).multiplyScalar(this._mass);
  }

  /**
   * Add an impulse force to the body
   * velocity += force / mass
   */
  addForce(force) {
    if (!this.frozen) {
      this.forces.add(force);
    }
  }

  /**
   * Add a force in local space (relative to the body's rotation)
   */
  addRelativeForce(localForce) {
    if (!this.frozen) {
      // Transform local force by rotation using module-level temp
      _tempForce.copy(localForce).applyQuaternion(this.rotation);
      this.forces.add(_tempForce);
    }
  }

  /**
   * Add an impulse (instant velocity change). Matches Unity ForceMode.Impulse.
   * velocity += impulse / mass
   */
  addImpulse(impulse) {
    if (!this.frozen) {
      this._tempVector.copy(impulse).divideScalar(this.mass);
      this.velocity.add(this._tempVector);
    }
  }

  /**
   * Add an impulse in local space (relative to rotation)
   */
  addRelativeImpulse(localImpulse) {
    if (!this.frozen) {
      // Transform to world space with module-level temp, then inline the
      // impulse logic (addImpulse uses _tempVector, so we avoid calling it
      // through the public API to keep temp-vector usage clear).
      _tempForce.copy(localImpulse).applyQuaternion(this.rotation);
      this._tempVector.copy(_tempForce).divideScalar(this.mass);
      this.velocity.add(this._tempVector);
    }
  }

  /**
   * Update physics for the given delta time
   */
  update(dt) {
    if (this.frozen) {
      return;
    }

    // Apply gravity if enabled (uses pre-computed _gravityForce)
    if (this.useGravity) {
      this.forces.add(this._gravityForce);
    }

    // Apply accumulated forces: a = F/m, dv = a * dt
    // This matches Unity's ForceMode.Force behaviour (continuous force, dt-scaled)
    this._tempVector.copy(this.forces).multiplyScalar(dt / this.mass);
    this.velocity.add(this._tempVector);

    // Reset forces
    this.forces.set(0, 0, 0);

    // Apply drag
    // v *= max(0, 1 - drag * dt)
    const dragFactor = Math.max(0, 1 - this.drag * dt);
    this.velocity.multiplyScalar(dragFactor);

    // Apply angular drag
    const angDragFactor = Math.max(0, 1 - this.angularDrag * dt);
    this.angularVelocity.multiplyScalar(angDragFactor);

    // Integrate position (skip if Jolt manages position)
    if (!this.externalPosition) {
      this._tempVector.copy(this.velocity).multiplyScalar(dt);
      this.position.add(this._tempVector);
    }
  }

  /**
   * Sync position and rotation from this physics body to a Three.js object
   */
  syncToMesh(mesh) {
    if (mesh) {
      mesh.position.copy(this.position);
      mesh.quaternion.copy(this.rotation);
    }
  }

  /**
   * Sync position and rotation from a Three.js object to this physics body
   */
  syncFromMesh(mesh) {
    if (mesh) {
      this.position.copy(mesh.position);
      this.rotation.copy(mesh.quaternion);
    }
  }

  /**
   * Get the forward direction (local +Z axis after rotation).
   * Models exported from Unity face +Z; thrust and facing use +Z as forward.
   *
   * **Volatile return** — the returned vector is a shared temp and will be
   * overwritten on the next call to any getXxxDirection method. Clone the
   * result if you need to keep it.
   */
  getForwardDirection() {
    return _tempDir.set(0, 0, 1).applyQuaternion(this.rotation);
  }

  /**
   * Get the right direction (local +X axis after rotation).
   *
   * **Volatile return** — see {@link getForwardDirection}.
   */
  getRightDirection() {
    return _tempDir.set(1, 0, 0).applyQuaternion(this.rotation);
  }

  /**
   * Get the up direction (local +Y axis after rotation).
   *
   * **Volatile return** — see {@link getForwardDirection}.
   */
  getUpDirection() {
    return _tempDir.set(0, 1, 0).applyQuaternion(this.rotation);
  }
}
