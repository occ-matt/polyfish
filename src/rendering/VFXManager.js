/**
 * VFXManager — Batched particle effects for PolyFish lifecycle events.
 *
 * Custom engine (no external deps) that renders ALL particles in a single
 * THREE.Points draw call. Each effect type has its own config (color curves,
 * size curves, forces, burst count) but shares one geometry + material.
 *
 * Features:
 *   - Single draw call for all active particles
 *   - Color-over-lifetime curves (start → end lerp)
 *   - Size-over-lifetime curves (bezier 4-point)
 *   - Per-particle forces (buoyancy, gravity)
 *   - Per-particle rotation (tumbling debris)
 *   - Creature collision (feeding particles bounce off fish)
 *   - Spherical emission with configurable radius
 *   - VR mode (reduced particle counts)
 */

import * as THREE from 'three';
import { getSharedTexture } from '../utils/TextureCache.js';
import { randomSphericalDirection } from '../utils/MathUtils.js';

// ── Constants ───────────────────────────────────────────────────────
const MAX_PARTICLES = 1024;

// Collision tuning
const COLLISION_RADIUS = 0.4;     // how close a particle gets before bouncing
const COLLISION_BOUNCE = 0.6;     // velocity retention on bounce (0-1)

// Reusable temp vectors
const _v3 = new THREE.Vector3();

// ── Helpers ─────────────────────────────────────────────────────────
function bezier4(t, p0, p1, p2, p3) {
  const it = 1 - t;
  return it * it * it * p0 +
    3 * it * it * t * p1 +
    3 * it * t * t * p2 +
    t * t * t * p3;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function randRange(min, max) { return min + Math.random() * (max - min); }

// ── Effect Configs ──────────────────────────────────────────────────

const EFFECT_CONFIGS = {
  foodEaten: {
    burstCount: 16,
    lifetime: [0.6, 1.0],
    speed: [1.5, 3.0],
    startSize: [0.06, 0.12],
    sizeCurve: [1, 0.8, 0.4, 0],
    colorStart: [0.5, 1.0, 0.7],
    colorEnd: [0.3, 0.8, 0.5],
    force: [0, -1.2, 0],
    emitRadius: 0,
    drag: 0.95,
    rotSpeed: [-4, 4],        // radians/sec range
    collideCreatures: true,   // bounce off fish
  },
  creatureEaten: {
    burstCount: 25,
    lifetime: [0.8, 1.2],
    speed: [3.0, 5.0],
    startSize: [0.1, 0.2],
    sizeCurve: [1, 0.9, 0.5, 0],
    colorStart: [1.0, 0.5, 0.27],
    colorEnd: [1.0, 0.3, 0.1],
    force: [0, -0.3, 0],
    emitRadius: 0,
    drag: 0.96,
    rotSpeed: [-6, 6],
    collideCreatures: false,
  },
  plantEaten: {
    burstCount: 10,
    lifetime: [0.5, 0.9],
    speed: [1.0, 2.0],
    startSize: [0.05, 0.1],
    sizeCurve: [0.8, 1.2, 0.6, 0],
    colorStart: [0.33, 0.8, 0.47],
    colorEnd: [0.3, 0.7, 0.4],
    force: [0, 0.2, 0],
    emitRadius: 0,
    drag: 0.97,
    rotSpeed: [-3, 3],
    collideCreatures: false,
  },
  birth: {
    burstCount: 20,
    lifetime: [1.2, 1.5],
    speed: [0.5, 1.0],
    startSize: [0.04, 0.08],
    sizeCurve: [1, 0.9, 0.5, 0.2],
    colorStart: [1.0, 1.0, 1.0],
    colorEnd: [0.5, 0.9, 1.0],
    force: [0, 0.1, 0],
    emitRadius: 0.5,
    drag: 0.98,
    rotSpeed: [-2, 2],
    collideCreatures: false,
  },
  death: {
    burstCount: 20,
    lifetime: [1.0, 1.5],
    speed: [1.5, 2.5],
    startSize: [0.08, 0.15],
    sizeCurve: [1, 1.0, 0.8, 0],
    colorStart: [0.6, 0.5, 0.4],
    colorEnd: [0.3, 0.25, 0.2],
    force: [0, -0.8, 0],
    emitRadius: 0,
    drag: 0.95,
    rotSpeed: [-5, 5],
    collideCreatures: false,
  },
  decompose: {
    burstCount: 12,
    lifetime: [1.5, 2.0],
    speed: [0.3, 0.6],
    startSize: [0.04, 0.08],
    sizeCurve: [1, 0.9, 0.4, 0.1],
    colorStart: [0.5, 0.65, 0.4],
    colorEnd: [0.3, 0.5, 0.25],
    force: [0, 0.2, 0],
    emitRadius: 0.3,
    drag: 0.98,
    rotSpeed: [-1.5, 1.5],
    collideCreatures: false,
  },
  foodDrop: {
    burstCount: 10,
    lifetime: [0.3, 0.5],
    speed: [2.0, 3.5],
    startSize: [0.04, 0.08],
    sizeCurve: [1, 0.6, 0.2, 0],
    colorStart: [0.9, 0.95, 1.0],
    colorEnd: [0.6, 0.7, 0.8],
    force: [0, -0.2, 0],
    emitRadius: 0,
    drag: 0.94,
    horizontalBias: 0.85,
    rotSpeed: [-4, 4],
    collideCreatures: false,
  },
};

// ── Particle Pool (SOA) ─────────────────────────────────────────────

class ParticlePool {
  constructor(maxParticles) {
    this.max = maxParticles;
    this.count = 0;

    // Position
    this.px = new Float32Array(maxParticles);
    this.py = new Float32Array(maxParticles);
    this.pz = new Float32Array(maxParticles);
    // Velocity
    this.vx = new Float32Array(maxParticles);
    this.vy = new Float32Array(maxParticles);
    this.vz = new Float32Array(maxParticles);
    // Life
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);
    this.startSize = new Float32Array(maxParticles);
    // Force
    this.fx = new Float32Array(maxParticles);
    this.fy = new Float32Array(maxParticles);
    this.fz = new Float32Array(maxParticles);
    this.drag = new Float32Array(maxParticles);
    // Size curve
    this.sc0 = new Float32Array(maxParticles);
    this.sc1 = new Float32Array(maxParticles);
    this.sc2 = new Float32Array(maxParticles);
    this.sc3 = new Float32Array(maxParticles);
    // Color
    this.csR = new Float32Array(maxParticles);
    this.csG = new Float32Array(maxParticles);
    this.csB = new Float32Array(maxParticles);
    this.ceR = new Float32Array(maxParticles);
    this.ceG = new Float32Array(maxParticles);
    this.ceB = new Float32Array(maxParticles);
    // Rotation
    this.rot = new Float32Array(maxParticles);      // current angle (radians)
    this.rotSpd = new Float32Array(maxParticles);    // angular velocity (rad/s)
    // Collision flag (per-particle — copied from config at spawn)
    this.collide = new Uint8Array(maxParticles);     // 1 = collide with creatures
  }

  spawn(config, position, vrScale = 1) {
    const count = Math.floor(config.burstCount * vrScale);
    let spawned = 0;

    for (let i = 0; i < count; i++) {
      if (this.count >= this.max) break;
      const idx = this.count;

      // Random spherical direction
      const dir = randomSphericalDirection();
      let dx = dir.x;
      let dy = dir.y;
      let dz = dir.z;

      if (config.horizontalBias) dy *= (1 - config.horizontalBias);

      let ox = position.x, oy = position.y, oz = position.z;
      if (config.emitRadius > 0) {
        const r = config.emitRadius * Math.random();
        ox += dx * r; oy += dy * r; oz += dz * r;
      }

      const speed = randRange(config.speed[0], config.speed[1]);
      this.px[idx] = ox; this.py[idx] = oy; this.pz[idx] = oz;
      this.vx[idx] = dx * speed; this.vy[idx] = dy * speed; this.vz[idx] = dz * speed;

      const life = randRange(config.lifetime[0], config.lifetime[1]);
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.startSize[idx] = randRange(config.startSize[0], config.startSize[1]);

      this.fx[idx] = config.force[0];
      this.fy[idx] = config.force[1];
      this.fz[idx] = config.force[2];
      this.drag[idx] = config.drag;

      this.sc0[idx] = config.sizeCurve[0];
      this.sc1[idx] = config.sizeCurve[1];
      this.sc2[idx] = config.sizeCurve[2];
      this.sc3[idx] = config.sizeCurve[3];

      this.csR[idx] = config.colorStart[0];
      this.csG[idx] = config.colorStart[1];
      this.csB[idx] = config.colorStart[2];
      this.ceR[idx] = config.colorEnd[0];
      this.ceG[idx] = config.colorEnd[1];
      this.ceB[idx] = config.colorEnd[2];

      // Rotation
      this.rot[idx] = Math.random() * Math.PI * 2;
      this.rotSpd[idx] = randRange(config.rotSpeed[0], config.rotSpeed[1]);

      // Collision flag
      this.collide[idx] = config.collideCreatures ? 1 : 0;

      this.count++;
      spawned++;
    }
    return spawned;
  }

  /**
   * Step all particles. creaturePositions is an optional flat Float32Array
   * of [x,y,z, x,y,z, ...] for creature collision.
   */
  update(dt, creaturePositions, creatureCount) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i < this.count) this._swap(i, this.count);
        continue;
      }

      // Forces
      this.vx[i] += this.fx[i] * dt;
      this.vy[i] += this.fy[i] * dt;
      this.vz[i] += this.fz[i] * dt;

      // Drag
      const d = this.drag[i];
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;

      // Integrate position
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      // Rotation
      this.rot[i] += this.rotSpd[i] * dt;

      // Creature collision (only for flagged particles)
      if (this.collide[i] && creaturePositions && creatureCount > 0) {
        const px = this.px[i], py = this.py[i], pz = this.pz[i];
        for (let c = 0; c < creatureCount; c++) {
          const c3 = c * 3;
          const cdx = px - creaturePositions[c3];
          const cdy = py - creaturePositions[c3 + 1];
          const cdz = pz - creaturePositions[c3 + 2];
          const distSq = cdx * cdx + cdy * cdy + cdz * cdz;

          if (distSq < COLLISION_RADIUS * COLLISION_RADIUS && distSq > 0.0001) {
            // Bounce: reflect velocity away from creature center
            const dist = Math.sqrt(distSq);
            const nx = cdx / dist, ny = cdy / dist, nz = cdz / dist;
            // Push particle out to collision surface
            this.px[i] = creaturePositions[c3]     + nx * COLLISION_RADIUS;
            this.py[i] = creaturePositions[c3 + 1] + ny * COLLISION_RADIUS;
            this.pz[i] = creaturePositions[c3 + 2] + nz * COLLISION_RADIUS;
            // Reflect velocity component along normal
            const dot = this.vx[i] * nx + this.vy[i] * ny + this.vz[i] * nz;
            if (dot < 0) { // only if moving toward creature
              this.vx[i] -= 2 * dot * nx * COLLISION_BOUNCE;
              this.vy[i] -= 2 * dot * ny * COLLISION_BOUNCE;
              this.vz[i] -= 2 * dot * nz * COLLISION_BOUNCE;
              // Spin up on bounce
              this.rotSpd[i] *= -1.5;
            }
            break; // one collision per frame is enough
          }
        }
      }

      i++;
    }
  }

  _swap(a, b) {
    this.px[a] = this.px[b]; this.py[a] = this.py[b]; this.pz[a] = this.pz[b];
    this.vx[a] = this.vx[b]; this.vy[a] = this.vy[b]; this.vz[a] = this.vz[b];
    this.life[a] = this.life[b]; this.maxLife[a] = this.maxLife[b];
    this.startSize[a] = this.startSize[b];
    this.fx[a] = this.fx[b]; this.fy[a] = this.fy[b]; this.fz[a] = this.fz[b];
    this.drag[a] = this.drag[b];
    this.sc0[a] = this.sc0[b]; this.sc1[a] = this.sc1[b];
    this.sc2[a] = this.sc2[b]; this.sc3[a] = this.sc3[b];
    this.csR[a] = this.csR[b]; this.csG[a] = this.csG[b]; this.csB[a] = this.csB[b];
    this.ceR[a] = this.ceR[b]; this.ceG[a] = this.ceG[b]; this.ceB[a] = this.ceB[b];
    this.rot[a] = this.rot[b]; this.rotSpd[a] = this.rotSpd[b];
    this.collide[a] = this.collide[b];
  }
}

// ── VFXManager ──────────────────────────────────────────────────────

class VFXManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = new ParticlePool(MAX_PARTICLES);
    this.vrMode = false;

    // Creature position cache for collision (rebuilt each frame from main.js)
    this._creaturePositions = new Float32Array(512 * 3); // up to 512 creatures
    this._creatureCount = 0;

    // ── Shared geometry ──
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const alphas = new Float32Array(MAX_PARTICLES);
    const rotations = new Float32Array(MAX_PARTICLES);

    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.rotAttr = new THREE.BufferAttribute(rotations, 1);
    this.rotAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aRotation', this.rotAttr);

    this.geometry.setDrawRange(0, 0);

    // ── Custom shader with rotation ──
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: getSharedTexture('/textures/tri_particle_64.png') },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aRotation;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRotation;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vRotation = aRotation;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTexture;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vRotation;
        void main() {
          // Rotate UV around center of point sprite
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRotation);
          float s = sin(vRotation);
          uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
          vec4 tex = texture2D(uTexture, uv);
          if (tex.a < 0.05) discard;
          gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 500;
    scene.add(this.points);
  }

  // ── Public emit methods ─────────────────────────────────────────

  emitFoodEaten(position, eaterMesh) { this._emit('foodEaten', position); }
  emitCreatureEaten(position) { this._emit('creatureEaten', position); }
  emitPlantEaten(position) { this._emit('plantEaten', position); }
  emitBirth(position) { this._emit('birth', position); }
  emitDeath(position) { this._emit('death', position); }
  emitDecompose(position) { this._emit('decompose', position); }
  emitFoodDrop(position) { this._emit('foodDrop', position); }

  /**
   * Feed creature positions for particle-fish collision.
   * Call once per frame BEFORE update() with the active creature arrays.
   * @param {Array} creatureLists - arrays of creature objects with .mesh.position
   */
  setCreaturePositions(...creatureLists) {
    let idx = 0;
    const maxCreatures = this._creaturePositions.length / 3;

    for (const list of creatureLists) {
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        if (idx >= maxCreatures) break;
        const c = list[i];
        if (c.dead || !c.mesh) continue;
        const p = c.mesh.position;
        const i3 = idx * 3;
        this._creaturePositions[i3] = p.x;
        this._creaturePositions[i3 + 1] = p.y;
        this._creaturePositions[i3 + 2] = p.z;
        idx++;
      }
    }
    this._creatureCount = idx;
  }

  // ── Per-frame update ──────────────────────────────────────────────

  update(dt) {
    // Step physics with creature collision data
    this.pool.update(dt, this._creaturePositions, this._creatureCount);

    const pool = this.pool;
    const count = pool.count;
    const posArr = this.posAttr.array;
    const colArr = this.colorAttr.array;
    const sizeArr = this.sizeAttr.array;
    const alphaArr = this.alphaAttr.array;
    const rotArr = this.rotAttr.array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      posArr[i3] = pool.px[i];
      posArr[i3 + 1] = pool.py[i];
      posArr[i3 + 2] = pool.pz[i];

      const t = 1 - (pool.life[i] / pool.maxLife[i]);

      colArr[i3]     = lerp(pool.csR[i], pool.ceR[i], t);
      colArr[i3 + 1] = lerp(pool.csG[i], pool.ceG[i], t);
      colArr[i3 + 2] = lerp(pool.csB[i], pool.ceB[i], t);

      const sizeScale = bezier4(t, pool.sc0[i], pool.sc1[i], pool.sc2[i], pool.sc3[i]);
      sizeArr[i] = pool.startSize[i] * sizeScale;

      alphaArr[i] = t < 0.7 ? 1.0 : 1.0 - ((t - 0.7) / 0.3);

      rotArr[i] = pool.rot[i];
    }

    this.geometry.setDrawRange(0, count);

    if (count > 0) {
      this.posAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.rotAttr.needsUpdate = true;
    }
  }

  setVRMode(active) { this.vrMode = active; }

  dispose() {
    if (this.points) {
      this.scene.remove(this.points);
      this.geometry.dispose();
      this.material.dispose();
    }
  }

  _emit(effectKey, position) {
    const config = EFFECT_CONFIGS[effectKey];
    if (!config) {
      console.warn(`VFXManager: Unknown effect '${effectKey}'`);
      return;
    }
    const vrScale = this.vrMode ? 0.6 : 1;
    this.pool.spawn(config, position, vrScale);
  }
}

export default VFXManager;
