import * as THREE from 'three';

/**
 * EcosystemScout - Wildlife documentary observation system
 *
 * Like a wildlife scout who watches the ecosystem and alerts the camera crew
 * to "moments worth filming" — predator chases, births, dramatic escapes, etc.
 *
 * This module continuously scans the ecosystem for interesting behavioral moments,
 * scores them by priority, and suggests camera shots with appropriate framing.
 *
 * Key design principles:
 * - Lightweight scanning: ~20 creatures per frame (round-robin), not all per frame
 * - Natural lifespans: moments decay as they persist (don't watch same chase for 30s)
 * - Event cooldowns: prevent spam (e.g., alert on chase every ~10 seconds, not every frame)
 * - State deltas: track creature changes (births, deaths) since last frame
 */

export class EcosystemScout {
  /**
   * @param {Array<{pool: ObjectPool, type: string}>} creaturePools - Creature pools from main.js
   * @param {Object} config - Configuration object with surfaceY and other settings
   */
  constructor(creaturePools, config) {
    this.creaturePools = creaturePools;
    this.config = config;

    // Current best moment report
    this.currentReport = {
      hasMoment: false,
      priority: 0,
      type: null,
      subject: null,
      secondarySubject: null,
      suggestedShot: null,
      suggestedDuration: 0,
      position: new THREE.Vector3(),
      startTime: 0,
    };

    // Event detection state
    this.eventCooldowns = {}; // Track time since last event of each type
    this.creatureStates = new Map(); // Track creature state deltas (offspring count, etc)
    this.scoutCandidates = []; // Candidates considered in current frame

    // Scanning budget
    this.scanBudgetPerFrame = 20; // creatures to scan per frame
    this.scanIndex = 0; // Current position in round-robin scan

    // School detection cache (expensive, run every N frames)
    this.schoolDetectionInterval = 60; // Frames between school scans
    this.framesSinceSchoolScan = 0;
    this.lastDetectedSchools = []; // Array of school centers from last scan

    // Reusable vectors for allocation efficiency
    this._tempVec3 = new THREE.Vector3();
    this._tempVec3_2 = new THREE.Vector3();
    this._schoolCacheVec = new THREE.Vector3();

    // Default cooldowns (seconds) per event type
    this.defaultCooldowns = {
      'PREDATOR_CHASE': 10.0,
      'PREY_FLEEING': 8.0,
      'CREATURE_DASHING': 6.0,
      'DOLPHIN_SURFACING': 8.0,
      'SCHOOL_FORMING': 20.0,
      'BIRTH_EVENT': 15.0,
      'DEATH_EVENT': 12.0,
      'FEEDING': 5.0,
    };

    // Excitement tiers — only HIGH and above can interrupt the current shot.
    // LOW/MEDIUM events are noted but won't pre-empt what we're filming.
    //   EPIC (95+):   Once-in-a-lifetime (predator kill, birth)
    //   HIGH (75-94):  Peak drama (active chase, death)
    //   MEDIUM (40-74): Interesting (fleeing prey, surfacing dolphin)
    //   LOW (0-39):    Background texture (dashing, feeding, schooling)
    this.EXCITEMENT_TIERS = {
      EPIC: 95,    // Always interrupt
      HIGH: 75,    // Interrupt if current shot > 50% done
      MEDIUM: 40,  // Never interrupt, but remember for next shot
      LOW: 0,      // Background — ignore for interrupt purposes
    };

    // Initialize all cooldowns to -Infinity (can trigger immediately)
    for (const eventType of Object.keys(this.defaultCooldowns)) {
      this.eventCooldowns[eventType] = -Infinity;
    }

    // Track last known offspring count per creature for birth detection
    this._lastOffspringCounts = new WeakMap();
  }

  /**
   * Update the scout — scan ecosystem, detect moments, return best candidate
   * Called once per frame
   *
   * @param {number} dt - Delta time since last frame
   * @returns {Object} ScoutReport with current best moment
   */
  update(dt) {
    // Decay cooldowns (use for..in to avoid Object.keys() allocation)
    for (const eventType in this.eventCooldowns) {
      this.eventCooldowns[eventType] += dt;
    }

    // Clear previous candidates (reuse array, avoid allocation)
    this.scoutCandidates.length = 0;

    // Perform round-robin creature scan
    this._scanCreaturesBudget();

    // Check school formation (cheaper — cached, run every 60 frames)
    this.framesSinceSchoolScan++;
    if (this.framesSinceSchoolScan >= this.schoolDetectionInterval) {
      this._detectSchools();
      this.framesSinceSchoolScan = 0;
    }

    // Pick best candidate based on priority
    if (this.scoutCandidates.length > 0) {
      this.scoutCandidates.sort((a, b) => b.priority - a.priority);
      const best = this.scoutCandidates[0];

      // Decay priority for moments that persist over time
      const persistencePenalty = Math.max(0, 1.0 - (Date.now() - best.startTime) / 1000 / best.suggestedDuration);
      best.priority *= persistencePenalty;

      // Tag with excitement tier for the Director to use
      if (best.priority >= this.EXCITEMENT_TIERS.EPIC) {
        best.excitement = 'EPIC';
      } else if (best.priority >= this.EXCITEMENT_TIERS.HIGH) {
        best.excitement = 'HIGH';
      } else if (best.priority >= this.EXCITEMENT_TIERS.MEDIUM) {
        best.excitement = 'MEDIUM';
      } else {
        best.excitement = 'LOW';
      }

      // Check if moment has naturally ended
      if (!this._isMomentActive(best)) {
        this.currentReport.hasMoment = false;
        this.currentReport.priority = 0;
        return this.currentReport;
      }

      // Update current report
      this.currentReport = best;
      return this.currentReport;
    }

    // No candidates this frame
    this.currentReport.hasMoment = false;
    this.currentReport.priority = 0;
    return this.currentReport;
  }

  /**
   * Get the current best moment without updating
   * @returns {Object} Current ScoutReport
   */
  getBestMoment() {
    return this.currentReport;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PRIVATE: Scanning & Detection
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Scan N creatures per frame in round-robin fashion
   * Detects predator chases, prey fleeing, dashing, feeding, births, deaths
   */
  _scanCreaturesBudget() {
    let scannedCount = 0;

    for (const { pool, type } of this.creaturePools) {
      const creatures = pool.pool;

      // Continue round-robin from where we left off
      while (scannedCount < this.scanBudgetPerFrame && this.scanIndex < creatures.length) {
        const creature = creatures[this.scanIndex];
        this.scanIndex++;
        scannedCount++;

        if (!creature.active) continue;

        // Check multiple event types for this creature
        this._detectPredatorChase(creature);
        this._detectPreyFleeing(creature);
        this._detectCreatureDashing(creature);
        this._detectDolphinSurfacing(creature);
        this._detectBirthEvent(creature);
        this._detectDeathEvent(creature);
        this._detectFeeding(creature);
      }

      // Wrap around to start of pool
      if (this.scanIndex >= creatures.length) {
        this.scanIndex = 0;
      }

      // Break if we've hit our budget for this frame
      if (scannedCount >= this.scanBudgetPerFrame) {
        break;
      }
    }
  }

  /**
   * Detect when a predator (dolphin) is actively hunting prey (fish)
   *
   * **Why this is cinematic:** The chase is the essence of predator-prey drama.
   * A dolphin sprinting through a school to catch a fish is a peak moment in
   * nature — tension, speed, the outcome uncertain until the last moment.
   *
   * Priority: 90 (very high — chases are the documentary's bread and butter)
   */
  _detectPredatorChase(creature) {
    if (creature.type !== 'dolphin') return;
    if (!creature._sprinting || !creature.foodTarget) return;

    // Check cooldown
    if (this.eventCooldowns['PREDATOR_CHASE'] < this.defaultCooldowns['PREDATOR_CHASE']) {
      return; // Still cooling down, don't spam
    }

    // Prey must be a fish, not dead
    const prey = creature.foodTarget;
    if (prey.type !== 'fish' || !prey.active || prey.dead) return;

    this.eventCooldowns['PREDATOR_CHASE'] = 0; // Trigger cooldown

    const report = {
      hasMoment: true,
      priority: 90,
      type: 'PREDATOR_CHASE',
      subject: creature, // the hunting dolphin
      secondarySubject: prey, // the fleeing fish
      suggestedShot: 'CHASE_FOLLOW',
      suggestedDuration: 4, // chases typically last 3-5 seconds
      position: creature.mesh.position.clone(),
      startTime: Date.now(),
    };

    this.scoutCandidates.push(report);
  }

  /**
   * Detect when prey is fleeing from a predator
   *
   * **Why this is cinematic:** A fleeing fish shows panic, desperation, the
   * natural response to danger. It's the other side of the predator-prey story.
   * The camera cuts to the fish, showing its evasive maneuvers and fear.
   *
   * Priority: 70 (high — dramatic escape sequences)
   */
  _detectPreyFleeing(creature) {
    if (creature.type !== 'fish') return;
    if (!creature.isFleeing) return;

    // Check cooldown
    if (this.eventCooldowns['PREY_FLEEING'] < this.defaultCooldowns['PREY_FLEEING']) {
      return;
    }

    this.eventCooldowns['PREY_FLEEING'] = 0;

    const report = {
      hasMoment: true,
      priority: 70,
      type: 'PREY_FLEEING',
      subject: creature, // the fleeing fish
      secondarySubject: creature.fleeTarget, // the predator (optional)
      suggestedShot: 'REACTION_CUT',
      suggestedDuration: 3,
      position: creature.mesh.position.clone(),
      startTime: Date.now(),
    };

    this.scoutCandidates.push(report);
  }

  /**
   * Detect when a creature dashes toward food
   *
   * **Why this is cinematic:** A dash is a burst of effort and determination.
   * The creature accelerates suddenly toward its target — a dynamic,
   * energy-filled moment that shows hunting intent and drive.
   *
   * Priority: 40 (moderate — interesting but less dramatic than chases)
   */
  _detectCreatureDashing(creature) {
    if (!creature._isDashing || !creature.foodTarget) return;

    // Check cooldown
    if (this.eventCooldowns['CREATURE_DASHING'] < this.defaultCooldowns['CREATURE_DASHING']) {
      return;
    }

    // Verify foodTarget is still valid
    if (!creature.foodTarget.active) return;

    this.eventCooldowns['CREATURE_DASHING'] = 0;

    const report = {
      hasMoment: true,
      priority: 40,
      type: 'CREATURE_DASHING',
      subject: creature,
      secondarySubject: creature.foodTarget,
      suggestedShot: 'SIDE_TRACK', // Chase cam following the dashing creature
      suggestedDuration: 0.5, // dashes are brief (config.dash.duration ~0.4s)
      position: creature.mesh.position.clone(),
      startTime: Date.now(),
    };

    this.scoutCandidates.push(report);
  }

  /**
   * Detect when a dolphin surfaces to breathe
   *
   * **Why this is cinematic:** A dolphin breaking the surface, taking a breath,
   * its blowhole visible against the sky — this is a rare, beautiful moment.
   * It shows the mammalian nature of dolphins, their dependence on air.
   * "Snell's window" shots (looking up from underwater at the surface) are
   * iconic in nature documentaries.
   *
   * Priority: 60 (high — breathtaking moment, and rare if oxygen system works well)
   */
  _detectDolphinSurfacing(creature) {
    if (creature.type !== 'dolphin') return;
    if (!creature._needsAir) return;

    // Must be near surface (within 3 units of surfaceY)
    const yPos = creature.body.position.y;
    const surfaceY = this.config.surfaceY;
    if (yPos < surfaceY - 3) return; // Still too deep

    // Check cooldown
    if (this.eventCooldowns['DOLPHIN_SURFACING'] < this.defaultCooldowns['DOLPHIN_SURFACING']) {
      return;
    }

    this.eventCooldowns['DOLPHIN_SURFACING'] = 0;

    const report = {
      hasMoment: true,
      priority: 60,
      type: 'DOLPHIN_SURFACING',
      subject: creature,
      secondarySubject: null,
      suggestedShot: 'SNELLS_WINDOW', // Underwater view looking up at surface
      suggestedDuration: 2, // Breathing moment lasts ~2 seconds
      position: creature.mesh.position.clone(),
      startTime: Date.now(),
    };

    this.scoutCandidates.push(report);
  }

  /**
   * Detect when a school of fish forms (5+ fish within close proximity)
   *
   * **Why this is cinematic:** A school is a stunning visual moment — the
   * synchronized movement, the fluid coordination, the sense of safety in numbers.
   * Documentaries cut to schools to show ecosystem health and community.
   *
   * Priority: 30 (moderate — beautiful but less urgent than hunts)
   *
   * **Note:** This runs every 60 frames (cached) because full distance checks are expensive
   */
  _detectSchools() {
    // Find all fish positions
    const fish = [];
    for (const { pool, type } of this.creaturePools) {
      if (type === 'fish') {
        pool.forEachActive(creature => {
          if (creature.active && !creature.dead) {
            fish.push(creature);
          }
        });
      }
    }

    if (fish.length < 5) return; // Need at least 5 for a school

    // Clustering: find fish within radius 5 of each other
    const schoolRadius = 5.0;
    const schools = [];
    const visited = new Set();

    for (let i = 0; i < fish.length; i++) {
      if (visited.has(i)) continue;

      const schoolMembers = [fish[i]];
      visited.add(i);

      // Find all fish within radius of this member
      for (let j = i + 1; j < fish.length; j++) {
        if (visited.has(j)) continue;

        const dist = fish[i].mesh.position.distanceTo(fish[j].mesh.position);
        if (dist < schoolRadius) {
          schoolMembers.push(fish[j]);
          visited.add(j);
        }
      }

      // School must have at least 5 members
      if (schoolMembers.length >= 5) {
        // Calculate school center
        const center = this._schoolCacheVec.set(0, 0, 0);
        for (const member of schoolMembers) {
          center.add(member.mesh.position);
        }
        center.divideScalar(schoolMembers.length);

        schools.push({
          members: schoolMembers,
          center: center.clone(),
          size: schoolMembers.length,
        });
      }
    }

    // Report largest school
    if (schools.length > 0) {
      schools.sort((a, b) => b.size - a.size);
      const largestSchool = schools[0];

      // Check cooldown
      if (this.eventCooldowns['SCHOOL_FORMING'] < this.defaultCooldowns['SCHOOL_FORMING']) {
        return;
      }

      this.eventCooldowns['SCHOOL_FORMING'] = 0;

      const report = {
        hasMoment: true,
        priority: 30,
        type: 'SCHOOL_FORMING',
        subject: largestSchool.members[0], // Primary fish in school
        secondarySubject: null,
        suggestedShot: 'ESTABLISHING_WIDE', // Wide establishing shot of the school
        suggestedDuration: 6, // Schools stay together for variable time
        position: largestSchool.center.clone(),
        startTime: Date.now(),
      };

      this.scoutCandidates.push(report);
    }

    this.lastDetectedSchools = schools;
  }

  /**
   * Detect birth event (offspring count increased)
   *
   * **Why this is cinematic:** Birth is a momentous event in nature. A creature
   * reproducing is the continuation of life, the cycle of the ecosystem. This
   * is rare and should be captured when it happens — new life emerging.
   *
   * Priority: 85 (very high — birth is a peak moment in any nature doc)
   */
  _detectBirthEvent(creature) {
    if (!creature.active) return;

    const lastCount = this._lastOffspringCounts.get(creature) || 0;
    const currentCount = creature.offspringCount || 0;

    // Check if offspring count increased
    if (currentCount > lastCount) {
      this._lastOffspringCounts.set(creature, currentCount);

      // Check cooldown (per creature, not global)
      const cooldownKey = `BIRTH_EVENT_${creature.id || creature.mesh.uuid}`;
      if (!this.eventCooldowns[cooldownKey]) {
        this.eventCooldowns[cooldownKey] = 0;
      }

      if (this.eventCooldowns[cooldownKey] < this.defaultCooldowns['BIRTH_EVENT']) {
        return;
      }

      this.eventCooldowns[cooldownKey] = 0;

      const report = {
        hasMoment: true,
        priority: 85,
        type: 'BIRTH_EVENT',
        subject: creature, // The parent
        secondarySubject: null,
        suggestedShot: 'MACRO_DETAIL', // Tight shot on parent and new offspring
        suggestedDuration: 5,
        position: creature.mesh.position.clone(),
        startTime: Date.now(),
      };

      this.scoutCandidates.push(report);
    }

    // Update tracking
    this._lastOffspringCounts.set(creature, currentCount);
  }

  /**
   * Detect death event (creature transitions to dead state)
   *
   * **Why this is cinematic:** Death closes the story of a creature's life.
   * Holding on the corpse briefly shows the consequence of struggle and the
   * natural cycle of predation. It's somber but essential to the story.
   *
   * Priority: 50 (moderate — important for closure, but sadder)
   */
  _detectDeathEvent(creature) {
    if (!creature.active || !creature.dead) return;

    // Use a "death tracker" to detect transition to dead (not just "is dead")
    const deathTrackerKey = `death_${creature.id || creature.mesh.uuid}`;
    if (!this.eventCooldowns[deathTrackerKey]) {
      this.eventCooldowns[deathTrackerKey] = -Infinity;
    }

    // If we haven't reported this death yet (first time we see creature.dead = true)
    if (this.eventCooldowns[deathTrackerKey] < 0) {
      this.eventCooldowns[deathTrackerKey] = 0;

      const report = {
        hasMoment: true,
        priority: 50,
        type: 'DEATH_EVENT',
        subject: creature,
        secondarySubject: null,
        suggestedShot: 'HERO_PORTRAIT', // Intimate shot of the deceased
        suggestedDuration: 2,
        position: creature.mesh.position.clone(),
        startTime: Date.now(),
      };

      this.scoutCandidates.push(report);
    }
  }

  /**
   * Detect interesting feeding moments
   *
   * **Why this is cinematic:** Feeding is survival. When a creature closes in on
   * food (within 2 units), it's a moment of focus and intensity. Close-up macro
   * shot shows the creature's determination and the success of the hunt.
   *
   * Priority: 35 (moderate — interesting but less dramatic than predator chases)
   */
  _detectFeeding(creature) {
    if (!creature.foodTarget) return;

    const foodPos = this._getFoodPosition(creature.foodTarget);
    const dist = creature.mesh.position.distanceTo(foodPos);

    if (dist < 2.0) {
      // Check cooldown
      if (this.eventCooldowns['FEEDING'] < this.defaultCooldowns['FEEDING']) {
        return;
      }

      this.eventCooldowns['FEEDING'] = 0;

      const report = {
        hasMoment: true,
        priority: 35,
        type: 'FEEDING',
        subject: creature,
        secondarySubject: creature.foodTarget,
        suggestedShot: 'MACRO_DETAIL', // Tight shot on feeding behavior
        suggestedDuration: 1,
        position: creature.mesh.position.clone(),
        startTime: Date.now(),
      };

      this.scoutCandidates.push(report);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PRIVATE: Helper Methods
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Get the world position of a food target (handles plants, food particles, creatures)
   */
  _getFoodPosition(foodTarget) {
    if (foodTarget.mesh) {
      return foodTarget.mesh.position;
    } else if (foodTarget.position) {
      return foodTarget.position;
    }
    return this._tempVec3.set(0, 0, 0); // Fallback
  }

  /**
   * Check if a moment should still be reported (hasn't naturally ended)
   */
  _isMomentActive(report) {
    if (!report.subject) return false;

    const subject = report.subject;

    // Creature must be alive and active
    if (!subject.active || subject.dead) {
      if (report.type !== 'DEATH_EVENT') {
        return false;
      }
    }

    switch (report.type) {
      case 'PREDATOR_CHASE':
        // Chase ends if dolphin stops sprinting or loses food target
        return subject._sprinting && subject.foodTarget;

      case 'PREY_FLEEING':
        // Fleeing ends if fish stops fleeing
        return subject.isFleeing;

      case 'CREATURE_DASHING':
        // Dash ends when creature stops dashing
        return subject._isDashing;

      case 'DOLPHIN_SURFACING':
        // Surfacing ends when dolphin moves back underwater
        return subject._needsAir && subject.body.position.y > this.config.surfaceY - 3;

      case 'SCHOOL_FORMING':
        // Schools are transient; report it but don't require active re-check
        return true;

      case 'BIRTH_EVENT':
        // Birth is a one-time event; let it play out
        return true;

      case 'DEATH_EVENT':
        // Hold on corpse briefly
        return true;

      case 'FEEDING':
        // Feeding ends when creature moves away from food
        if (!report.secondarySubject) return false;
        const foodPos = this._getFoodPosition(report.secondarySubject);
        return subject.mesh.position.distanceTo(foodPos) < 2.5; // Slightly relaxed distance check

      default:
        return true;
    }
  }
}
