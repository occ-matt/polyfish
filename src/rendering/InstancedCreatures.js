/**
 * InstancedCreatures — GPU-instanced rendering for creature pools.
 *
 * Replaces ~85 individual draw calls (one per creature mesh) with 3 draw calls
 * (one InstancedMesh per creature type: fish, dolphin, manatee).
 *
 * Architecture:
 *   - Each creature type gets one InstancedMesh with a shared material
 *   - Swim animation uses per-instance attributes (aSwimPhase, aSwimAmplitude)
 *     instead of per-material uniforms
 *   - Config constants (frequency, maskStart, etc.) remain shared uniforms
 *   - Dead creatures render via instancing with swim amplitude 0 (no special tint)
 *   - All creatures have mesh.visible = false (instanced mesh handles rendering)
 *   - Overflow creatures (beyond buffer capacity) are hidden, not rendered
 *
 * Per-frame sync:
 *   1. Creature.update() runs normally (physics, AI, swim phase accumulation)
 *   2. syncCreatureInstances() copies position/rotation/scale into instance matrices
 *      and writes swim phase + amplitude into attribute buffers
 *   3. Three.js renders all creatures of each type in a single draw call
 */
import * as THREE from 'three';
import { SWIM_CONFIGS } from './SwimMaterial.js';
import { applyCaustics } from './CausticShader.js';

// Reusable temp objects (zero-alloc per frame)
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _rootInv = new THREE.Matrix4();

// ── Instanced swim vertex shader chunks ──────────────────────────
// These mirror SwimMaterial.js but read from per-instance attributes
// instead of per-creature uniforms for phase and amplitude.

const INSTANCED_SWIM_PARS = /* glsl */`
  // Per-instance attributes (unique per creature)
  attribute float aSwimPhase;
  attribute float aSwimAmplitude;

  // Shared uniforms (same for all instances of this creature type)
  uniform float uFrequency;
  uniform float uMaskStart;
  uniform float uSwimAxis;
  uniform float uBodyMin;
  uniform float uBodyMax;
  uniform float uMaskFloor;
  uniform float uHeadPhase;
`;

const INSTANCED_SWIM_MAIN = /* glsl */`
  {
    float bodyRange = uBodyMax - uBodyMin;
    float body = bodyRange > 0.001 ? clamp(1.0 - (position.z - uBodyMin) / bodyRange, 0.0, 1.0) : 0.5;

    // Head region: rigid head, no eye sliding
    float waveBody = max(body, uMaskStart);

    // Amplitude ramp with eye weighting
    float ramp = smoothstep(uMaskStart, uMaskStart + 0.3, body);
    float lateralOffset;
    if (uSwimAxis < 0.5) {
      lateralOffset = abs(position.y) / (bodyRange * 0.5 + 0.001);
    } else {
      lateralOffset = abs(position.x) / (bodyRange * 0.5 + 0.001);
    }
    float eyeWeight = clamp(lateralOffset * 3.0, 0.0, 1.0);
    float headAmp = uMaskFloor * eyeWeight;
    float amp = mix(headAmp, 1.0, ramp);

    // Phase: spatial from body position, temporal from per-instance attribute
    float headDelay = (1.0 - ramp) * uHeadPhase;
    float phase = waveBody * uFrequency * 6.2832 - aSwimPhase + headDelay;
    float wave = sin(phase) * aSwimAmplitude * amp;

    if (uSwimAxis < 0.5) {
      transformed.x += wave;
    } else {
      transformed.y += wave;
    }
  }
`;

/**
 * Create an InstancedMesh for all creatures of a given type.
 *
 * Extracts geometry from a source model clone, creates a shared material
 * with caustics + instanced swim vertex displacement, and sets up
 * per-instance attribute buffers for phase and amplitude.
 *
 * @param {THREE.Object3D} sourceClone - A cloned creature model (from getModelClone)
 * @param {string} creatureType - 'fish', 'dolphin', or 'manatee'
 * @param {number} maxCount - Maximum number of instances (pool size + growth headroom)
 * @returns {{ mesh: THREE.InstancedMesh, phaseAttr: THREE.InstancedBufferAttribute, ampAttr: THREE.InstancedBufferAttribute, offsetQuat: THREE.Quaternion } | null}
 */
export function createCreatureInstanced(sourceClone, creatureType, maxCount) {
  const config = SWIM_CONFIGS[creatureType] || SWIM_CONFIGS.fish;

  // ── Extract geometry from model hierarchy ──
  // Use the largest submesh (by vertex count) as the instanced geometry.
  // For typical low-poly glTF creature models, this is the body mesh.
  let bestChild = null;
  let bestVerts = 0;
  sourceClone.traverse(child => {
    if (child.isMesh && child.geometry) {
      const verts = child.geometry.attributes.position?.count || 0;
      if (verts > bestVerts) {
        bestVerts = verts;
        bestChild = child;
      }
    }
  });
  if (!bestChild) return null;

  // Clone geometry — do NOT bake parent transforms into vertices.
  // For SkinnedMesh models, the bone bind/unbind system handles intermediate
  // transforms (like the Armature's rotation). Baking them into the geometry
  // would double-apply the rotation. Instead, we store the offset quaternion
  // and apply it per-instance in syncCreatureInstances.
  const geo = bestChild.geometry.clone();

  // For SkinnedMesh models (glTF with armature), the bone bind/unbind system
  // neutralizes intermediate scene-graph rotations (e.g. Armature Rx(90°)).
  // The geometry vertices are effectively in the root's coordinate frame.
  // The physics system aligns root's +Z with the movement direction (see faceTarget()),
  // and the geometry's body axis is already along Z → no offset rotation needed.
  // For non-skinned models, we'd need to bake the parent chain rotation.
  const offsetQuat = new THREE.Quaternion(); // identity

  // ── Bounding box for swim shader body coordinate ──
  geo.computeBoundingBox();
  const bodyMin = geo.boundingBox.min.z;
  const bodyMax = geo.boundingBox.max.z;

  // ── Per-instance attribute buffers ──
  const phaseArray = new Float32Array(maxCount);
  const ampArray = new Float32Array(maxCount);

  const phaseAttr = new THREE.InstancedBufferAttribute(phaseArray, 1);
  phaseAttr.setUsage(THREE.DynamicDrawUsage);
  const ampAttr = new THREE.InstancedBufferAttribute(ampArray, 1);
  ampAttr.setUsage(THREE.DynamicDrawUsage);

  geo.setAttribute('aSwimPhase', phaseAttr);
  geo.setAttribute('aSwimAmplitude', ampAttr);

  // ── Shared material (cloned from source, with caustics + instanced swim) ──
  const mat = bestChild.material.clone();
  applyCaustics(mat, 2.0);

  // Chain instanced swim shader on top of caustics
  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    // Run caustics onBeforeCompile first
    if (prevCompile) prevCompile(shader);

    // Add shared swim uniforms
    shader.uniforms.uFrequency = { value: config.frequency };
    shader.uniforms.uMaskStart = { value: config.maskStart };
    shader.uniforms.uSwimAxis = { value: config.swimAxis };
    shader.uniforms.uBodyMin = { value: bodyMin };
    shader.uniforms.uBodyMax = { value: bodyMax };
    shader.uniforms.uMaskFloor = { value: config.maskFloor ?? 0.15 };
    shader.uniforms.uHeadPhase = { value: config.headPhase ?? 0.5 };

    // Inject attribute declarations + uniform declarations (vertex)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\n' + INSTANCED_SWIM_PARS
    );

    // Inject swim displacement (reads per-instance attributes)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' + INSTANCED_SWIM_MAIN
    );

};
  mat.needsUpdate = true;

  // ── Create InstancedMesh ──
  const instancedMesh = new THREE.InstancedMesh(geo, mat, maxCount);
  instancedMesh.count = 0; // Start with 0 visible instances
  instancedMesh.frustumCulled = false; // Instances span the whole scene
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;

  return { mesh: instancedMesh, phaseAttr, ampAttr, offsetQuat };
}

/**
 * Sync instanced mesh with the current frame's creatures (alive AND dead).
 *
 * Call this AFTER creature.updateMotion() for all creatures of this type.
 * Writes instance matrices and swim attributes for all creatures.
 * ALL creature meshes are hidden (even overflow) — instanced mesh handles rendering.
 *
 * @param {{ mesh: THREE.InstancedMesh, phaseAttr, ampAttr, offsetQuat }} instanced
 * @param {Array} creatures - All active creatures of this type (alive + dead)
 */
export function syncCreatureInstances(instanced, creatures) {
  const { mesh, phaseAttr, ampAttr, offsetQuat } = instanced;

  const maxCapacity = phaseAttr.array.length;
  let writeIdx = 0;

  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];

    // ALWAYS hide individual mesh — prevents overflow creatures from adding draw calls
    c.mesh.visible = false;

    if (writeIdx < maxCapacity) {
      // Compose instance matrix from creature's mesh transform.
      _pos.copy(c.mesh.position);
      _quat.copy(c.mesh.quaternion).multiply(offsetQuat);
      const s = c.mesh.scale.x; // Uniform scale
      _scale.set(s, s, s);
      _mat4.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(writeIdx, _mat4);

      // Write per-instance swim attributes (dead creatures get amplitude 0 — they float still)
      phaseAttr.array[writeIdx] = c._swimPhase || 0;
      ampAttr.array[writeIdx] = c.dead ? 0 : (c.swimData ? c.swimData.uniforms.uAmplitude.value : 0);

      writeIdx++;
    }
    // If buffer full, creature is hidden but not rendered (with 2k+ cap this rarely happens)
  }

  mesh.count = writeIdx;
  if (writeIdx > 0) {
    mesh.instanceMatrix.needsUpdate = true;
    phaseAttr.needsUpdate = true;
    ampAttr.needsUpdate = true;
  }
}
