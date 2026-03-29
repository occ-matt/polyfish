/**
 * SimulationSystem - Core simulation loop extracted from main.js.
 *
 * Contains: simulationStep(), updateLODAssignments(), updateStagedSpawns(),
 * creature callbacks, and all pre-allocated iteration helpers.
 *
 * Reads mutable state from GameState; receives spawn functions via init().
 */
import { CONFIG } from '../config.js';
import sceneManager from '../rendering/SceneManager.js';
import { syncCreatureInstances } from '../rendering/InstancedCreatures.js';
import { syncPlantInstances } from '../rendering/InstancedPlants.js';
import { DesktopHints } from '../input/DesktopHints.js';
import GS from '../core/GameState.js';

// ── Spawn function references (wired by init()) ─────────────────
let _spawnCreature = null;
let _spawnFood = null;
let _spawnSeed = null;
let _spawnPlant = null;

/**
 * Wire spawn functions from main.js so the simulation can create entities.
 */
export function initSimulation({ spawnCreature, spawnFood, spawnSeed, spawnPlant }) {
  _spawnCreature = spawnCreature;
  _spawnFood = spawnFood;
  _spawnSeed = spawnSeed;
  _spawnPlant = spawnPlant;
}

// Single closure for plant food production
const _plantProduceFood = (pos, force, ageFraction) => _spawnFood(pos, force, ageFraction);

// ── Creature Callbacks ──────────────────────────────────────────
export const creatureCallbacks = {
  onFoodConsumed: (food, eater) => {
    // Held food (VR): mesh.position is in local grip space, use body.position
    const pos = food.held ? food.body.position : food.mesh.position;
    GS.vfxManager?.emitFoodEaten(pos, eater?.mesh);
    GS.audioManager.playSpatialSFXVariant('feed', pos);
    food.deactivate();
  },
  onCreatureEaten: (creature) => {
    GS.vfxManager?.emitCreatureEaten(creature.mesh.position);
    GS.audioManager.playSpatialSFXVariant('impact', creature.mesh.position);
    creature.deactivate();
  },
  onPlantEaten: (plant) => {
    GS.vfxManager?.emitPlantEaten(plant.getMidpoint());
    GS.audioManager.playSpatialSFXVariant('feed', plant.getMidpoint());
    plant.takeDamage();
  },
  onReproduce: (type, position, parentSpeed) => {
    GS.vfxManager?.emitBirth(position);
    GS.audioManager.playSpatialSFXVariant('birth', position);
    _spawnCreature(type, position, parentSpeed);
  },
  onProduceWaste: (position) => {
    GS.audioManager.playSpatialSFXVariant('poo', position);
    _spawnSeed(position);
  },
  onCorpseConsumed: (corpse) => {
    GS.vfxManager?.emitCreatureEaten(corpse.mesh.position);
  },
  onDeath: (creature) => {
    GS.vfxManager?.emitDeath(creature.mesh.position);
    GS.audioManager.playSpatialSFXVariant('impact', creature.mesh.position);
  },
  onDecompose: (position) => {
    GS.vfxManager?.emitDecompose(position);
    const germCfg = CONFIG.seedGermination;
    let chance = germCfg.baseChance;
    const r2 = germCfg.densityRadius * germCfg.densityRadius;
    let nearby = 0;
    const plants = GS.plantPool.active;
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      const dx = p.mesh.position.x - position.x;
      const dz = p.mesh.position.z - position.z;
      if (dx * dx + dz * dz < r2) nearby++;
    }
    chance = Math.max(germCfg.minChance, chance - nearby * germCfg.densityPenalty);
    if (Math.random() < chance) {
      _spawnPlant(position);
    }
  },
};

// ── LOD Assignment Pass ─────────────────────────────────────────
export function updateLODAssignments() {
  const camera = sceneManager.getCamera();
  camera.getWorldPosition(GS._lodCameraPos);

  for (const { pool } of GS.allCreaturePools) {
    pool.forEachActive(creature => {
      if (!creature.dead) {
        const dxSq = (creature.mesh.position.x - GS._lodCameraPos.x) ** 2;
        const dySq = (creature.mesh.position.y - GS._lodCameraPos.y) ** 2;
        const dzSq = (creature.mesh.position.z - GS._lodCameraPos.z) ** 2;
        const distSq = dxSq + dySq + dzSq;

        if (distSq < GS._lodDistSq15) creature.setLOD(0);
        else if (distSq < GS._lodDistSq30) creature.setLOD(1);
        else creature.setLOD(2);
      }
    });
  }

  GS.plantPool.forEachActive(plant => {
    if (plant.active) {
      const dxSq = (plant.mesh.position.x - GS._lodCameraPos.x) ** 2;
      const dySq = (plant.mesh.position.y - GS._lodCameraPos.y) ** 2;
      const dzSq = (plant.mesh.position.z - GS._lodCameraPos.z) ** 2;
      const distSq = dxSq + dySq + dzSq;

      if (distSq < GS._lodDistSq15) plant.setLOD(0);
      else if (distSq < GS._lodDistSq30) plant.setLOD(1);
      else plant.setLOD(2);

      const shouldCastShadow = plant.lod < 2;
      plant.mesh.castShadow = shouldCastShadow;
      plant.mesh.traverse(child => {
        if (child.isMesh) child.castShadow = shouldCastShadow;
      });
    }
  });
}

// ── Staged Spawn Timer ──────────────────────────────────────────
export function updateStagedSpawns(dt) {
  if (!GS.stageRunning) return;
  GS.stageTimer += dt;

  for (const event of GS.stageEvents) {
    if (!event.fired && GS.stageTimer >= event.time) {
      event.fired = true;
      // Staged spawn: type at T+time
      _spawnCreature(event.type, event.pos.clone());
      if (event.type === 'fish' && GS.desktopHints) {
        setTimeout(() => GS.desktopHints.showFeedPrompt(), 2000);
      }
    }
  }
}

// ── Simulation Sub-step ─────────────────────────────────────────
export function simulationStep(dt, elapsed) {
  // Sync player kinematic capsule to camera position
  if (GS.playerBodySlot >= 0) {
    const cam = sceneManager.getCamera().position;
    GS.physicsProxy.setPosition(GS.playerBodySlot, cam.x, cam.y - 0.9, cam.z, 0);
  }

  // Push food velocity/position to Jolt BEFORE the step.
  // Physics LOD: only push Jolt commands for food near the camera (< 20 m).
  // Distant food uses simple PhysicsBody integration — no visible difference
  // but saves 2 SAB commands per food per frame.  Fish eating is spatial-hash
  // based and unaffected.
  const _cam = sceneManager.getCamera().position;
  const _foodPhysLodDistSq = 20 * 20;
  for (const food of GS.foodPool.active) {
    if (food.active && !food.held) {
      const dx = food.body.position.x - _cam.x;
      const dy = food.body.position.y - _cam.y;
      const dz = food.body.position.z - _cam.z;
      food._useJolt = (dx * dx + dy * dy + dz * dz) < _foodPhysLodDistSq;
    } else {
      food._useJolt = true; // held food always uses Jolt
    }
    food.preStep(dt);
  }

  // Step physics simulation
  if (!GS.endSequenceActive) {
    GS.physicsProxy.step(dt);
    GS.physicsProxy.waitForStep();
  }

  const isNarrative = !GS.titleScreen?.active && !GS.endSequenceActive &&
    GS.modeManager.currentMode?.name === 'narrative';

  if (!isNarrative) return;

  // ── LOD PASS ──
  GS._lodUpdateTimer += dt;
  if (GS._lodUpdateTimer >= GS._lodUpdateInterval) {
    GS._lodUpdateTimer -= GS._lodUpdateInterval;
    updateLODAssignments();
  }

  // ── Build creature lists ──
  GS._activeFish.length = 0;
  GS._activeDolphins.length = 0;
  GS._activeManatees.length = 0;
  GS._allFish.length = 0;
  GS._allDolphins.length = 0;
  GS._allManatees.length = 0;
  GS._corpseList.length = 0;

  GS.fishPool.forEachActive(c => {
    GS._allFish.push(c);
    if (!c.dead) { GS._activeFish.push(c); }
    else { c.updateDead(dt, creatureCallbacks); GS._corpseList.push(c); }
  });
  GS.dolphinPool.forEachActive(c => {
    GS._allDolphins.push(c);
    if (!c.dead) { GS._activeDolphins.push(c); }
    else { c.updateDead(dt, creatureCallbacks); }
  });
  GS.manateePool.forEachActive(c => {
    GS._allManatees.push(c);
    if (!c.dead) { GS._activeManatees.push(c); }
    else { c.updateDead(dt, creatureCallbacks); }
  });

  GS._targets.creatures.fish = GS._activeFish;
  GS._targets.creatures.dolphin = GS._activeDolphins;
  GS._targets.creatures.manatee = GS._activeManatees;
  GS._targets.corpseList = GS._corpseList;

  // ── Spatial hash rebuild + batch flee ──
  GS._hashAccumulator += dt;
  if (GS._hashAccumulator >= GS._hashTickRate) {
    GS._hashAccumulator -= GS._hashTickRate;

    GS.creatureHash.clear();
    for (let i = 0; i < GS._activeFish.length; i++) {
      const c = GS._activeFish[i];
      GS.creatureHash.insert(c, c.mesh.position.x, c.mesh.position.z);
    }
    for (let i = 0; i < GS._activeDolphins.length; i++) {
      const c = GS._activeDolphins[i];
      GS.creatureHash.insert(c, c.mesh.position.x, c.mesh.position.z);
    }
    for (let i = 0; i < GS._activeManatees.length; i++) {
      const c = GS._activeManatees[i];
      GS.creatureHash.insert(c, c.mesh.position.x, c.mesh.position.z);
    }
    GS._targets.creatureHash = GS.creatureHash;

    // Batch flee: mark nearby fish as fleeing from dolphins
    for (let i = 0; i < GS._activeFish.length; i++) {
      GS._activeFish[i].fleeTarget = null;
      GS._activeFish[i].isFleeing = false;
    }
    for (let i = 0; i < GS._activeDolphins.length; i++) {
      const dolphin = GS._activeDolphins[i];
      const dp = dolphin.body.position;
      GS.creatureHash.query(dp.x, dp.z, 3.0, GS._hashResults);
      for (let j = 0; j < GS._hashResults.length; j++) {
        const prey = GS._hashResults[j];
        if (prey.type !== 'fish' || prey.dead) continue;
        if (!prey.isFleeing) {
          prey.fleeTarget = dolphin;
          prey.isFleeing = true;
        } else {
          const existDist = prey.body.position.distanceToSquared(prey.fleeTarget.body.position);
          const newDist = prey.body.position.distanceToSquared(dp);
          if (newDist < existDist) prey.fleeTarget = dolphin;
        }
      }
    }
  }

  // ── Per-species AI ticks ──
  const _runSpeciesAI = (state, creatures) => {
    const subTick = state.tickRate / GS.AI_STAGGER_GROUPS;
    state.accumulator += dt;
    while (state.accumulator >= subTick) {
      state.accumulator -= subTick;
      const g = state.staggerIdx;
      for (let i = g; i < creatures.length; i += GS.AI_STAGGER_GROUPS) {
        creatures[i].updateAI(state.tickRate, GS._targets, creatureCallbacks);
      }
      state.staggerIdx = (state.staggerIdx + 1) % GS.AI_STAGGER_GROUPS;
    }
  };

  _runSpeciesAI(GS._aiState.dolphin, GS._activeDolphins);
  _runSpeciesAI(GS._aiState.fish, GS._activeFish);
  _runSpeciesAI(GS._aiState.manatee, GS._activeManatees);

  // ── Per-frame motion ──
  for (let i = 0; i < GS._activeFish.length; i++) GS._activeFish[i].updateMotion(dt, elapsed);
  for (let i = 0; i < GS._activeDolphins.length; i++) GS._activeDolphins[i].updateMotion(dt, elapsed);
  for (let i = 0; i < GS._activeManatees.length; i++) GS._activeManatees[i].updateMotion(dt, elapsed);

  // ── Sync creature instanced meshes ──
  if (GS.fishInstanced) syncCreatureInstances(GS.fishInstanced, GS._allFish);
  if (GS.dolphinInstanced) syncCreatureInstances(GS.dolphinInstanced, GS._allDolphins);
  if (GS.manateeInstanced) syncCreatureInstances(GS.manateeInstanced, GS._allManatees);

  // ── Food pass: update + rebuild food hash + sync instanced mesh ──
  GS.foodHash.clear();
  let foodIdx = 0;
  GS.foodPool.forEachActive(GS._noop);
  GS.foodPool.forEachActive(food => {
    if (food.active) {
      food.update(dt);
      if (!food.active) return;
      // Held food (VR): use body.position for the spatial hash (fish
      // need world-space coords to find and eat from the hand). The mesh
      // position is also world-space now (lerp-based, not grip-parented),
      // so it flows through to the instanced mesh update below.
      if (food.held) {
        GS.foodHash.insert(food, food.body.position.x, food.body.position.z);
      } else {
        GS.foodHash.insert(food, food.mesh.position.x, food.mesh.position.z);
      }
      if (foodIdx < GS.foodInstancedMesh.instanceMatrix.count) {
        GS._instanceEuler.copy(food.mesh.rotation);
        GS._instanceQuat.setFromEuler(GS._instanceEuler);
        const s = food.mesh.scale.x;
        GS._instanceScale.set(s, s, s);
        GS._instanceMatrix.compose(food.mesh.position, GS._instanceQuat, GS._instanceScale);
        GS.foodInstancedMesh.setMatrixAt(foodIdx, GS._instanceMatrix);
        foodIdx++;
      }
    }
  });
  GS._targets.food = GS.foodPool.active;
  GS._targets.foodHash = GS.foodHash;
  GS.foodInstancedMesh.count = foodIdx;
  if (foodIdx > 0) GS.foodInstancedMesh.instanceMatrix.needsUpdate = true;

  // ── Seed pass: update + sync instanced mesh ──
  let seedIdx = 0;
  GS.seedPool.forEachActive(seed => {
    if (seed.active) {
      seed.update(dt, {
        onLand: (pos) => GS.audioManager.playSpatialSFXVariant('impact', pos),
        onSpawnPlant: (pos, seed) => _spawnPlant(pos, seed),
        getNearbyPlantCount: (pos, radius) => {
          let count = 0;
          const r2 = radius * radius;
          const plants = GS.plantPool.active;
          for (let i = 0; i < plants.length; i++) {
            const p = plants[i];
            if (p.active && pos.distanceToSquared(p.mesh.position) < r2) count++;
          }
          return count;
        },
      });
      if (!seed.active) return;
      if (seedIdx < GS.seedInstancedMesh.instanceMatrix.count) {
        GS._instanceEuler.copy(seed.mesh.rotation);
        GS._instanceQuat.setFromEuler(GS._instanceEuler);
        const s = seed.mesh.scale.x;
        GS._instanceScale.set(s, s, s);
        GS._instanceMatrix.compose(seed.mesh.position, GS._instanceQuat, GS._instanceScale);
        GS.seedInstancedMesh.setMatrixAt(seedIdx, GS._instanceMatrix);
        seedIdx++;
      }
    }
  });
  GS.seedInstancedMesh.count = seedIdx;
  if (seedIdx > 0) GS.seedInstancedMesh.instanceMatrix.needsUpdate = true;

  // ── Plant pass: update + verlet collisions + surfaceY ──
  GS.plantPool.forEachActive(GS._noop);
  GS.plantPool.forEachActive(plant => {
    if (plant.active) {
      plant._onProduceFood = _plantProduceFood;
      plant.update(dt, elapsed);

      const skipCollision = plant.lod === 2 ||
        (plant.lod === 1 && ((plant._collisionFrame = (plant._collisionFrame || 0) + 1) & 1));
      if (!skipCollision && plant._verletReady && plant._stalkHeight > 0) {
        const px = plant.mesh.position.x;
        const pz = plant.mesh.position.z;
        GS.creatureHash.query(px, pz, plant.collisionRadius + 3, GS._hashResults);
        for (let i = 0; i < GS._hashResults.length; i++) {
          const creature = GS._hashResults[i];
          const cfg = CONFIG.creatures[creature.type];
          const creatureSize = cfg.capsuleRadius * cfg.scale * 0.5;
          const dx = creature.mesh.position.x - px;
          const dz = creature.mesh.position.z - pz;
          const horizDist = Math.sqrt(dx * dx + dz * dz);
          if (horizDist < plant.collisionRadius + creatureSize) {
            plant.dragFrom(creature.mesh.position, creatureSize, creature.body.velocity);
          }
        }

        // Player-plant collision
        const cam = sceneManager.getCamera().position;
        const playerRadius = 0.5;
        const pdx = cam.x - px;
        const pdz = cam.z - pz;
        const playerHorizDist = Math.sqrt(pdx * pdx + pdz * pdz);
        if (playerHorizDist < plant.collisionRadius + playerRadius) {
          const playerVel = (GS.xrManager && GS.xrManager.active) ? GS.xrManager.velocity : GS.cameraController.velocity;
          const offsets = [-1.6, -0.8, 0];
          for (let s = 0; s < 3; s++) {
            GS._playerSamplePos.set(cam.x, cam.y + offsets[s], cam.z);
            plant.dragFrom(GS._playerSamplePos, playerRadius, playerVel);
          }
        }
      }
    }
  });
  GS._targets.plants = GS.plantPool.active;

  // ── Sync instanced plant rendering ──
  if (GS.plantInstanced) {
    GS._activePlantList.length = 0;
    GS.plantPool.forEachActive(p => { if (p.active) GS._activePlantList.push(p); });
    syncPlantInstances(GS.plantInstanced, GS._activePlantList);
  }

  // Staged creature spawns
  updateStagedSpawns(dt);

  // Spawner system (food)
  GS.spawnerSystem.update(dt, {
    onSpawnFood: (pos, force) => _spawnFood(pos, force),
    onSpawnSeed: (pos) => _spawnSeed(pos),
  });

  // Narration
  GS.narrationSystem.update(dt);

  // Population monitor
  let fishAliveCount = 0;
  const fishActive = GS.fishPool.active;
  for (let i = 0; i < fishActive.length; i++) {
    if (!fishActive[i].dead) fishAliveCount++;
  }
  GS.populationMonitor.update(dt, fishAliveCount, {
    onRestart: async () => {
      console.log('[PolyFish] Fish population reached 0 - ending simulation.');
      GS.endSequenceActive = true;
      GS.stageRunning = false;
      GS.audioManager.playSFXVariant('gameOver');

      const popCounter = document.getElementById('population-counter');
      if (popCounter) popCounter.classList.add('hud-hidden');

      // ── VR branch: world-space end sequence (tint + 3D panels) ──
      if (GS.xrManager && GS.xrManager.active && GS.vrEndScreen) {
        // Hide VR HUD
        if (GS.xrManager.hud) GS.xrManager.hud.setVisible(false);

        // Stop player movement almost immediately (controls feel unresponsive
        // during the end sequence, so cut them fast rather than a long fade)
        GS.xrManager.fadeOutMovement(0.3);

        GS.audioManager.fadeMusic(0, 3);
        GS.audioManager.stopAmbience();

        // Start VR end screen (drives itself via update() each frame)
        GS.vrEndScreen.start();

        // Play credits music after death message phase (~11 seconds in)
        await new Promise(r => setTimeout(r, 11000));
        GS.audioManager.playCreditsTrack();
        return; // VR end screen handles the rest via per-frame update()
        // (fade-out phase will reload the page when complete)
      }

      // ── Desktop/mobile branch: DOM overlays ──
      const deathMsg = document.getElementById('death-message');
      GS.audioManager.fadeMusic(0, 2);
      GS.audioManager.stopAmbience();
      const { default: fadeOverlay } = await import('../rendering/FadeOverlay.js');
      await fadeOverlay.fadeOut(2000);
      GS.audioManager.stopAll();

      if (deathMsg) deathMsg.style.opacity = '1';
      await new Promise(r => setTimeout(r, 4000));
      if (deathMsg) deathMsg.style.opacity = '0';
      await new Promise(r => setTimeout(r, 500));

      // Credits roll
      document.body.classList.add('credits-active');
      GS.audioManager.playCreditsTrack();

      const creditsOverlay = document.getElementById('credits-overlay');
      const creditsScroll = document.getElementById('credits-scroll');
      if (creditsOverlay && creditsScroll) {
        const scrollHeight = creditsScroll.offsetHeight;
        const viewportH = window.innerHeight;
        creditsScroll.style.transform = 'translateX(-50%) translateY(0)';
        creditsOverlay.style.opacity = '1';
        await new Promise(r => setTimeout(r, 100));

        const totalTravel = scrollHeight + viewportH;
        const scrollDuration = Math.max(8, totalTravel * 12 / 1000);
        const scrollDurationMs = scrollDuration * 1000;

        await new Promise(resolve => {
          const startTime = performance.now();
          function tick(now) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / scrollDurationMs, 1);
            const y = -t * totalTravel;
            creditsScroll.style.transform = `translateX(-50%) translateY(${y}px)`;
            if (t < 1) requestAnimationFrame(tick);
            else resolve();
          }
          requestAnimationFrame(tick);
        });

        await new Promise(r => setTimeout(r, 1500));
        GS.audioManager.fadeMusic(0, 1.5);
        creditsOverlay.style.opacity = '0';
        await new Promise(r => setTimeout(r, 1500));
        GS.audioManager.stopMusic();
      }

      location.reload();
    },
  });
}
