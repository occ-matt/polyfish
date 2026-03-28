/**
 * GameState - Centralized mutable game state.
 *
 * A single plain object holding all runtime state that was previously
 * scattered as module-level variables in main.js.
 *
 * Usage:
 *   import GS from './core/GameState.js';
 *   GS.fishPool = new ObjectPool(...);   // assign during init
 *   GS.fishPool.get();                   // read from any module
 */
import * as THREE from 'three';
import { SpatialHash } from './SpatialHash.js';

const GameState = {
  // ── Core systems (assigned during init) ────────────────────────
  clock: null,
  cameraController: null,
  feedingInput: null,
  xrManager: null,
  desktopHints: null,
  audioManager: null,
  narrationSystem: null,
  spawnerSystem: null,
  populationMonitor: null,
  modeManager: null,
  physicsProxy: null,
  cinematicDOF: null,
  godRayRenderer: null,
  vfxManager: null,
  hudSystem: null,
  playerBodySlot: -1,

  // ── Entity pools (assigned during initPools) ───────────────────
  fishPool: null,
  dolphinPool: null,
  manateePool: null,
  foodPool: null,
  seedPool: null,
  plantPool: null,

  // ── Instanced meshes ───────────────────────────────────────────
  foodInstancedMesh: null,
  seedInstancedMesh: null,
  fishInstanced: null,
  dolphinInstanced: null,
  manateeInstanced: null,
  plantInstanced: null,

  // ── Gameplay state ─────────────────────────────────────────────
  heldFood: null,
  debugMode: false,
  debugForceHUD: null,
  endSequenceActive: false,
  timeScale: 1,
  stageTimer: 0,
  stageRunning: false,
  modeContext: null,
  oceanSurfaceMesh: null,

  // ── Aggregate lists (pre-allocated for fast iteration) ─────────
  allCreatures: [],
  allCreaturePools: [],

  // ── Spatial hashes ─────────────────────────────────────────────
  creatureHash: new SpatialHash(5),
  foodHash: new SpatialHash(5),
  _hashResults: [],

  // ── LOD state ──────────────────────────────────────────────────
  _lodUpdateTimer: 0,
  _lodUpdateInterval: 0.25,
  _lodCameraPos: new THREE.Vector3(),
  _playerSamplePos: new THREE.Vector3(),
  _lodDistSq15: 15 * 15,
  _lodDistSq30: 30 * 30,

  // ── AI tick system ─────────────────────────────────────────────
  AI_STAGGER_GROUPS: 3,
  _aiState: {
    fish:    { tickRate: 0.060, accumulator: 0.060, staggerIdx: 0 },
    dolphin: { tickRate: 0.060, accumulator: 0.060, staggerIdx: 0 },
    manatee: { tickRate: 0.100, accumulator: 0.100, staggerIdx: 0 },
  },
  _hashAccumulator: 0.033,
  _hashTickRate: 0.033,

  // ── Instanced rendering scratch ────────────────────────────────
  _instanceMatrix: new THREE.Matrix4(),
  _instanceQuat: new THREE.Quaternion(),
  _instanceEuler: new THREE.Euler(),
  _instanceScale: new THREE.Vector3(),

  // ── Staged spawn events ────────────────────────────────────────
  stageEvents: [
    { time: 1,   type: 'fish',    pos: new THREE.Vector3(0, -6.8, 15), fired: false },
    { time: 40,  type: 'manatee', pos: new THREE.Vector3(-5, -6.5, 12), fired: false },
    { time: 100, type: 'dolphin', pos: new THREE.Vector3(-22.0, -6.5, 20.4), fired: false },
  ],

  // ── Pre-allocated iteration helpers ────────────────────────────
  _activeFish: [],
  _activeDolphins: [],
  _activeManatees: [],
  _allFish: [],
  _allDolphins: [],
  _allManatees: [],
  _activePlantList: [],
  _corpseList: [],
  _targets: {
    food: null,
    foodHash: null,
    creatures: { fish: null, dolphin: null, manatee: null },
    creatureHash: null,
    plants: null,
    corpseList: null,
  },
  _noop: () => {},

  // ── Time scales ────────────────────────────────────────────────
  TIME_SCALES: [1, 3, 5, 10],
};

export default GameState;
