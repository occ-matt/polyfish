import * as THREE from 'three';

/**
 * ProceduralRotation — oscillates a bone/object around an axis.
 *
 * Uses quaternion math to apply sway as a DELTA on top of the
 * bone's rest-pose quaternion, preserving the glTF skeleton orientation.
 *
 * Supports velocity-driven animation: amplitude and frequency scale
 * with a 0–1 "intensity" value derived from creature speed.
 */

const _swayQuat = new THREE.Quaternion();
const _swayEuler = new THREE.Euler();
const _lagQuat = new THREE.Quaternion();
const _lagEuler = new THREE.Euler();

export class ProceduralRotation {
  constructor(target, config) {
    this.target = target;
    this.axis = config.axis || new THREE.Vector3(0, 1, 0);
    this.frequency = config.frequency || 0.2;
    this.amplitude = config.amplitude || 0.6;
    this.offset = config.offset || 0;
    // Pre-compute rotation limit in radians
    this.rotationLimitRad = THREE.MathUtils.degToRad(config.rotationLimit || 20);
    this.timer = 0;
    this.enabled = true;

    this.restQuaternion = target.quaternion.clone();

    // Base values (idle swimming)
    this.baseFrequency = this.frequency;
    this.baseAmplitude = this.amplitude;

    // Moving values (active thrust — tighter, faster strokes like real fish)
    this.movingFrequency = Math.min(this.frequency * 1.6, 0.8); // cap at 0.8 Hz
    this.movingAmplitude = this.amplitude * 0.5;

    // Current smooth targets and actual values
    this.targetFrequency = this.frequency;
    this.targetAmplitude = this.amplitude;

    // Velocity-driven intensity (0 = idle, 1 = full speed)
    this.intensity = 0;
    this.targetIntensity = 0;

    // Turn lag — bones further down the chain drag behind during turns
    this.chainDepth = config.chainDepth || 0;  // 0 = head, 1 = tail tip
    this.turnLag = 0;           // current smoothed lag angle (radians)
    this._targetTurnLag = 0;
    this.turnLagAxis = config.turnLagAxis || new THREE.Vector3(0, 1, 0); // yaw axis for lag
    this.turnLagStrength = 0.35; // max lag in radians at full turn rate (~20°)
  }

  /**
   * Set the velocity-driven intensity (0–1).
   * Animation parameters lerp between idle and moving based on this.
   */
  setIntensity(value) {
    this.targetIntensity = Math.max(0, Math.min(1, value));
  }

  /**
   * Set the current turn rate (rad/sec) so bones can lag behind the head.
   */
  setTurnRate(turnRate) {
    // Target lag = turn rate × chain depth × strength
    // Deeper bones lag more; head bones barely lag at all
    const targetLag = turnRate * this.chainDepth * this.turnLagStrength;
    // Clamp to reasonable range
    this._targetTurnLag = Math.max(-this.turnLagStrength, Math.min(this.turnLagStrength, targetLag));
  }

  update(dt) {
    if (!this.enabled) return;

    // Smooth intensity toward target
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, 4 * dt);

    // Blend frequency and amplitude between idle and moving based on intensity
    const t = this.intensity;
    this.targetFrequency = this.baseFrequency + t * (this.movingFrequency - this.baseFrequency);
    this.targetAmplitude = this.baseAmplitude + t * (this.movingAmplitude - this.baseAmplitude);

    // Smooth transitions (avoid pops)
    this.frequency += (this.targetFrequency - this.frequency) * Math.min(1, 6 * dt);
    this.amplitude += (this.targetAmplitude - this.amplitude) * Math.min(1, 6 * dt);

    this.timer += dt;
    const sample = Math.sin((this.timer + this.offset) * this.frequency * Math.PI * 2)
                   * this.amplitude * this.rotationLimitRad;

    _swayEuler.set(
      this.axis.x * sample,
      this.axis.y * sample,
      this.axis.z * sample
    );
    _swayQuat.setFromEuler(_swayEuler);

    this.target.quaternion.copy(this.restQuaternion).multiply(_swayQuat);

    // Turn lag — tail bones drag behind head during turns
    if (this.chainDepth > 0) {
      // Smooth toward target lag (tail catches up slower than it falls behind)
      const lagRate = Math.abs(this._targetTurnLag) > Math.abs(this.turnLag) ? 3 : 5;
      this.turnLag += (this._targetTurnLag - this.turnLag) * Math.min(1, lagRate * dt);
      if (Math.abs(this.turnLag) > 0.001) {
        const axis = this.turnLagAxis;
        _lagEuler.set(
          axis.x * this.turnLag,
          axis.y * this.turnLag,
          axis.z * this.turnLag
        );
        _lagQuat.setFromEuler(_lagEuler);
        this.target.quaternion.multiply(_lagQuat);
      }
    }
  }

  startMoving() {
    // Handled by intensity now — keep for backward compat
    this.targetIntensity = 1;
  }

  stopMoving() {
    this.targetIntensity = 0;
  }

  stop() {
    this.enabled = false;
    this.targetIntensity = 0;
    this.intensity = 0;
    this.frequency = this.baseFrequency;
    this.amplitude = this.baseAmplitude;
    this.target.quaternion.copy(this.restQuaternion);
  }

  start() {
    this.enabled = true;
  }
}

/**
 * Per-creature-type bone animation configs.
 *
 * Bone hierarchy (all creatures share the same skeleton):
 *   Armature → fish_base (-90° X) → head_base (-90° Y)
 *                                  → neck (+90° Y) → tail/tail1 (compound) → end
 *
 * In bone-local frames after Blender→glTF export:
 *   - Y-axis rotation → side-to-side yaw (fish lateral undulation)
 *   - Z-axis rotation → up-and-down pitch (dolphin/manatee vertical undulation)
 *
 * Fish undulate side-to-side (Y-axis). Dolphins and manatees undulate
 * up-and-down (Z-axis) since their tail flukes are horizontal.
 */

export const CREATURE_ANIM_CONFIGS = {
  // ── Fish: side-to-side ──
  fish: {
    fish_base: {
      axis: new THREE.Vector3(0, 1, 0),
      frequency: 0.4,
      amplitude: 0.5,
      rotationLimit: 12,
    },
    head_base: {
      axis: new THREE.Vector3(0, 0, 1),
      frequency: 0.4,
      amplitude: 0.3,
      rotationLimit: 8,
      cascadeDelay: 0.4,
      phaseOffset: 3.1416,
    },
    neck: {
      axis: new THREE.Vector3(0, 1, 0),
      frequency: 0.4,
      amplitude: 0.7,
      rotationLimit: 20,
      cascadeDelay: 0.4,
    },
    tail: {
      axis: new THREE.Vector3(0, 1, 0.5),
      frequency: 0.4,
      amplitude: 1.0,
      rotationLimit: 30,
      cascadeDelay: -0.1,
    },
  },

  // ── Dolphin: up-and-down, graceful ──
  dolphin: {
    fish_base: {
      axis: new THREE.Vector3(0, 0, 1),
      frequency: 0.3,
      amplitude: 0.3,
      rotationLimit: 10,
    },
    head_base: {
      axis: new THREE.Vector3(0, 1, 1),
      frequency: 0.3,
      amplitude: 0.2,
      rotationLimit: 6,
      cascadeDelay: 0.4,
      phaseOffset: 3.1416,
    },
    neck: {
      axis: new THREE.Vector3(0, 0, 1),
      frequency: 0.3,
      amplitude: 0.4,
      rotationLimit: 12,
      cascadeDelay: 0.4,
    },
    tail1: {
      axis: new THREE.Vector3(1, 0, 0),
      frequency: 0.3,
      amplitude: 0.5,
      rotationLimit: 18,
      cascadeDelay: 0.2,
    },
    end: {
      axis: new THREE.Vector3(1, 0, 0),
      frequency: 0.3,
      amplitude: 0.7,
      rotationLimit: 22,
      cascadeDelay: 1.25,
    },
  },

  // ── Manatee: up-and-down, slow and lumbering ──
  manatee: {
    fish_base: {
      axis: new THREE.Vector3(0, 0, 1),
      frequency: 0.2,
      amplitude: 0.2,
      rotationLimit: 8,
    },
    head_base: {
      axis: new THREE.Vector3(0, 1, 0.5),
      frequency: 0.2,
      amplitude: 0.15,
      rotationLimit: 5,
      cascadeDelay: 0.4,
      phaseOffset: 3.1416,
    },
    neck: {
      axis: new THREE.Vector3(0, 0, 1),
      frequency: 0.2,
      amplitude: 0.3,
      rotationLimit: 8,
      cascadeDelay: 0.4,
    },
    tail1: {
      axis: new THREE.Vector3(1, 0, 0),
      frequency: 0.2,
      amplitude: 0.4,
      rotationLimit: 12,
      cascadeDelay: 0.4,
    },
    end: {
      axis: new THREE.Vector3(1, 0, 0),
      frequency: 0.2,
      amplitude: 0.6,
      rotationLimit: 15,
      cascadeDelay: -1.0,
    },
  },
};

