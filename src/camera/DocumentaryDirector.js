/**
 * DocumentaryDirector — Editorial brain for the screensaver camera system
 *
 * In real nature documentaries, editors control pacing and rhythm by deciding:
 *   • Shot duration (establishing shots hold 8-12s, action cuts to 3-5s)
 *   • Sequence structure (establish scene → introduce subject → develop story → climax → resolve)
 *   • When to interrupt for dramatic moments (scout alerts on interesting behavior)
 *
 * Without this editorial layer, shots feel like security camera footage—random and disconnected.
 * This module ensures rhythm, variety, and narrative coherence.
 *
 * Key responsibilities:
 *   1. Manage shot sequencing (state machine: ESTABLISHING → INTRODUCE → DEVELOP → CLIMAX → RESOLVE)
 *   2. Track shot history to prevent repetition
 *   3. Set durations based on shot type and cinematographic context
 *   4. Handle scout interrupts (when interesting behavior is detected)
 *   5. Decide transition styles (BLEND, FADE_BLACK, CUT) based on shot properties
 */

import { randomRange } from '../utils/MathUtils.js';

// ── Shot Type Constants ────────────────────────────────────────────────────
/**
 * Shot type enum — each with distinct cinematographic properties.
 * Used both for decision-making and to classify visual grammar.
 */
export const SHOT_TYPES = {
  // Wide environmental shots (set the scene)
  ESTABLISHING_WIDE: 'ESTABLISHING_WIDE',   // High, slow orbit showing full reef/ecosystem
  SNELLS_WINDOW: 'SNELLS_WINDOW',           // Low angle looking up through water column

  // Subject introduction (meet a character)
  HERO_PORTRAIT: 'HERO_PORTRAIT',           // Medium close-up, rule-of-thirds, shallow DOF
  SIDE_TRACK: 'SIDE_TRACK',                 // Parallel to subject at eye level, nose room

  // Development shots (tell the story)
  GROUND_HIDE: 'GROUND_HIDE',               // Static on seafloor, creatures pass through
  MACRO_DETAIL: 'MACRO_DETAIL',             // Very tight, shallow DOF, bokeh background
  SLOW_REVEAL: 'SLOW_REVEAL',               // Starts tight on subject, pulls back to reveal scale
  FLY_THROUGH: 'FLY_THROUGH',               // Smooth dolly between two points of interest

  // Action/climax shots (tension and energy)
  CHASE_FOLLOW: 'CHASE_FOLLOW',             // Behind predator, tracking with lead room
  REACTION_CUT: 'REACTION_CUT',             // Quick cut to creature reacting (fleeing, eating)

  // Perspective shots
  KELP_EDGE: 'KELP_EDGE',                   // Peripheral kelp edge, looking up/inward at ~75°
};

// ── Sequence Phase Enum ────────────────────────────────────────────────────
/**
 * Editorial phases — the state machine that governs shot sequencing.
 * Each phase has a narrative purpose and preferred shot types.
 */
const SEQUENCE_PHASES = {
  ESTABLISHING: 'ESTABLISHING',  // Set the scene (1-2 shots of wide environmental views)
  INTRODUCE: 'INTRODUCE',        // Meet a character (hero portrait, side track)
  DEVELOP: 'DEVELOP',            // Tell the story (follow, ground hide, macro, slow reveal)
  CLIMAX: 'CLIMAX',              // Action/drama (chase, reaction cuts)
  RESOLVE: 'RESOLVE',            // Return to contemplation (ground hide, snells window, back to establishing)
};

// ── Baseline Durations (seconds) ────────────────────────────────────────────
/**
 * Cinematographic research-based durations.
 * These are the "ideal" holds; actual durations vary ±20% for organic feel.
 *
 * Key principle: Hold longer on establishing shots and portraits so the viewer
 * has time to absorb the scene. Cut faster during action to build tension.
 */
const BASELINE_DURATIONS = {
  [SHOT_TYPES.ESTABLISHING_WIDE]: { min: 12, base: 16, max: 20 },
  [SHOT_TYPES.SNELLS_WINDOW]: { min: 10, base: 14, max: 18 },
  [SHOT_TYPES.HERO_PORTRAIT]: { min: 12, base: 16, max: 20 },
  [SHOT_TYPES.SIDE_TRACK]: { min: 10, base: 15, max: 20 },
  [SHOT_TYPES.GROUND_HIDE]: { min: 10, base: 14, max: 18 },
  [SHOT_TYPES.MACRO_DETAIL]: { min: 10, base: 14, max: 18 },
  [SHOT_TYPES.SLOW_REVEAL]: { min: 14, base: 18, max: 24 },
  [SHOT_TYPES.FLY_THROUGH]: { min: 10, base: 14, max: 18 },
  [SHOT_TYPES.CHASE_FOLLOW]: { min: 8, base: 12, max: 15 },
  [SHOT_TYPES.REACTION_CUT]: { min: 6, base: 9, max: 12 },
  [SHOT_TYPES.KELP_EDGE]: { min: 10, base: 14, max: 18 },
};

// ── Shot Properties for Grammar Analysis ──────────────────────────────────
/**
 * Visual grammar classification for each shot type.
 * Used by _isExtremeCut to decide transition style (BLEND vs FADE_BLACK vs CUT).
 *
 * angle: -1 (worm's-eye/low) → 0 (eye-level) → 1 (bird's-eye/high)
 * size: 0 (extreme close-up/macro) → 1 (wide establishing)
 * motion: 0 (static/locked) → 1 (fully dynamic/tracking)
 * subject: whether shot is tied to a specific creature
 */
const SHOT_PROPERTIES = {
  [SHOT_TYPES.ESTABLISHING_WIDE]: {
    angle: 0.9,    // high orbit, looking down
    size: 1.0,     // widest possible frame
    motion: 0.4,   // slow, controlled orbit (not fully dynamic)
    subject: false, // environmental, not creature-locked
  },
  [SHOT_TYPES.SNELLS_WINDOW]: {
    angle: -0.8,   // very low, looking up
    size: 0.8,     // wide but not as extreme as orbit
    motion: 0.1,   // mostly static
    subject: false,
  },
  [SHOT_TYPES.HERO_PORTRAIT]: {
    angle: 0.2,    // slightly elevated from eye-level
    size: 0.25,    // close-up framing
    motion: 0.2,   // subtle micro-movements, mostly static
    subject: true, // locked to a creature
  },
  [SHOT_TYPES.SIDE_TRACK]: {
    angle: 0.0,    // eye-level profile
    size: 0.35,    // medium frame
    motion: 0.6,   // actively tracking creature movement
    subject: true,
  },
  [SHOT_TYPES.GROUND_HIDE]: {
    angle: -0.4,   // low, but not extreme
    size: 0.7,     // reasonable framing from seafloor
    motion: 0.0,   // completely static
    subject: false, // creatures pass through, we don't follow
  },
  [SHOT_TYPES.MACRO_DETAIL]: {
    angle: 0.1,    // roughly eye-level
    size: 0.0,     // extreme close-up
    motion: 0.2,   // subtle movements only
    subject: true,
  },
  [SHOT_TYPES.SLOW_REVEAL]: {
    angle: 0.3,    // elevated but not extreme
    size: 0.1,     // starts tight
    motion: 0.5,   // slow dolly back (moderate motion)
    subject: true,
  },
  [SHOT_TYPES.FLY_THROUGH]: {
    angle: 0.2,    // gentle elevation
    size: 0.6,     // medium-to-wide framing
    motion: 0.7,   // smooth, continuous dolly
    subject: false, // passing through space
  },
  [SHOT_TYPES.CHASE_FOLLOW]: {
    angle: 0.1,    // slightly elevated from creature
    size: 0.3,     // medium-close, lead room ahead
    motion: 0.9,   // highly dynamic, matching creature speed
    subject: true,
  },
  [SHOT_TYPES.REACTION_CUT]: {
    angle: 0.0,    // direct, eye-level confrontation
    size: 0.3,     // medium-close for emotional impact
    motion: 0.3,   // creature may move, but cut is about the expression
    subject: true,
  },
  [SHOT_TYPES.KELP_EDGE]: {
    angle: -0.6,   // low, looking upward at ~75°
    size: 0.7,     // wide environmental framing
    motion: 0.1,   // nearly static, slight drift
    subject: false, // environmental shot
  },
};

// ── Transition Type Constants ──────────────────────────────────────────────
/**
 * How to move between shots. Chosen based on visual grammar compatibility.
 */
const TRANSITION_TYPES = {
  BLEND: 'BLEND',           // Smooth crossfade (visually adjacent shots)
  FADE_BLACK: 'FADE_BLACK', // Fade to black, set up during hold (extreme cuts)
  CUT: 'CUT',               // Hard cut, immediate (reaction shots, action continuity)
};

// ── DOF (Depth of Field) Profile Constants ───────────────────────────────
/**
 * Tells the lens system how much to emphasize focus separation.
 * DEEP: everything in focus (wide establishing shots, terrain context)
 * MEDIUM: balanced (standard shots)
 * SHALLOW: heavily blurred background (portraits, macro, cinematic close-ups)
 */
const DOF_PROFILES = {
  DEEP: 'DEEP',
  MEDIUM: 'MEDIUM',
  SHALLOW: 'SHALLOW',
};

// ── Shot Priority Constants ───────────────────────────────────────────────
const PRIORITY_LEVELS = {
  LOW: 'LOW',           // Can wait or skip if not a good fit
  NORMAL: 'NORMAL',     // Standard scheduled shot
  HIGH: 'HIGH',         // Scout-suggested improvement, but not urgent
  INTERRUPT: 'INTERRUPT', // Scout alert on important behavior — pre-empt current shot
};

// ── Constants ──────────────────────────────────────────────────────────────
const MIN_SHOT_DURATION = 6.0;           // Never cut before 6 seconds (even for interrupts)
const SCOUT_INTERRUPT_THRESHOLD = 0.75;  // Scout priority level to trigger interrupt
const DURATION_VARIANCE = 0.2;           // ±20% randomness on all durations
const SHOT_HISTORY_LENGTH = 5;           // Remember last 5 shots to prevent repetition

// ── Phase-to-Shot-Types Mapping ───────────────────────────────────────────
/**
 * Editorial logic: each phase has a preferred set of shot types.
 * The director picks from these when advancing the sequence.
 */
const PHASE_SHOT_POOL = {
  [SEQUENCE_PHASES.ESTABLISHING]: [
    SHOT_TYPES.ESTABLISHING_WIDE,
    SHOT_TYPES.SIDE_TRACK,        // Subject shot mixed into establishing for variety
    SHOT_TYPES.SNELLS_WINDOW,
    SHOT_TYPES.HERO_PORTRAIT,     // Ensure we always show creatures early
  ],
  [SEQUENCE_PHASES.INTRODUCE]: [
    SHOT_TYPES.HERO_PORTRAIT,
    SHOT_TYPES.SIDE_TRACK,
    SHOT_TYPES.SIDE_TRACK,        // Double-weight — best looking shot
    SHOT_TYPES.MACRO_DETAIL,
  ],
  [SEQUENCE_PHASES.DEVELOP]: [
    SHOT_TYPES.SIDE_TRACK,
    SHOT_TYPES.SIDE_TRACK,        // Double-weight
    SHOT_TYPES.HERO_PORTRAIT,
    SHOT_TYPES.MACRO_DETAIL,
    SHOT_TYPES.SLOW_REVEAL,
    SHOT_TYPES.GROUND_HIDE,
  ],
  [SEQUENCE_PHASES.CLIMAX]: [
    SHOT_TYPES.SIDE_TRACK,        // Side view of the action
    SHOT_TYPES.CHASE_FOLLOW,
    SHOT_TYPES.REACTION_CUT,
    SHOT_TYPES.HERO_PORTRAIT,
    SHOT_TYPES.MACRO_DETAIL,
  ],
  [SEQUENCE_PHASES.RESOLVE]: [
    SHOT_TYPES.SIDE_TRACK,
    SHOT_TYPES.SLOW_REVEAL,
    SHOT_TYPES.HERO_PORTRAIT,
    SHOT_TYPES.SNELLS_WINDOW,
    SHOT_TYPES.ESTABLISHING_WIDE,
  ],
};

/**
 * DocumentaryDirector — manages editorial sequencing, timing, and narrative flow
 * for the screensaver camera system.
 */
export class DocumentaryDirector {
  constructor() {
    /**
     * Current sequence phase (ESTABLISHING, INTRODUCE, DEVELOP, CLIMAX, RESOLVE)
     * @type {string}
     */
    this.currentPhase = SEQUENCE_PHASES.ESTABLISHING;

    /**
     * How many shots we've taken in the current phase
     * Used to advance to the next phase after a few shots.
     * @type {number}
     */
    this.shotsInPhase = 0;

    /**
     * Target shots per phase (randomized per phase to avoid metronomic patterns)
     * @type {number}
     */
    this.targetShotsInPhase = 2;

    /**
     * Current shot being held
     * @type {Object|null}
     */
    this.currentShot = null;

    /**
     * How long the current shot has been held (seconds)
     * @type {number}
     */
    this.shotElapsed = 0;

    /**
     * Last 5 shot types (prevents consecutive repetition)
     * @type {Array<string>}
     */
    this.shotHistory = [];

    /**
     * For monitoring scout reports and interrupt logic
     * @type {Object|null}
     */
    this.lastScoutReport = null;

    /**
     * Time since last scout alert (used for interrupt cooldown)
     * @type {number}
     */
    this.timeSinceLastInterrupt = 0;

    /**
     * Interrupt cooldown (seconds) — avoid thrashing between interrupted shots
     * @type {number}
     */
    this.interruptCooldown = 3.0;

    // Initialize with a blank establishing shot request (will be filled on first update)
    this._initializeFirstShot();
  }

  /**
   * Create the initial shot request to begin the sequence.
   * The screensaver camera will immediately request a shot and start rendering.
   * @private
   */
  _initializeFirstShot() {
    this.currentShot = {
      type: SHOT_TYPES.ESTABLISHING_WIDE,
      duration: 10.0,
      subject: null,
      transitionStyle: TRANSITION_TYPES.BLEND,
      dofProfile: DOF_PROFILES.DEEP,
      priority: PRIORITY_LEVELS.NORMAL,
    };
    this.shotHistory.push(this.currentShot.type);
  }

  /**
   * Called each frame. If the current shot's time has expired,
   * returns a new ShotRequest. Otherwise returns null (keep current shot).
   *
   * @param {number} dt - Delta time (seconds since last frame)
   * @param {Object|null} scoutReport - Scout data: { type, priority, suggestedShotType, subject, ... }
   * @returns {Object|null} ShotRequest if transitioning, null to continue current shot
   */
  update(dt, scoutReport) {
    // Track shot elapsed time
    this.shotElapsed += dt;
    this.timeSinceLastInterrupt += dt;

    // Cache the scout report for analysis
    if (scoutReport) {
      this.lastScoutReport = scoutReport;
    }

    // Check if current target died or despawned mid-shot.
    // Follow them down, hold a solemn beat, then gracefully move on.
    if (this.currentShot.subject) {
      const subj = this.currentShot.subject;
      if (subj.dead || !subj.active) {
        if (!this._subjectDeathTime) {
          this._subjectDeathTime = this.shotElapsed;
          // Record where the subject was when it died, and mark the shot
          // so the Cinematographer can follow it to the floor
          this.currentShot._deathPos = subj.mesh
            ? subj.mesh.position.clone()
            : null;
          this.currentShot._deathPhase = 'FOLLOW_DOWN'; // FOLLOW_DOWN → HOLD_BEAT → done
        }
        const timeSinceDeath = this.shotElapsed - this._subjectDeathTime;

        // Phase 1: FOLLOW_DOWN — camera follows body toward seafloor (0–3s)
        if (timeSinceDeath < 3.0) {
          this.currentShot._deathPhase = 'FOLLOW_DOWN';
        }
        // Phase 2: HOLD_BEAT — camera holds still, solemn moment (3–5.5s)
        else if (timeSinceDeath < 5.5) {
          this.currentShot._deathPhase = 'HOLD_BEAT';
        }
        // Phase 3: Move on to next shot
        else {
          this._subjectDeathTime = null;
          this.currentShot._deathPhase = null;
          this.currentShot._deathPos = null;
          return this._advanceSequence(scoutReport);
        }
      }
    }

    // Check if scout wants to interrupt with a high-priority event
    // (e.g., predator chasing prey, dramatic feeding moment)
    const shouldInterrupt = this._checkScoutInterrupt();
    if (shouldInterrupt) {
      this._subjectDeathTime = null;
      return this._handleScoutInterrupt();
    }

    // Normal flow: check if current shot duration is exhausted
    if (this.shotElapsed >= this.currentShot.duration) {
      this._subjectDeathTime = null;
      return this._advanceSequence(scoutReport);
    }

    // Current shot still has time; hold it
    return null;
  }

  /**
   * Scout alerts director with high-priority behavior (predator-prey drama, feeding, etc.)
   * Director decides whether to interrupt the current shot.
   *
   * This is a secondary entry point for out-of-band scout alerts.
   * (The main path is through scoutReport in update().)
   *
   * @param {Object} event - Scout alert: { type, priority, subject, location, ... }
   * @returns {Object|null} ShotRequest if interrupting, null if ignoring the alert
   */
  onScoutAlert(event) {
    // Trigger an interrupt on the next update() call
    // (In practice, this might set a flag that _checkScoutInterrupt() reads)
    // Respect minimum shot duration — don't cut away from beautiful static shots early
    if (
      event.priority >= SCOUT_INTERRUPT_THRESHOLD &&
      this.timeSinceLastInterrupt >= this.interruptCooldown &&
      this.shotElapsed >= MIN_SHOT_DURATION
    ) {
      return this._handleScoutInterrupt();
    }
    return null;
  }

  /**
   * Check if the scout report is urgent enough to interrupt.
   * @private
   * @returns {boolean}
   */
  _checkScoutInterrupt() {
    if (!this.lastScoutReport || !this.lastScoutReport.hasMoment) {
      return false;
    }

    // Don't interrupt if we're too early in the shot (below minimum duration)
    if (this.shotElapsed < MIN_SHOT_DURATION) {
      return false;
    }

    // Don't interrupt if we're on cooldown (prevent thrashing)
    if (this.timeSinceLastInterrupt < this.interruptCooldown) {
      return false;
    }

    const excitement = this.lastScoutReport.excitement;

    // EPIC events (predator kill, birth): always interrupt
    if (excitement === 'EPIC') {
      return true;
    }

    // HIGH events (active chase, death): interrupt only if current shot > 50% done
    if (excitement === 'HIGH') {
      const progress = this.shotElapsed / (this.currentShot?.duration || 8);
      return progress > 0.5;
    }

    // MEDIUM/LOW events: never interrupt — wait for natural shot end
    return false;
  }

  /**
   * Handle a scout-triggered interrupt.
   * Cut immediately to the action (or suggested shot type).
   * Does NOT force a phase change — lets editorial pacing remain intact.
   * @private
   * @returns {Object} ShotRequest
   */
  _handleScoutInterrupt() {
    const report = this.lastScoutReport;

    // Try to use scout's suggested shot type if available
    let shotType = report.suggestedShotType || SHOT_TYPES.CHASE_FOLLOW;

    // Don't force CLIMAX phase — instead, just count it as a shot in current phase.
    // This prevents scout interrupts from permanently locking us into CLIMAX.
    this.shotsInPhase++;

    // Create the interrupt shot
    const duration = this._calculateDuration(shotType);
    const newShot = {
      type: shotType,
      duration,
      subject: report.subject || null,
      transitionStyle: TRANSITION_TYPES.CUT,  // Hard cut for immediate drama
      dofProfile: this._selectDOFProfile(shotType),
      priority: PRIORITY_LEVELS.INTERRUPT,
    };

    this.currentShot = newShot;
    this.shotElapsed = 0;
    this.shotHistory.push(shotType);
    this.timeSinceLastInterrupt = 0;

    return newShot;
  }

  /**
   * Advance to the next shot in the sequence.
   * This is the core editorial loop: pick next phase, select shot type, set duration.
   * @private
   * @param {Object|null} scoutReport - Current scout data (for guidance on subject selection)
   * @returns {Object} ShotRequest
   */
  _advanceSequence(scoutReport) {
    // Check if we should move to the next phase
    this.shotsInPhase++;
    if (this.shotsInPhase >= this.targetShotsInPhase) {
      this._transitionPhase();
    }

    // Select next shot type from the current phase's pool
    const shotType = this._selectShotType();

    // Determine subject (creature to focus on)
    const subject = this._selectSubject(shotType, scoutReport);

    // Calculate duration with ±20% variance for organic feel
    const duration = this._calculateDuration(shotType);

    // Decide transition style based on visual grammar
    const transitionStyle = this._selectTransition(
      this.currentShot.type,
      shotType
    );

    // Select DOF profile (cinematic focus separation)
    const dofProfile = this._selectDOFProfile(shotType);

    // Create and return the new shot request
    const newShot = {
      type: shotType,
      duration,
      subject,
      transitionStyle,
      dofProfile,
      priority: PRIORITY_LEVELS.NORMAL,
    };

    this.currentShot = newShot;
    this.shotElapsed = 0;
    this.shotHistory.push(shotType);

    return newShot;
  }

  /**
   * Move to the next phase in the editorial sequence.
   * Handles the state machine: ESTABLISHING → INTRODUCE → DEVELOP → CLIMAX → RESOLVE → (cycle)
   * @private
   */
  _transitionPhase() {
    const phases = [
      SEQUENCE_PHASES.ESTABLISHING,
      SEQUENCE_PHASES.INTRODUCE,
      SEQUENCE_PHASES.DEVELOP,
      SEQUENCE_PHASES.CLIMAX,
      SEQUENCE_PHASES.RESOLVE,
    ];

    const currentIndex = phases.indexOf(this.currentPhase);
    const nextIndex = (currentIndex + 1) % phases.length;

    this.currentPhase = phases[nextIndex];
    this.shotsInPhase = 0;

    // Phase-specific shot counts: give contemplative phases more room,
    // keep CLIMAX short so we cycle back to ESTABLISHING frequently.
    switch (this.currentPhase) {
      case SEQUENCE_PHASES.ESTABLISHING:
        // 2-3 shots: let the viewer breathe and absorb the environment
        this.targetShotsInPhase = Math.floor(randomRange(2, 4));
        break;
      case SEQUENCE_PHASES.INTRODUCE:
        // 2-4 shots: spend time meeting characters
        this.targetShotsInPhase = Math.floor(randomRange(2, 4.5));
        break;
      case SEQUENCE_PHASES.DEVELOP:
        // 3-5 shots: this is the meat — lots of variety
        this.targetShotsInPhase = Math.floor(randomRange(3, 5.5));
        break;
      case SEQUENCE_PHASES.CLIMAX:
        // 1-2 shots only: keep tension short and impactful, then cycle back
        this.targetShotsInPhase = Math.floor(randomRange(1, 2.5));
        break;
      case SEQUENCE_PHASES.RESOLVE:
        // 2-3 shots: wind down before re-establishing
        this.targetShotsInPhase = Math.floor(randomRange(2, 3.5));
        break;
      default:
        this.targetShotsInPhase = 2;
    }
  }

  /**
   * Select the next shot type from the current phase's pool.
   * Scores candidates by visual distance from the last shot to ensure
   * consecutive shots are visually distinct, not just different by name.
   * @private
   * @returns {string} Shot type constant
   */
  _selectShotType() {
    const pool = PHASE_SHOT_POOL[this.currentPhase];
    if (!pool || pool.length === 0) {
      // Fallback (should never happen if design is solid)
      return SHOT_TYPES.ESTABLISHING_WIDE;
    }

    // Get the last shot type for visual distance comparison
    const lastType = this.shotHistory.length > 0 ? this.shotHistory[this.shotHistory.length - 1] : null;
    const secondLastType = this.shotHistory.length > 1 ? this.shotHistory[this.shotHistory.length - 2] : null;

    // Filter out exact repeat of last shot
    let candidates = pool.filter(type => type !== lastType);
    if (candidates.length === 0) candidates = pool;

    // If we have a last shot, score candidates by visual distance
    if (lastType && SHOT_PROPERTIES[lastType]) {
      const lastProps = SHOT_PROPERTIES[lastType];

      // Score each candidate by how visually different it is from the last shot
      const scored = candidates.map(type => {
        const props = SHOT_PROPERTIES[type];
        if (!props) return { type, score: 0.5 };

        // Visual distance: weighted sum of property differences
        const angleDiff = Math.abs(props.angle - lastProps.angle);
        const sizeDiff = Math.abs(props.size - lastProps.size);
        const motionDiff = Math.abs(props.motion - lastProps.motion);
        const subjectChange = props.subject !== lastProps.subject ? 0.3 : 0;

        // Higher score = more visually different = preferred
        let score = angleDiff * 0.3 + sizeDiff * 0.3 + motionDiff * 0.2 + subjectChange;

        // Penalty for being same as second-to-last shot (avoid A-B-A-B pattern)
        if (type === secondLastType) score *= 0.3;

        return { type, score };
      });

      // Sort by score descending, pick from top half with some randomness
      scored.sort((a, b) => b.score - a.score);
      const topHalf = scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
      return topHalf[Math.floor(Math.random() * topHalf.length)].type;
    }

    // No history — random pick
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * Select which creature (if any) to focus on.
   * Mostly returns null (environmental shots don't need a specific subject),
   * but for portrait/tracking shots, could come from scout's active moment.
   * Returns null to signal the CameraController to pick the nearest creature.
   * @private
   * @param {string} shotType - The selected shot type
   * @param {Object|null} scoutReport - Scout data
   * @returns {Object|null} Creature reference or null
   */
  _selectSubject(shotType, scoutReport) {
    // Subject-less shots (environmental/wide)
    if (
      shotType === SHOT_TYPES.ESTABLISHING_WIDE ||
      shotType === SHOT_TYPES.SNELLS_WINDOW ||
      shotType === SHOT_TYPES.GROUND_HIDE ||
      shotType === SHOT_TYPES.FLY_THROUGH ||
      shotType === SHOT_TYPES.KELP_EDGE
    ) {
      return null;
    }

    // Subject-required shots (portraits, tracking, macro)
    // Try to use scout's active subject if available and alive
    if (scoutReport && scoutReport.subject) {
      const subj = scoutReport.subject;
      if (subj.active && !subj.dead) {
        return subj;
      }
    }

    // Otherwise, let the camera controller pick a nearby creature
    // (It will do this via findNearestCreature or pickRandomCreature)
    return null;
  }

  /**
   * Calculate the shot duration (seconds) with cinematographic context.
   * Base duration from BASELINE_DURATIONS, plus ±20% randomness.
   * @private
   * @param {string} shotType - The shot type
   * @returns {number} Duration in seconds
   */
  _calculateDuration(shotType) {
    const config = BASELINE_DURATIONS[shotType];
    if (!config) {
      return 6.0; // Safe fallback
    }

    // Random within [min, max], weighted toward 'base'
    const variance = randomRange(-DURATION_VARIANCE, DURATION_VARIANCE);
    const duration = config.base * (1 + variance);

    return Math.max(config.min, Math.min(config.max, duration));
  }

  /**
   * Decide the transition style based on visual grammar compatibility.
   * Uses _isExtremeCut logic ported from CameraController.
   * @private
   * @param {string} fromType - Previous shot type
   * @param {string} toType - Next shot type
   * @returns {string} Transition type (BLEND, FADE_BLACK, or CUT)
   */
  _selectTransition(fromType, toType) {
    // Never interpolate between shots — always use a proper cinematic transition.
    // Fade-to-black for big visual grammar changes, CUT for related shots.
    if (this._isExtremeCut(fromType, toType)) {
      return TRANSITION_TYPES.FADE_BLACK;
    }

    // For visually adjacent shots (similar angle/size/motion), use a quick fade
    // rather than interpolation — it's cleaner and more documentary-like
    return TRANSITION_TYPES.FADE_BLACK;
  }

  /**
   * Analyze whether a cut between two shot types is visually "extreme"
   * and requires fade-to-black rather than a smooth blend.
   *
   * Based on cinematographic research: a smooth transition works when shots
   * are visually adjacent (similar angle, size, motion). Extreme changes
   * require a transition effect (fade or cut) to ease the reframing.
   *
   * @private
   * @param {string} fromType - Shot type we're leaving
   * @param {string} toType - Shot type we're entering
   * @returns {boolean} true if extreme cut, false if smooth blend is OK
   */
  _isExtremeCut(fromType, toType) {
    const from = SHOT_PROPERTIES[fromType];
    const to = SHOT_PROPERTIES[toType];

    if (!from || !to) {
      return false; // Unknown shot types, assume safe blend
    }

    // Rule 1: ANGLE REVERSAL — big vertical angle swing (bird's-eye ↔ worm's-eye)
    // Threshold: > 0.8 means a significant swing from high to low or vice versa
    if (Math.abs(from.angle - to.angle) > 0.8) {
      return true;
    }

    // Rule 2: SHOT SIZE JUMP — extreme reframing (macro close-up ↔ wide establishing)
    // Threshold: > 0.4 means a significant reframe (e.g., 0.0 to 0.4+)
    if (Math.abs(from.size - to.size) > 0.4) {
      return true;
    }

    // Rule 3: MOTION STYLE CHANGE — static ↔ dynamic tracking
    // Threshold: > 0.6 means a big shift in camera movement (locked tripod ↔ chase cam)
    if (Math.abs(from.motion - to.motion) > 0.6) {
      return true;
    }

    // Rule 4: SUBJECT CHANGE — one shot tracks a creature, the other doesn't
    // Switching from creature-locked to environmental (or vice versa) is jarring
    if (from.subject !== to.subject) {
      return true;
    }

    // Otherwise: shots are visually "adjacent" in the grammar—smooth blend is fine
    return false;
  }

  /**
   * Select DOF (depth of field) profile for cinematic emphasis.
   * @private
   * @param {string} shotType - The shot type
   * @returns {string} DOF profile (DEEP, MEDIUM, SHALLOW)
   */
  _selectDOFProfile(shotType) {
    switch (shotType) {
      // Wide environmental shots: everything should be in focus (full depth)
      case SHOT_TYPES.ESTABLISHING_WIDE:
      case SHOT_TYPES.SNELLS_WINDOW:
      case SHOT_TYPES.GROUND_HIDE:
      case SHOT_TYPES.FLY_THROUGH:
      case SHOT_TYPES.KELP_EDGE:
        return DOF_PROFILES.DEEP;

      // Close-ups and portraits: shallow DOF to isolate the subject
      case SHOT_TYPES.HERO_PORTRAIT:
      case SHOT_TYPES.MACRO_DETAIL:
      case SHOT_TYPES.SLOW_REVEAL:
        return DOF_PROFILES.SHALLOW;

      // Medium shots: balanced DOF
      case SHOT_TYPES.SIDE_TRACK:
      case SHOT_TYPES.CHASE_FOLLOW:
      case SHOT_TYPES.REACTION_CUT:
        return DOF_PROFILES.MEDIUM;

      default:
        return DOF_PROFILES.MEDIUM;
    }
  }

  /**
   * Get the current shot being held.
   * @returns {Object} Current ShotRequest
   */
  getCurrentShot() {
    return this.currentShot;
  }

  /**
   * Force a reset to the beginning of the sequence.
   * Called when entering screensaver mode for the first time.
   */
  resetSequence() {
    this.currentPhase = SEQUENCE_PHASES.ESTABLISHING;
    this.shotsInPhase = 0;
    this.targetShotsInPhase = 2;
    this.shotHistory = [];
    this.lastScoutReport = null;
    this.timeSinceLastInterrupt = 0;
    this._initializeFirstShot();
  }

  /**
   * Get diagnostic info about current state (for HUD or debugging).
   * @returns {Object} State snapshot
   */
  getDebugInfo() {
    return {
      phase: this.currentPhase,
      shotsInPhase: this.shotsInPhase,
      targetShotsInPhase: this.targetShotsInPhase,
      currentShotType: this.currentShot?.type,
      shotElapsed: this.shotElapsed,
      shotDuration: this.currentShot?.duration,
      shotHistory: this.shotHistory,
      lastScoutPriority: this.lastScoutReport?.priority || 'none',
    };
  }
}

