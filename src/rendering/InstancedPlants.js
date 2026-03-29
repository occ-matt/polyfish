/**
 * InstancedPlants — GPU-instanced rendering for kelp plants with per-instance
 * skeletal animation via a bone DataTexture.
 *
 * Challenge: Unlike creatures (which only need position/rotation/scale + swim
 * phase), plants use SkinnedMesh with 13 bones driven by VerletChain physics.
 * Each plant has unique bone poses every frame. Standard InstancedMesh can't
 * handle per-instance skeletal animation.
 *
 * Solution: Store bone matrices for ALL plant instances in a single DataTexture.
 * A custom vertex shader reads bone matrices via texelFetch using gl_InstanceID,
 * replacing Three.js's built-in skinning with texture-based per-instance skinning.
 *
 * Texture layout:
 *   - Width  = BONES_PER_PLANT * 4 pixels (each 4×4 matrix = 4 RGBA pixels)
 *   - Height = maxCount (one row per plant instance)
 *   - Format = RGBAFormat, FloatType (RGBA32F)
 *
 * Per-frame sync:
 *   1. Plant.update() runs normally (VerletChain → bone rotations)
 *   2. syncPlantInstances() reads bone.matrixWorld from each plant's skeleton,
 *      computes local bone matrices, writes to DataTexture
 *   3. Three.js renders all plants in a single draw call with custom skinning
 *
 * Bone matrix computation:
 *   localBoneMat[i] = inv(meshWorld) × bone.matrixWorld × boneInvBind[i]
 *   where boneInvBind[i] = boneInverse[i] × bindMatrix  (precomputed once)
 *
 *   At rest pose, localBoneMat = identity → vertex stays in local space.
 *   instanceMatrix = mesh.matrixWorld → brings to world space correctly.
 */
import * as THREE from 'three';
import { applyCaustics } from './CausticShader.js';

// How many bones the procedurally re-rigged kelp has (1 root + 12 sway)
const BONES_PER_PLANT = 13;
const PIXELS_PER_BONE = 4; // 4×4 matrix stored as 4 RGBA pixels
const TEX_WIDTH = BONES_PER_PLANT * PIXELS_PER_BONE; // 52 pixels per row

// Reusable temp objects (zero per-frame allocation)
const _invMeshWorld = new THREE.Matrix4();
const _A = new THREE.Matrix4();
const _localBone = new THREE.Matrix4();

// ── Custom vertex shader chunks for instanced skeletal animation ──

const INSTANCED_SKIN_PARS = /* glsl */`
  // Bone DataTexture: rows = instances, columns = bone matrices (4 pixels each)
  uniform highp sampler2D uPlantBoneTex;
  uniform int uBonesPerPlant;

  // Skin attributes (already in geometry from ProceduralRig)
  attribute vec4 skinIndex;
  attribute vec4 skinWeight;

  mat4 getPlantBone(int boneIdx) {
    int x = boneIdx * 4;
    int y = gl_InstanceID;
    return mat4(
      texelFetch(uPlantBoneTex, ivec2(x,     y), 0),
      texelFetch(uPlantBoneTex, ivec2(x + 1, y), 0),
      texelFetch(uPlantBoneTex, ivec2(x + 2, y), 0),
      texelFetch(uPlantBoneTex, ivec2(x + 3, y), 0)
    );
  }
`;

const INSTANCED_SKIN_NORMAL = /* glsl */`
  vec3 objectNormal = vec3(normal);
  {
    ivec4 bIdx = ivec4(skinIndex);
    vec4 bWt = skinWeight;
    mat4 skinNormMat = mat4(0.0);
    if (bWt.x > 0.0) skinNormMat += bWt.x * getPlantBone(bIdx.x);
    if (bWt.y > 0.0) skinNormMat += bWt.y * getPlantBone(bIdx.y);
    if (bWt.z > 0.0) skinNormMat += bWt.z * getPlantBone(bIdx.z);
    if (bWt.w > 0.0) skinNormMat += bWt.w * getPlantBone(bIdx.w);
    objectNormal = normalize((skinNormMat * vec4(objectNormal, 0.0)).xyz);
  }
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
`;

const INSTANCED_SKIN_VERTEX = /* glsl */`
  vec3 transformed = vec3(position);
  {
    ivec4 bIdx = ivec4(skinIndex);
    vec4 bWt = skinWeight;
    vec4 localPos = vec4(position, 1.0);
    vec4 skinned = vec4(0.0);
    if (bWt.x > 0.0) skinned += bWt.x * getPlantBone(bIdx.x) * localPos;
    if (bWt.y > 0.0) skinned += bWt.y * getPlantBone(bIdx.y) * localPos;
    if (bWt.z > 0.0) skinned += bWt.z * getPlantBone(bIdx.z) * localPos;
    if (bWt.w > 0.0) skinned += bWt.w * getPlantBone(bIdx.w) * localPos;
    transformed = skinned.xyz;
  }
`;

/**
 * Create an InstancedMesh for all plants with per-instance skeletal animation.
 *
 * @param {THREE.Object3D} sourceModel - The source kelp model (after proceduralRerig)
 * @param {number} maxCount - Maximum simultaneous plant instances
 * @returns {Object|null} Instanced plant data, or null if source has no SkinnedMesh
 */
export function createPlantInstanced(sourceModel, maxCount) {
  // ── Find the SkinnedMesh inside the source model ──
  let skinnedMesh = null;
  sourceModel.traverse(child => {
    if (child.isSkinnedMesh && !skinnedMesh) skinnedMesh = child;
  });
  if (!skinnedMesh) {
    console.warn('[InstancedPlants] No SkinnedMesh found in source model');
    return null;
  }

  const skeleton = skinnedMesh.skeleton;
  if (!skeleton || skeleton.bones.length !== BONES_PER_PLANT) {
    console.warn(`[InstancedPlants] Expected ${BONES_PER_PLANT} bones, got ${skeleton?.bones.length}`);
    return null;
  }

  // ── Clone geometry (has skinIndex, skinWeight from ProceduralRig) ──
  const geo = skinnedMesh.geometry.clone();

  // ── Precompute boneInvBind[i] = boneInverse[i] × bindMatrix ──
  // These are constant for all plants (same model, same bind pose).
  const bindMatrix = skinnedMesh.bindMatrix.clone();
  const boneInvBind = skeleton.boneInverses.map(inv => {
    const m = new THREE.Matrix4();
    m.multiplyMatrices(inv, bindMatrix);
    return m;
  });

  // ── Create bone DataTexture ──
  // Layout: width = 52 (13 bones × 4 pixels/bone), height = maxCount
  //
  // iOS compatibility: Do NOT set internalFormat = 'RGBA32F' explicitly.
  // iOS Safari WebGL2 may not support RGBA32F for texelFetch without
  // EXT_color_buffer_float. Letting Three.js pick the internal format
  // (it will use RGBA32F on desktop, and may fall back on mobile).
  // If iOS still fails, switch to HalfFloatType with Uint16Array data.
  const texHeight = maxCount;
  const boneData = new Float32Array(TEX_WIDTH * texHeight * 4);
  const boneTexture = new THREE.DataTexture(
    boneData, TEX_WIDTH, texHeight,
    THREE.RGBAFormat, THREE.FloatType
  );
  boneTexture.needsUpdate = true;

  // ── Create shared material with caustics + custom instanced skinning ──
  const mat = skinnedMesh.material.clone();
  applyCaustics(mat, 4.0);

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    // Run caustics patch first
    if (prevCompile) prevCompile(shader);

    // Add bone texture uniform
    shader.uniforms.uPlantBoneTex = { value: boneTexture };
    shader.uniforms.uBonesPerPlant = { value: BONES_PER_PLANT };

    // ── Inject declarations (bone lookup function + skin attribute declarations) ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\n' + INSTANCED_SKIN_PARS
    );

    // ── Replace normal computation with custom bone-deformed normals ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      INSTANCED_SKIN_NORMAL
    );

    // ── Replace vertex position with custom bone-deformed position ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      INSTANCED_SKIN_VERTEX
    );

    // ── Remove Three.js built-in skinning (not needed, we do our own) ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinbase_vertex>', ''
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinnormal_vertex>', ''
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinning_vertex>', ''
    );
  };
  mat.needsUpdate = true;

  // ── Create InstancedMesh ──
  const instancedMesh = new THREE.InstancedMesh(geo, mat, maxCount);
  instancedMesh.count = 0;
  instancedMesh.frustumCulled = false;
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;

  // InstancedPlants created: maxCount instances, verts, bones, texture dims

  return {
    mesh: instancedMesh,
    boneTexture,
    boneData,
    boneInvBind,
    texWidth: TEX_WIDTH,
    texHeight,
  };
}

/**
 * Sync instanced mesh with current frame's active plants.
 *
 * Call AFTER plant.update() for all plants (so bones are current).
 * Writes instance matrices + bone matrices to DataTexture.
 *
 * @param {Object} instanced - Return value from createPlantInstanced
 * @param {Array} activePlants - Active plant entities
 */
export function syncPlantInstances(instanced, activePlants) {
  const { mesh, boneTexture, boneData, boneInvBind, texWidth } = instanced;

  // Clamp to buffer capacity — plant pool can grow beyond MAX_PLANT_INSTANCES.
  // The bone DataTexture has `maxCount` rows; writing past it corrupts bone data.
  const maxCapacity = mesh.instanceMatrix.count; // InstancedMesh maxCount
  let writeIdx = 0;

  for (let i = 0; i < activePlants.length; i++) {
    const plant = activePlants[i];

    // ALWAYS hide individual mesh — prevents overflow plants from adding draw calls
    plant.mesh.visible = false;

    if (writeIdx >= maxCapacity) {
      continue;
    }

    // ── Instance matrix = plant's world transform ──
    mesh.setMatrixAt(writeIdx, plant.mesh.matrixWorld);

    // ── Compute local bone matrices and write to DataTexture ──
    // localBone[b] = inv(meshWorld) × bone.matrixWorld × boneInvBind[b]
    // At rest: identity. With deformation: encodes bone rotation in local space.
    _invMeshWorld.copy(plant.mesh.matrixWorld).invert();

    const bones = plant._allBones;
    if (!bones) { writeIdx++; continue; }

    const rowOffset = writeIdx * texWidth * 4; // 4 floats per pixel

    for (let b = 0; b < BONES_PER_PLANT && b < bones.length; b++) {
      // A = bone.matrixWorld × boneInvBind[b]
      _A.multiplyMatrices(bones[b].matrixWorld, boneInvBind[b]);
      // localBone = inv(meshWorld) × A
      _localBone.multiplyMatrices(_invMeshWorld, _A);

      // Write 4×4 matrix as 4 RGBA pixels (column-major, matching Three.js Matrix4.elements)
      const pixelOffset = rowOffset + b * PIXELS_PER_BONE * 4;
      const e = _localBone.elements;
      // Pixel 0: column 0
      boneData[pixelOffset]      = e[0];
      boneData[pixelOffset + 1]  = e[1];
      boneData[pixelOffset + 2]  = e[2];
      boneData[pixelOffset + 3]  = e[3];
      // Pixel 1: column 1
      boneData[pixelOffset + 4]  = e[4];
      boneData[pixelOffset + 5]  = e[5];
      boneData[pixelOffset + 6]  = e[6];
      boneData[pixelOffset + 7]  = e[7];
      // Pixel 2: column 2
      boneData[pixelOffset + 8]  = e[8];
      boneData[pixelOffset + 9]  = e[9];
      boneData[pixelOffset + 10] = e[10];
      boneData[pixelOffset + 11] = e[11];
      // Pixel 3: column 3
      boneData[pixelOffset + 12] = e[12];
      boneData[pixelOffset + 13] = e[13];
      boneData[pixelOffset + 14] = e[14];
      boneData[pixelOffset + 15] = e[15];
    }

    writeIdx++;
  }

  mesh.count = writeIdx;
  if (writeIdx > 0) {
    mesh.instanceMatrix.needsUpdate = true;
    boneTexture.needsUpdate = true;
  }
}
