/**
 * XRHandGestures — Hand tracking gesture detection for WebXR.
 *
 * Detects common hand gestures from the WebXR Hand API:
 *   - Pinch: thumb tip to index finger tip (maps to food hold/release)
 *   - Point: index extended, other fingers curled (shows aim ray)
 *   - Open Palm: all fingers extended (toggle screensaver/cinematic mode)
 *
 * Also detects Apple Vision Pro's transient pointer (look + pinch).
 *
 * Uses hysteresis on distance thresholds to prevent gesture flickering.
 */

import * as THREE from 'three';

const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();
const _indexTipPos = new THREE.Vector3();
const _thumbTipPos = new THREE.Vector3();

/**
 * Hand gesture detector using WebXR Hand API joints.
 *
 * Expected joint names from WebXR spec:
 *   - wrist
 *   - thumb-metacarpal, thumb-phalanx-proximal, thumb-phalanx-distal, thumb-tip
 *   - index-finger-metacarpal, ..., index-finger-tip
 *   - middle-finger-metacarpal, ..., middle-finger-tip
 *   - ring-finger-metacarpal, ..., ring-finger-tip
 *   - pinky-finger-metacarpal, ..., pinky-finger-tip
 */
export class XRHandGestures {
  /**
   * @param {XRHand|null} leftHand - Left hand from renderer.xr.getHand(0)
   * @param {XRHand|null} rightHand - Right hand from renderer.xr.getHand(1)
   */
  constructor(leftHand, rightHand) {
    this.hands = [leftHand, rightHand]; // [left, right]

    // Gesture state per hand
    this._pinching = [false, false];
    this._pinchStartDistance = [Infinity, Infinity];
    this._pinchEndDistance = [Infinity, Infinity];

    this._pointing = [false, false];
    this._openPalm = [false, false];

    // Pinch hysteresis thresholds (meters)
    this.pinchStartThreshold = 0.02; // starts when tips within 2cm
    this.pinchEndThreshold = 0.04;   // ends when tips more than 4cm apart

    // Point gesture: index extended but not too far from middle finger
    // Middle finger curled means < 0.05m from base to tip
    this.pointIndexMinExtension = 0.06; // index tip must be > 6cm from hand
    this.pointFingerMaxCurl = 0.05;     // other fingers "curled" = short length

    // Open palm: all 5 fingers extended significantly
    this.openPalmMinExtension = 0.08; // each finger extends > 8cm

    // Transient pointer state (Apple Vision Pro)
    this._isTransientPointer = false;
    this._transientPointerInputSource = null;
  }

  /**
   * Update gesture states. Call once per frame.
   * @param {number} dt - Delta time (for potential smoothing)
   * @param {XRSession|null} session - Current XR session (for transient pointer check)
   */
  update(dt, session) {
    // Update hand-based gestures
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i];
      if (!hand) {
        this._pinching[i] = false;
        this._pointing[i] = false;
        this._openPalm[i] = false;
        continue;
      }

      // Detect pinch gesture (thumb + index tip distance)
      this._updatePinch(i, hand);

      // Detect point gesture (index extended, others curled)
      this._updatePoint(i, hand);

      // Detect open palm (all fingers extended)
      this._updateOpenPalm(i, hand);
    }

    // Check for transient pointer input source (Vision Pro)
    this._updateTransientPointer(session);
  }

  /**
   * Detect pinch gesture using thumb and index finger tips.
   * Uses hysteresis to prevent flickering.
   */
  _updatePinch(handIndex, hand) {
    const thumbTip = this._getJointPosition(hand, 'thumb-tip');
    const indexTip = this._getJointPosition(hand, 'index-finger-tip');

    if (!thumbTip || !indexTip) {
      this._pinching[handIndex] = false;
      return;
    }

    const distance = thumbTip.distanceTo(indexTip);

    if (!this._pinching[handIndex]) {
      // Not pinching — check if we should start
      if (distance < this.pinchStartThreshold) {
        this._pinching[handIndex] = true;
        this._pinchStartDistance[handIndex] = distance;
      }
    } else {
      // Already pinching — check if we should release
      if (distance > this.pinchEndThreshold) {
        this._pinching[handIndex] = false;
        this._pinchEndDistance[handIndex] = distance;
      }
    }
  }

  /**
   * Detect point gesture: index finger extended, others curled.
   */
  _updatePoint(handIndex, hand) {
    // Get finger tip and metacarpal positions
    const indexTip = this._getJointPosition(hand, 'index-finger-tip');
    const indexMeta = this._getJointPosition(hand, 'index-finger-metacarpal');

    const middleTip = this._getJointPosition(hand, 'middle-finger-tip');
    const middleMeta = this._getJointPosition(hand, 'middle-finger-metacarpal');

    const ringTip = this._getJointPosition(hand, 'ring-finger-tip');
    const ringMeta = this._getJointPosition(hand, 'ring-finger-metacarpal');

    const pinkyTip = this._getJointPosition(hand, 'pinky-finger-tip');
    const pinkyMeta = this._getJointPosition(hand, 'pinky-finger-metacarpal');

    this._pointing[handIndex] = false;

    // Index must be extended
    if (!indexTip || !indexMeta) return;
    const indexLength = indexTip.distanceTo(indexMeta);
    if (indexLength < this.pointIndexMinExtension) return;

    // Other fingers must be curled (short)
    let othersCurled = true;

    if (middleTip && middleMeta) {
      const middleLength = middleTip.distanceTo(middleMeta);
      if (middleLength > this.pointFingerMaxCurl) othersCurled = false;
    }

    if (ringTip && ringMeta) {
      const ringLength = ringTip.distanceTo(ringMeta);
      if (ringLength > this.pointFingerMaxCurl) othersCurled = false;
    }

    if (pinkyTip && pinkyMeta) {
      const pinkyLength = pinkyTip.distanceTo(pinkyMeta);
      if (pinkyLength > this.pointFingerMaxCurl) othersCurled = false;
    }

    if (othersCurled) {
      this._pointing[handIndex] = true;
    }
  }

  /**
   * Detect open palm: all 5 fingers extended.
   */
  _updateOpenPalm(handIndex, hand) {
    const thumb = this._getFingerLength(hand, 'thumb');
    const index = this._getFingerLength(hand, 'index-finger');
    const middle = this._getFingerLength(hand, 'middle-finger');
    const ring = this._getFingerLength(hand, 'ring-finger');
    const pinky = this._getFingerLength(hand, 'pinky-finger');

    const allExtended =
      thumb > this.openPalmMinExtension &&
      index > this.openPalmMinExtension &&
      middle > this.openPalmMinExtension &&
      ring > this.openPalmMinExtension &&
      pinky > this.openPalmMinExtension;

    this._openPalm[handIndex] = allExtended;
  }

  /**
   * Check for Vision Pro transient pointer input source.
   * Transient pointer: user looks at object and pinches in the air.
   */
  _updateTransientPointer(session) {
    this._isTransientPointer = false;
    this._transientPointerInputSource = null;

    if (!session) return;

    const inputSources = session.inputSources;
    for (const source of inputSources) {
      // Vision Pro exposes hand input with transient-pointer targetRayMode
      if (source.hand && source.targetRayMode === 'transient-pointer') {
        this._isTransientPointer = true;
        this._transientPointerInputSource = source;
        break;
      }
    }
  }

  /**
   * Get the world position of a hand joint.
   * Returns a THREE.Vector3 or null if joint not tracked.
   */
  _getJointPosition(hand, jointName) {
    if (!hand || !hand.joints) return null;

    const joint = hand.joints[jointName];
    if (!joint) return null;

    // Check if joint is tracked (most browsers, but not required)
    const space = joint; // XRJointSpace is an XRSpace

    // The joint's position is available via the hand's world matrix.
    // For simplicity, we assume the hand object is positioned in world space
    // and we can get joint positions from the XRHand skeleton.

    // In three.js XRHandModelFactory, joints are stored as XRJointSpace objects.
    // We need to query their pose from the frame data.
    // However, for practical hand gesture detection, we can use the hand model's
    // child objects if available.

    // Fallback: get position from the hand's position + joint offset
    // (This is a simplified approach; full implementation would use frame data)

    try {
      // Try to get cached position from the joint
      if (joint.position) {
        return _tempVec3A.copy(joint.position);
      }

      // If hand model has bone hierarchy, traverse it
      if (hand.children.length > 0) {
        const model = hand.children[0]; // hand mesh/model
        const bone = this._findBoneByJointName(model, jointName);
        if (bone) {
          bone.getWorldPosition(_tempVec3A);
          return _tempVec3A;
        }
      }
    } catch (e) {
      // Joint not available
    }

    return null;
  }

  /**
   * Get finger length from metacarpal to tip.
   */
  _getFingerLength(hand, fingerPrefix) {
    const tip = this._getJointPosition(hand, `${fingerPrefix}-tip`);
    const meta = this._getJointPosition(hand, `${fingerPrefix}-metacarpal`);

    if (!tip || !meta) return 0;

    return tip.distanceTo(meta);
  }

  /**
   * Find a bone in the hand model hierarchy by joint name.
   * The XRHandModelFactory creates bones with names like "index-finger-tip".
   */
  _findBoneByJointName(object, jointName) {
    if (object.name === jointName) return object;

    for (const child of object.children) {
      const found = this._findBoneByJointName(child, jointName);
      if (found) return found;
    }

    return null;
  }

  // ── Getter API ──────────────────────────────────────────────────────

  /**
   * @param {number} handIndex - 0 for left, 1 for right
   * @returns {boolean} True if pinching
   */
  isPinching(handIndex) {
    return this._pinching[handIndex] ?? false;
  }

  /**
   * @param {number} handIndex - 0 for left, 1 for right
   * @returns {boolean} True if pointing
   */
  isPointing(handIndex) {
    return this._pointing[handIndex] ?? false;
  }

  /**
   * @param {number} handIndex - 0 for left, 1 for right
   * @returns {boolean} True if palm open
   */
  isOpenPalm(handIndex) {
    return this._openPalm[handIndex] ?? false;
  }

  /**
   * Get the pinch position (midpoint between thumb and index tips).
   * @param {number} handIndex - 0 for left, 1 for right
   * @returns {THREE.Vector3|null}
   */
  pinchPosition(handIndex) {
    const hand = this.hands[handIndex];
    if (!hand) return null;

    const thumbTip = this._getJointPosition(hand, 'thumb-tip');
    const indexTip = this._getJointPosition(hand, 'index-finger-tip');

    if (!thumbTip || !indexTip) return null;

    return _tempVec3A.addVectors(thumbTip, indexTip).multiplyScalar(0.5).clone();
  }

  /**
   * Get the pointing direction (from hand forward to index tip).
   * Returns a normalized direction vector, or null if not pointing.
   * @param {number} handIndex - 0 for left, 1 for right
   * @returns {THREE.Vector3|null}
   */
  pointDirection(handIndex) {
    if (!this._pointing[handIndex]) return null;

    const hand = this.hands[handIndex];
    if (!hand) return null;

    const indexTip = this._getJointPosition(hand, 'index-finger-tip');
    const wrist = this._getJointPosition(hand, 'wrist');

    if (!indexTip || !wrist) return null;

    return _tempVec3A.subVectors(indexTip, wrist).normalize().clone();
  }

  /**
   * Get the index finger tip position (for ray origin in pointing).
   * @param {number} handIndex - 0 for left, 1 for right
   * @returns {THREE.Vector3|null}
   */
  pointOrigin(handIndex) {
    if (!this._pointing[handIndex]) return null;

    const hand = this.hands[handIndex];
    if (!hand) return null;

    return this._getJointPosition(hand, 'index-finger-tip');
  }

  /**
   * Vision Pro compatibility: is a transient pointer input source active?
   * @returns {boolean}
   */
  get isTransientPointer() {
    return this._isTransientPointer;
  }

  /**
   * Get the transient pointer input source (if active).
   * @returns {XRInputSource|null}
   */
  get transientPointerInputSource() {
    return this._transientPointerInputSource;
  }
}
