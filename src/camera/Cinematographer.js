/**
 * Cinematographer — The camera operator for PolyFish
 *
 * In real nature documentaries, the cinematographer makes moment-to-moment decisions about:
 *   • Camera position and tracking speed
 *   • Lead room and composition (rule of thirds)
 *   • Depth of field (close-ups vs wide shots)
 *   • How to frame subjects beautifully even when they move unpredictably
 *
 * The Director says "follow that dolphin" — the Cinematographer decides:
 *   - Where exactly to position the camera
 *   - Where to look
 *   - How fast to move/pan
 *   - How to maintain composition
 *
 * This module computes each frame's camera position and look-at target for all 10 shot types.
 */

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { getTerrainHeight } from '../utils/Terrain.js';
import { getMacroWaveHeight } from '../utils/WaveUtils.js';

// ── Shot Type Constants ────────────────────────────────────────────────────
export const SHOT_TYPES = {
  ESTABLISHING_WIDE: 'ESTABLISHING_WIDE',
  HERO_PORTRAIT: 'HERO_PORTRAIT',
  CHASE_FOLLOW: 'CHASE_FOLLOW',
  SIDE_TRACK: 'SIDE_TRACK',
  GROUND_HIDE: 'GROUND_HIDE',
  SNELLS_WINDOW: 'SNELLS_WINDOW',
  SLOW_REVEAL: 'SLOW_REVEAL',
  FLY_THROUGH: 'FLY_THROUGH',
  REACTION_CUT: 'REACTION_CUT',
  MACRO_DETAIL: 'MACRO_DETAIL',
  KELP_EDGE: 'KELP_EDGE',
};

/**
 * Cinematographer class
 *
 * Computes camera framing and motion for each shot type.
 * Maintains shot-internal state (orbit angle, reveal distance, etc.) in _shotState.
 */
export class Cinematographer {
  constructor() {
    // Reusable Vector3 temporaries (avoid allocations per frame)
    this._tempVec3_pos = new THREE.Vector3();
    this._tempVec3_lookat = new THREE.Vector3();
    this._tempVec3_dir = new THREE.Vector3();
    this._tempVec3_offset = new THREE.Vector3();
    this._tempVec3_forward = new THREE.Vector3();
    this._tempVec3_side = new THREE.Vector3();
    this._tempVec3_up = new THREE.Vector3(0, 1, 0);

    // Additional temp vectors for per-frame damping calculations
    this._tempDelta = new THREE.Vector3();
    this._tempLookDelta = new THREE.Vector3();
    this._tempOffsetVec = new THREE.Vector3();

    // Shot-internal state (orbit angle, reveal distance, etc.)
    // Reset when a new shot begins
    this._shotState = {
      orbitAngle: 0,
      orbitDirection: 1, // 1 or -1 for variety
      revealStartDistance: 0,
      revealStartTime: 0,
      flyProgress: 0,
      groundPos: null,
      lastSubjectPos: null,
      lastLookAt: null,
    };

    // Track which shot type is currently active
    this._currentShotType = null;

    // For Issue 2: Velocity damping to prevent bounce/oscillation
    // Initialize as Vector3 instead of null to avoid allocations during copy()
    this._lastComputedPos = new THREE.Vector3();
    this._lastComputedLookAt = new THREE.Vector3();

    // For Issue 3: Camera direction continuity to prevent 180° flips
    this._lastCameraDirection = null;
  }

  /**
   * Main entry point: compute this frame's camera position and look-at.
   *
   * @param {Object} shotRequest - The shot request from Director:
   *   {
   *     type: string (one of SHOT_TYPES),
   *     subject: Creature (the primary subject, if any),
   *     secondarySubject: Creature (for reaction cuts, etc.),
   *     duration: number (shot duration in seconds)
   *   }
   * @param {number} dt - Delta time since last frame (seconds)
   * @param {number} elapsed - Total elapsed time since simulation start (seconds)
   * @param {Object} helpers - Helper functions and constants:
   *   {
   *     getTerrainHeight(x, z): number,
   *     getMacroWaveHeight(x, z, time): number,
   *     findNearestCreature(pos): Creature | null,
   *     findHotspot(): Vector3 | null,
   *     getAllCreatures(): Creature[],
   *     surfaceY: number
   *   }
   *
   * @returns {Object} { position: Vector3, lookAt: Vector3, smoothingRate: number, lookSmoothingRate: number }
   */
  computeFrame(shotRequest, dt, elapsed, helpers) {
    const shotType = shotRequest.type;

    // If the Director has flagged a death phase, override normal shot routing
    if (shotRequest._deathPhase) {
      const result = this._shotSubjectDeath(shotRequest, helpers);
      // Still apply velocity damping
      if (this._lastComputedPos.length() > 0) {
        const maxSpeed = 0.5;
        const maxDist = maxSpeed * dt;
        this._tempDelta.copy(result.position).sub(this._lastComputedPos);
        if (this._tempDelta.length() > maxDist) {
          this._tempDelta.setLength(maxDist);
          result.position.copy(this._lastComputedPos).add(this._tempDelta);
        }
        this._tempLookDelta.copy(result.lookAt).sub(this._lastComputedLookAt);
        const maxLookDist = 0.8 * dt;
        if (this._tempLookDelta.length() > maxLookDist) {
          this._tempLookDelta.setLength(maxLookDist);
          result.lookAt.copy(this._lastComputedLookAt).add(this._tempLookDelta);
        }
      }
      this._lastComputedPos.copy(result.position);
      this._lastComputedLookAt.copy(result.lookAt);
      return result;
    }

    // Reset shot state if transitioning to a new shot type
    if (shotType !== this._currentShotType) {
      this._resetShotState(shotType, shotRequest, helpers);
      this._currentShotType = shotType;
    }

    // Route to the appropriate shot method
    let result = null;
    switch (shotType) {
      case SHOT_TYPES.ESTABLISHING_WIDE:
        result = this._shotEstablishingWide(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.HERO_PORTRAIT:
        result = this._shotHeroPortrait(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.CHASE_FOLLOW:
        result = this._shotChaseFollow(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.SIDE_TRACK:
        result = this._shotSideTrack(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.GROUND_HIDE:
        result = this._shotGroundHide(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.SNELLS_WINDOW:
        result = this._shotSnellsWindow(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.SLOW_REVEAL:
        result = this._shotSlowReveal(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.FLY_THROUGH:
        result = this._shotFlyThrough(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.REACTION_CUT:
        result = this._shotReactionCut(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.MACRO_DETAIL:
        result = this._shotMacroDetail(shotRequest, dt, elapsed, helpers);
        break;
      case SHOT_TYPES.KELP_EDGE:
        result = this._shotKelpEdge(shotRequest, dt, elapsed, helpers);
        break;
      default:
        // Fallback to a safe default shot
        this._tempVec3_pos.set(0, 0, 10);
        this._tempVec3_lookat.set(0, 0, 0);
        result = {
          position: this._tempVec3_pos,
          lookAt: this._tempVec3_lookat,
          smoothingRate: 2.0,
          lookSmoothingRate: 1.0,
        };
    }

    // Issue 2: Internal damping to prevent bounce (velocity clamping)
    if (this._lastComputedPos.length() > 0) { // Check if initialized (not at origin on first frame)
      const maxSpeed = 0.5; // units per second - comfortable diver swimming speed
      const maxDist = maxSpeed * dt;
      this._tempDelta.copy(result.position).sub(this._lastComputedPos);
      if (this._tempDelta.length() > maxDist) {
        this._tempDelta.setLength(maxDist);
        result.position.copy(this._lastComputedPos).add(this._tempDelta);
      }
      // Same for lookAt
      this._tempLookDelta.copy(result.lookAt).sub(this._lastComputedLookAt);
      const maxLookSpeed = 0.8;
      const maxLookDist = maxLookSpeed * dt;
      if (this._tempLookDelta.length() > maxLookDist) {
        this._tempLookDelta.setLength(maxLookDist);
        result.lookAt.copy(this._lastComputedLookAt).add(this._tempLookDelta);
      }
    }
    this._lastComputedPos.copy(result.position);
    this._lastComputedLookAt.copy(result.lookAt);

    // Issue 3: Track camera facing direction for continuity
    if (result.position && result.lookAt) {
      this._lastCameraDirection = this._tempVec3_dir.copy(result.lookAt).sub(result.position).normalize();
    }

    return result;
  }

  /**
   * Reset shot-internal state when transitioning to a new shot.
   * @private
   */
  _resetShotState(shotType, shotRequest, helpers) {
    // For subject-focused shots, bias the orbit angle to show the creature's
    // profile (perpendicular to its forward direction) rather than behind it.
    const isProfileShot = shotType === SHOT_TYPES.HERO_PORTRAIT ||
                          shotType === SHOT_TYPES.MACRO_DETAIL ||
                          shotType === SHOT_TYPES.SLOW_REVEAL;
    if (isProfileShot && shotRequest.subject && shotRequest.subject.body) {
      const fwd = shotRequest.subject.body.getForwardDirection();
      // Perpendicular angle = atan2(fwd.z, fwd.x) + 90°
      const fwdAngle = Math.atan2(fwd.z, fwd.x);
      const side = Math.random() > 0.5 ? 1 : -1;
      this._shotState.orbitAngle = fwdAngle + side * (Math.PI / 2);
      // Add ±20° variation so it's not perfectly perpendicular every time
      this._shotState.orbitAngle += (Math.random() - 0.5) * (Math.PI / 4.5);
    } else if (this._lastCameraDirection && shotRequest.subject) {
      // Preserve camera direction to prevent 180° flips
      this._shotState.orbitAngle = Math.atan2(this._lastCameraDirection.z, this._lastCameraDirection.x) + Math.PI;
      // Add small random variation (±30°) for subtle freshness without jarring flip
      this._shotState.orbitAngle += (Math.random() - 0.5) * (Math.PI / 3);
    } else {
      this._shotState.orbitAngle = Math.random() * Math.PI * 2;
    }
    this._shotState.orbitDirection = Math.random() > 0.5 ? 1 : -1;

    // Issue 2: Reset velocity tracking so new shots aren't clamped from previous position
    // Set to origin to indicate uninitialized state in computeFrame
    this._lastComputedPos.set(0, 0, 0);
    this._lastComputedLookAt.set(0, 0, 0);

    // For slow reveal, capture the initial distance
    if (shotType === SHOT_TYPES.SLOW_REVEAL && shotRequest.subject) {
      this._shotState.revealStartDistance = 1.0;
      this._shotState.revealStartTime = 0;
    }

    // For ground hide, pick a random ground position
    if (shotType === SHOT_TYPES.GROUND_HIDE) {
      const creatures = helpers.getAllCreatures();
      if (creatures.length > 0) {
        const randomCreature = creatures[Math.floor(Math.random() * creatures.length)];
        const terrainY = helpers.getTerrainHeight(randomCreature.mesh.position.x, randomCreature.mesh.position.z);
        this._shotState.groundPos = new THREE.Vector3(
          randomCreature.mesh.position.x + (Math.random() - 0.5) * 8,
          terrainY + 0.5,
          randomCreature.mesh.position.z + (Math.random() - 0.5) * 8
        );
      } else {
        this._shotState.groundPos = new THREE.Vector3(0, helpers.getTerrainHeight(0, 0) + 0.5, 0);
      }
    }

    // For snells window, initialize random offset (computed once per shot)
    if (shotType === SHOT_TYPES.SNELLS_WINDOW) {
      this._shotState.snellOffset = {
        x: (Math.random() - 0.5) * 2,
        z: (Math.random() - 0.5) * 2,
      };
    }

    // For fly through, initialize start/end points
    if (shotType === SHOT_TYPES.FLY_THROUGH) {
      const creatures = helpers.getAllCreatures();
      if (!this._shotState.flyStart) {
        this._shotState.flyStart = new THREE.Vector3();
      }
      if (!this._shotState.flyEnd) {
        this._shotState.flyEnd = new THREE.Vector3();
      }
      if (creatures.length >= 2) {
        const c1 = creatures[Math.floor(Math.random() * creatures.length)];
        const c2 = creatures[Math.floor(Math.random() * creatures.length)];
        this._shotState.flyStart.copy(c1.mesh.position).add(new THREE.Vector3(3, 1, 0));
        this._shotState.flyEnd.copy(c2.mesh.position).add(new THREE.Vector3(-3, 1, 0));
      } else if (creatures.length === 1) {
        const c = creatures[0];
        this._shotState.flyStart.copy(c.mesh.position).add(new THREE.Vector3(5, 0, 5));
        this._shotState.flyEnd.copy(c.mesh.position).add(new THREE.Vector3(-5, 0, -5));
      } else {
        this._shotState.flyStart.set(-10, 0, -10);
        this._shotState.flyEnd.set(10, 0, 10);
      }
      this._shotState.flyProgress = 0;
    }

    if (!this._shotState.lastSubjectPos) {
      this._shotState.lastSubjectPos = new THREE.Vector3();
    }
    if (shotRequest.subject) {
      this._shotState.lastSubjectPos.copy(shotRequest.subject.mesh.position);
    } else {
      this._shotState.lastSubjectPos.set(0, 0, 0);
    }
    this._shotState.lastLookAt = null;
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 1: ESTABLISHING_WIDE
  // High, slow orbit showing the full ecosystem. Deep focus, wide lens. Orients viewer.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotEstablishingWide(shotRequest, dt, elapsed, helpers) {
    const clusterCenter = this._getClusterCenter(helpers);

    // Update orbit angle
    const orbitSpeed = 0.15; // rad/sec
    this._shotState.orbitAngle += orbitSpeed * this._shotState.orbitDirection * dt;

    // High vantage point, slow orbit
    const radius = 5.5;
    const height = 5.0;
    const camX = clusterCenter.x + Math.cos(this._shotState.orbitAngle) * radius;
    const camY = clusterCenter.y + height;
    const camZ = clusterCenter.z + Math.sin(this._shotState.orbitAngle) * radius;

    // Clamp camera above terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);

    // Clamp below surface
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.5);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Look at cluster center with slight height offset
    this._tempOffsetVec.set(0, 0.5, 0);
    this._tempVec3_lookat.copy(clusterCenter).add(this._tempOffsetVec);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.6, // Slow, contemplative orbit
      lookSmoothingRate: 0.4,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 2: HERO_PORTRAIT
  // Medium distance, slow orbit around subject. Rule of thirds, shallow DOF effect.
  // Creature at 1/3 mark, 2/3 open water behind.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotHeroPortrait(shotRequest, dt, elapsed, helpers) {
    if (!shotRequest.subject || shotRequest.subject.dead || !shotRequest.subject.active) {
      // Abort shot — creature is dead or gone
      return this._getDefaultPosition(helpers);
    }

    const subject = shotRequest.subject;
    const subjectPos = subject.mesh.position;

    // Update orbit angle
    const orbitSpeed = 0.08; // rad/sec, slower than establishing
    this._shotState.orbitAngle += orbitSpeed * this._shotState.orbitDirection * dt;

    // Orbit around subject at creature eye level, medium distance
    const radius = 2.5;
    const camX = subjectPos.x + Math.cos(this._shotState.orbitAngle) * radius;
    const camY = subjectPos.y; // Eye level with creature
    const camZ = subjectPos.z + Math.sin(this._shotState.orbitAngle) * radius;

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.3);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Lead the subject — use food target if available for intelligent anticipation,
    // otherwise fall back to forward direction leading.
    const leadOffset = this._computeLeadOffset(subject, 2.0, 0.6);
    this._tempVec3_lookat.copy(subjectPos).add(leadOffset);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 1.0,
      lookSmoothingRate: 0.6,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 3: CHASE_FOLLOW
  // Behind and slightly above the predator. Predator in lower third, prey visible ahead.
  // Heavy lead room — 2/3 of frame is in front of the predator.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotChaseFollow(shotRequest, dt, elapsed, helpers) {
    if (!shotRequest.subject || shotRequest.subject.dead || !shotRequest.subject.active) {
      return this._getDefaultPosition(helpers);
    }

    const predator = shotRequest.subject;
    const pos = predator.mesh.position;
    const fwd = predator.body.getForwardDirection();

    // Position camera at a quartering angle — behind-and-to-the-side of predator.
    // This shows the subject's profile rather than just its tail.
    const sideDir = this._shotState.orbitDirection; // 1 or -1, set on shot start
    const sideX = -fwd.z * sideDir;
    const sideZ = fwd.x * sideDir;
    const behindDist = 1.5;
    const sideDist = 1.8;
    const aboveHeight = 0.8;
    const camX = pos.x - fwd.x * behindDist + sideX * sideDist;
    const camY = pos.y + aboveHeight;
    const camZ = pos.z - fwd.z * behindDist + sideZ * sideDist;

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.3);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Look well ahead of predator — use food target for intelligent chase leading.
    // Places predator in the lower-back third of frame with the prey visible ahead.
    const leadOffset = this._computeLeadOffset(predator, 3.0, 0.7);
    leadOffset.y = Math.max(leadOffset.y, 0.3); // Keep slight upward tilt
    this._tempVec3_lookat.copy(pos).add(leadOffset);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.8,
      lookSmoothingRate: 0.5,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 4: SIDE_TRACK
  // Perpendicular to creature's forward. Eye level, 2-3 units away.
  // Shows creature profile and movement beautifully.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotSideTrack(shotRequest, dt, elapsed, helpers) {
    if (!shotRequest.subject || shotRequest.subject.dead || !shotRequest.subject.active) {
      return this._getDefaultPosition(helpers);
    }

    const subject = shotRequest.subject;
    const pos = subject.mesh.position;
    const fwd = subject.body.getForwardDirection();

    // Perpendicular to creature's forward (to the side)
    const sideX = -fwd.z;
    const sideZ = fwd.x;
    const sideDist = 2.8;

    const camX = pos.x + sideX * sideDist;
    const camY = pos.y + 0.0; // Eye level
    const camZ = pos.z + sideZ * sideDist;

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.3);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Lead the creature — use food target for intelligent side-track anticipation.
    // Camera is perpendicular, so leading places creature at one side with nose room.
    const leadOffset = this._computeLeadOffset(subject, 2.5, 0.5);
    leadOffset.y = Math.max(leadOffset.y, 0.1);
    this._tempVec3_lookat.copy(pos).add(leadOffset);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 1.0,
      lookSmoothingRate: 0.6,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 5: GROUND_HIDE
  // STATIC on seafloor. Camera doesn't move—only pans to track subjects passing through.
  // Feels observational, like a nature doc hide camera.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotGroundHide(shotRequest, dt, elapsed, helpers) {
    // Position is fixed on the seafloor (set in _resetShotState)
    if (!this._shotState.groundPos) {
      return this._getDefaultPosition(helpers);
    }

    this._tempVec3_pos.copy(this._shotState.groundPos);

    // Frame the action: find the cluster center and aim upward toward it.
    // This creates the classic "hide camera" shot — low on the reef floor,
    // framing the bustling life above. Very slow pan to keep it cinematic.
    if (!this._shotState.groundPanAngle) {
      // Initialize pan toward the cluster center
      const cluster = this._getClusterCenter(helpers);
      this._shotState.groundPanAngle = Math.atan2(
        cluster.z - this._tempVec3_pos.z,
        cluster.x - this._tempVec3_pos.x
      );
      this._shotState.groundPanSpeed = (Math.random() > 0.5 ? 1 : -1) * 0.02; // rad/sec — glacial
    }
    this._shotState.groundPanAngle += this._shotState.groundPanSpeed * dt;

    // Look upward into the water column where the creatures are.
    // Use a generous upward angle so we frame the "canopy" of activity above.
    const lookDist = 4.0;
    const lookX = this._tempVec3_pos.x + Math.cos(this._shotState.groundPanAngle) * lookDist;
    const lookZ = this._tempVec3_pos.z + Math.sin(this._shotState.groundPanAngle) * lookDist;
    // Look well above the camera — aim at the height where creatures typically swim
    const clusterCenter = this._getClusterCenter(helpers);
    const creatureHeight = Math.max(clusterCenter.y, this._tempVec3_pos.y + 2.0);
    const lookY = creatureHeight + 1.0; // Frame the action above

    this._tempVec3_lookat.set(lookX, lookY, lookZ);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.0, // STATIC — no camera movement
      lookSmoothingRate: 0.2, // Very slow pan
      isNonTracking: true, // Signal: don't override lookAt to follow creatures
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 6: SNELLS_WINDOW
  // Low position (near seafloor), angled upward. Surface light creates bright area at top,
  // subjects silhouetted against it. One of the most cinematic underwater shots.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotSnellsWindow(shotRequest, dt, elapsed, helpers) {
    if (!this._shotState.snellSubjectPos) {
      this._shotState.snellSubjectPos = new THREE.Vector3();
    }
    let subjectPos = this._shotState.snellSubjectPos;

    if (shotRequest.subject && shotRequest.subject.active && !shotRequest.subject.dead) {
      subjectPos.copy(shotRequest.subject.mesh.position);
    } else {
      // Use cluster center or a random creature
      const creatures = helpers.getAllCreatures();
      if (creatures.length > 0) {
        subjectPos.copy(creatures[Math.floor(Math.random() * creatures.length)].mesh.position);
      } else {
        subjectPos.copy(this._getClusterCenter(helpers));
      }
    }

    // Issue 1: Position camera with diagonal look-to-avoid gimbal lock
    // Less below the subject, more lateral offset = 30-45° look angle, not 80-90°
    const belowDist = 2.0;  // Less below = less vertical
    const lateralDist = 3.0; // More to the side = more diagonal
    const camX = subjectPos.x + (this._shotState.snellOffset.x * lateralDist);
    const camY = Math.max(subjectPos.y - belowDist, helpers.getTerrainHeight(camX, subjectPos.z) + 0.3);
    const camZ = subjectPos.z + (this._shotState.snellOffset.z * lateralDist);

    this._tempVec3_pos.set(camX, camY, camZ);

    // Look upward at 30-45 degree angle toward the subject
    // This frames the subject against the bright surface above
    this._tempOffsetVec.set(0, 1.0, 0);
    this._tempVec3_lookat.copy(subjectPos).add(this._tempOffsetVec);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.8,
      lookSmoothingRate: 0.5,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 7: SLOW_REVEAL
  // Starts very close to subject (1.0-1.5 units), slowly dollies backward over 10-15 sec.
  // Begins as tight portrait, ends as wide establishing. The "how small they really are" shot.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotSlowReveal(shotRequest, dt, elapsed, helpers) {
    if (!shotRequest.subject || shotRequest.subject.dead || !shotRequest.subject.active) {
      return this._getDefaultPosition(helpers);
    }

    const subject = shotRequest.subject;
    const subjectPos = subject.mesh.position;

    // Track elapsed time in this shot
    this._shotState.revealStartTime += dt;

    // Very slow pull-back: ~0.3-0.4 units/second
    const pullBackSpeed = 0.35;
    const currentDistance = this._shotState.revealStartDistance + (pullBackSpeed * this._shotState.revealStartTime);

    // Cap at max distance (avoid pulling back too far)
    const maxDistance = 6.0;
    const finalDistance = Math.min(currentDistance, maxDistance);

    // Update orbit angle slowly for subtle rotation
    const orbitSpeed = 0.03;
    this._shotState.orbitAngle += orbitSpeed * this._shotState.orbitDirection * dt;

    // Position camera at current distance, orbiting slowly
    const camX = subjectPos.x + Math.cos(this._shotState.orbitAngle) * finalDistance;
    const camY = subjectPos.y + 0.3; // Slightly above eye level
    const camZ = subjectPos.z + Math.sin(this._shotState.orbitAngle) * finalDistance;

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.3);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Lead the subject — use food target for intelligent slow-reveal anticipation
    const leadOffset = this._computeLeadOffset(subject, 1.0, 0.4);
    this._tempVec3_lookat.copy(subjectPos).add(leadOffset);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.8, // Smooth dolly
      lookSmoothingRate: 0.8,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 8: FLY_THROUGH
  // Smooth dolly between two points. Eased (smoothstep) motion.
  // Shows spatial relationships, transition between subjects.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotFlyThrough(shotRequest, dt, elapsed, helpers) {
    if (!this._shotState.flyStart || !this._shotState.flyEnd) {
      return this._getDefaultPosition(helpers);
    }

    // Advance fly progress
    this._shotState.flyProgress += dt / (shotRequest.duration || 8.0);
    this._shotState.flyProgress = Math.min(this._shotState.flyProgress, 1.0);

    // Smoothstep easing
    const t = this._shotState.flyProgress;
    const eased = t * t * (3 - 2 * t);

    // Interpolate between start and end positions
    this._tempVec3_pos.lerpVectors(this._shotState.flyStart, this._shotState.flyEnd, eased);

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(this._tempVec3_pos.x, this._tempVec3_pos.z);
    this._tempVec3_pos.y = Math.max(this._tempVec3_pos.y, terrainY + 0.3);
    this._tempVec3_pos.y = Math.min(this._tempVec3_pos.y, helpers.surfaceY - 0.3);

    // Non-tracking: look FORWARD along the dolly direction (not at a creature).
    // Camera simply observes the scenery as it glides through.
    const lookT = Math.min(eased + 0.15, 1.0);
    this._tempVec3_lookat.lerpVectors(this._shotState.flyStart, this._shotState.flyEnd, lookT);
    // Add gentle downward tilt so camera takes in the terrain below
    this._tempVec3_lookat.y -= 0.3;

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.6, // Very smooth, gliding motion — diver pace
      lookSmoothingRate: 0.4,
      isNonTracking: true, // Signal: don't override lookAt to follow creatures
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 9: REACTION_CUT
  // Quick setup near the reacting creature (1.5-2 units away).
  // Creature in center or slight thirds. Medium-close. Duration: 2-4 seconds.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotReactionCut(shotRequest, dt, elapsed, helpers) {
    if (!shotRequest.subject || shotRequest.subject.dead || !shotRequest.subject.active) {
      return this._getDefaultPosition(helpers);
    }

    const subject = shotRequest.subject;
    const subjectPos = subject.mesh.position;
    const fwd = subject.body.getForwardDirection();

    // Position camera in front of creature (catching their reaction/fleeing)
    const distance = 1.8;
    const camX = subjectPos.x + fwd.x * distance;
    const camY = subjectPos.y + 0.2; // Roughly eye level
    const camZ = subjectPos.z + fwd.z * distance;

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.3);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Look slightly behind the creature (we're in front of it) — reaction shots
    // show the creature's face/expression, looking back toward the threat/interest
    const leadOffset = this._computeLeadOffset(subject, 0.5, 0.3);
    // Invert for reaction (we want to see the creature's face, not where it's going)
    leadOffset.multiplyScalar(-1);
    leadOffset.y = 0;
    this._tempVec3_lookat.copy(subjectPos).add(leadOffset);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.8, // Moderate — dramatic but still clamped to diver speed
      lookSmoothingRate: 0.6,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 10: MACRO_DETAIL
  // Very close (0.8-1.2 units), at creature's level. Minimal movement.
  // Creature fills most of frame. Very shallow DOF — background is bokeh.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotMacroDetail(shotRequest, dt, elapsed, helpers) {
    if (!shotRequest.subject || shotRequest.subject.dead || !shotRequest.subject.active) {
      return this._getDefaultPosition(helpers);
    }

    const subject = shotRequest.subject;
    const subjectPos = subject.mesh.position;
    const fwd = subject.body.getForwardDirection();

    // Close to subject, slightly offset to the side
    // Keep outside collision radius (0.8) with margin to avoid constant push fights
    const closeDistance = 1.5;
    const sideX = -fwd.z * 0.3;
    const sideZ = fwd.x * 0.3;

    const camX = subjectPos.x - fwd.x * closeDistance + sideX;
    const camY = subjectPos.y + 0.1; // At creature level
    const camZ = subjectPos.z - fwd.z * closeDistance + sideZ;

    // Clamp to terrain
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const clampedCamY = Math.max(camY, terrainY + 0.3);
    const finalCamY = Math.min(clampedCamY, helpers.surfaceY - 0.3);

    this._tempVec3_pos.set(camX, finalCamY, camZ);

    // Lead the subject — use food target for intelligent macro-detail framing
    const leadOffset = this._computeLeadOffset(subject, 0.8, 0.3);
    leadOffset.y = Math.max(leadOffset.y, 0.05);
    this._tempVec3_lookat.copy(subjectPos).add(leadOffset);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.8, // Very slow, smooth micro-adjustments only
      lookSmoothingRate: 0.5,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // SHOT 11: KELP_EDGE
  // On the periphery of the kelp group, low, looking up and inward at ~75°.
  // Frames the kelp canopy above with light filtering through — very cinematic.
  // ══════════════════════════════════════════════════════════════════════════════════
  _shotKelpEdge(shotRequest, dt, elapsed, helpers) {
    const clusterCenter = this._getClusterCenter(helpers);

    // Initialize edge position once per shot
    if (!this._shotState.kelpEdgeAngle) {
      this._shotState.kelpEdgeAngle = Math.random() * Math.PI * 2;
      this._shotState.kelpEdgeDrift = (Math.random() > 0.5 ? 1 : -1) * 0.01; // Very slow orbit
    }
    this._shotState.kelpEdgeAngle += this._shotState.kelpEdgeDrift * dt;

    // Position on the outer edge of the kelp group, near the seafloor
    const edgeRadius = 6.0; // Outside the main cluster
    const camX = clusterCenter.x + Math.cos(this._shotState.kelpEdgeAngle) * edgeRadius;
    const camZ = clusterCenter.z + Math.sin(this._shotState.kelpEdgeAngle) * edgeRadius;
    const terrainY = helpers.getTerrainHeight(camX, camZ);
    const camY = terrainY + 0.6; // Just above the seafloor

    this._tempVec3_pos.set(camX, camY, camZ);

    // Look upward and inward toward the center of the kelp group at ~75°.
    // The look target is high up, roughly above the cluster center.
    // tan(75°) ≈ 3.73, so for every 1 unit horizontal toward center,
    // we look ~3.73 units upward.
    const dx = clusterCenter.x - camX;
    const dz = clusterCenter.z - camZ;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    // Place lookAt partway toward center and high up (75° from horizontal)
    const inwardFraction = 0.3; // Don't look all the way to center, just partway
    const lookX = camX + dx * inwardFraction;
    const lookZ = camZ + dz * inwardFraction;
    const lookY = camY + horizontalDist * inwardFraction * 3.73; // tan(75°)
    // Clamp below surface
    const finalLookY = Math.min(lookY, helpers.surfaceY - 0.2);

    this._tempVec3_lookat.set(lookX, finalLookY, lookZ);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.0, // Static position — only subtle drift from orbit
      lookSmoothingRate: 0.2, // Glacial gaze drift
      isNonTracking: true,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ══════════════════════════════════════════════════════════════════════════════════

  /**
   * Get the creature's current goal position (food target, flee target, etc.)
   * for intelligent lead framing. Returns null if no goal is known.
   * @private
   * @param {Object} subject - Creature to query
   * @returns {THREE.Vector3|null} World position of the goal, or null
   */
  _getSubjectGoalPosition(subject) {
    if (!subject) return null;

    // Check for food target (fish chasing food, manatees grazing, predators hunting)
    if (subject.foodTarget && (subject.foodTarget.active !== false) && !subject.foodTarget.dead) {
      // Use verlet node position for plant eaters if available
      if (subject.foodTarget.getGrazingNodeIndex !== undefined && subject._grazingNodeIdx != null) {
        const pos = subject.foodTarget.getVerletNodePos(subject._grazingNodeIdx);
        if (pos) return pos;
      }
      if (subject.foodTarget.mesh) return subject.foodTarget.mesh.position;
      if (subject.foodTarget.position) return subject.foodTarget.position;
    }

    // Check for flee target (prey fleeing predator — goal is "away from")
    // We don't use this for lead framing since it's away-from, not toward
    return null;
  }

  /**
   * Compute a lead-the-subject lookAt point.
   * If the creature has a food target, bias the lookAt toward that goal
   * so the viewer can see where the creature is headed (documentary anticipation).
   * Otherwise falls back to forward-direction leading.
   * @private
   * @param {Object} subject - Creature
   * @param {number} leadAmount - How far ahead to lead (units)
   * @param {number} goalBlend - 0–1, how much to blend toward the food target
   * @returns {THREE.Vector3} The lookAt offset to add to subject position
   */
  _computeLeadOffset(subject, leadAmount = 2.0, goalBlend = 0.5) {
    const fwd = subject.body.getForwardDirection();

    // Default: lead along forward direction
    const forwardLead = this._tempVec3_forward.set(fwd.x * leadAmount, 0.15, fwd.z * leadAmount);

    // Try to get food target for intelligent leading
    const goalPos = this._getSubjectGoalPosition(subject);
    if (goalPos) {
      // Direction from creature to its goal
      const subPos = subject.mesh.position;
      const toGoal = this._tempVec3_side.set(
        goalPos.x - subPos.x,
        goalPos.y - subPos.y,
        goalPos.z - subPos.z
      );
      const goalDist = toGoal.length();
      if (goalDist > 0.1) {
        toGoal.normalize().multiplyScalar(leadAmount);
        // Blend between forward-leading and goal-leading
        forwardLead.lerp(toGoal, goalBlend);
      }
    }

    return forwardLead;
  }

  /**
   * Get the center of the creature cluster (simple average of all creature positions).
   * @private
   */
  _getClusterCenter(helpers) {
    const creatures = helpers.getAllCreatures();
    if (creatures.length === 0) {
      return this._tempOffsetVec.set(0, 0, 0);
    }

    this._tempOffsetVec.set(0, 0, 0);
    for (const creature of creatures) {
      this._tempOffsetVec.add(creature.mesh.position);
    }
    this._tempOffsetVec.divideScalar(creatures.length);
    return this._tempOffsetVec;
  }

  /**
   * Handle subject death cinematically: follow the body to the floor,
   * then hold still for a solemn beat.
   * @private
   */
  _shotSubjectDeath(shotRequest, helpers) {
    const deathPhase = shotRequest._deathPhase || 'HOLD_BEAT';
    const subj = shotRequest.subject;

    // Try to get the subject's current position (body sinking) or last known
    let subjectPos = null;
    if (subj && subj.mesh) {
      subjectPos = subj.mesh.position;
    } else if (shotRequest._deathPos) {
      subjectPos = shotRequest._deathPos;
    }

    if (!subjectPos) {
      return this._getDefaultPosition(helpers);
    }

    if (deathPhase === 'FOLLOW_DOWN') {
      // Camera gently follows the sinking body from the side/above
      // Use the last computed camera position and slowly drift toward
      // a side-elevated view of the sinking creature
      const terrainY = helpers.getTerrainHeight(subjectPos.x, subjectPos.z);
      const floorY = terrainY + 0.3;

      // Maintain lateral distance, gently lower camera to watch descent
      if (this._lastComputedPos.length() > 0) {
        // Keep current camera XZ, gently lower Y to stay above subject
        const targetCamY = Math.max(subjectPos.y + 1.0, floorY + 0.5);
        this._tempVec3_pos.copy(this._lastComputedPos);
        this._tempVec3_pos.y = Math.min(this._tempVec3_pos.y, targetCamY + 1.5);
      } else {
        this._tempVec3_pos.set(
          subjectPos.x + 2.5,
          Math.max(subjectPos.y + 1.5, floorY + 0.5),
          subjectPos.z + 2.5
        );
      }

      // Look at the sinking body
      this._tempVec3_lookat.copy(subjectPos);

      return {
        position: this._tempVec3_pos,
        lookAt: this._tempVec3_lookat,
        smoothingRate: 0.4, // Gentle follow
        lookSmoothingRate: 0.6, // Track the body closely
      };
    }

    // HOLD_BEAT — camera stops moving, holds on the resting place
    if (this._lastComputedPos.length() > 0) {
      this._tempVec3_pos.copy(this._lastComputedPos);
    } else {
      this._tempVec3_pos.set(subjectPos.x + 2.5, subjectPos.y + 1.5, subjectPos.z + 2.5);
    }

    this._tempVec3_lookat.copy(subjectPos);

    return {
      position: this._tempVec3_pos,
      lookAt: this._tempVec3_lookat,
      smoothingRate: 0.0, // Completely still
      lookSmoothingRate: 0.1, // Very slight drift
    };
  }

  /**
   * Return a graceful fallback when a subject dies or despawns.
   * Instead of snapping away, holds the last camera position and slowly
   * pans toward the cluster — like a documentary crew lingering on the void.
   * @private
   */
  _getDefaultPosition(helpers) {
    const clusterCenter = this._getClusterCenter(helpers);
    // If we have a last known camera position, hold it (the Director will
    // advance the shot after a 2-second mourning beat).
    if (this._lastComputedPos.length() > 0) {
      return {
        position: this._lastComputedPos,
        lookAt: clusterCenter,
        smoothingRate: 0.0, // Don't move the camera
        lookSmoothingRate: 0.2, // Very slowly drift the gaze toward the cluster
      };
    }
    // True fallback: no prior position at all
    this._tempOffsetVec.set(3, 2, 3);
    this._tempVec3_pos.copy(clusterCenter).add(this._tempOffsetVec);
    return {
      position: this._tempVec3_pos,
      lookAt: clusterCenter,
      smoothingRate: 0.6,
      lookSmoothingRate: 0.4,
    };
  }
}
