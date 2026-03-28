/**
 * ProceduralRig — re-rigs a kelp SkinnedMesh with a denser bone chain
 * for smoother ragdoll animation.
 *
 * The original kelp_rigged.glb has only 5 bones (root + 4 sway bones),
 * which looks janky on tall plants. This utility replaces the sparse chain
 * with N evenly-spaced procedural bones and recomputes smooth skin weights
 * so deformation is continuous along the stalk.
 *
 * Call once on the source model (before cloning). All subsequent clones
 * via skeletonClone() will inherit the re-rigged geometry and skeleton.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _bonePos = new THREE.Vector3();

/**
 * Re-rig a kelp mesh with a denser procedural bone chain.
 *
 * @param {THREE.Object3D} meshRoot — the GLB scene root (Armature group)
 * @param {number} segmentCount — number of driven (sway) bones (excluding root)
 * @returns {boolean} true if re-rigging succeeded
 */
export function proceduralRerig(meshRoot, segmentCount) {
  if (segmentCount < 2) {
    console.warn('[ProceduralRig] segmentCount must be >= 2');
    return false;
  }

  // ── 1. Find the SkinnedMesh and collect existing bones ──────────
  let skinnedMesh = null;
  const existingBones = [];
  meshRoot.traverse((child) => {
    if (child.isSkinnedMesh && !skinnedMesh) skinnedMesh = child;
    if (child.isBone) existingBones.push(child);
  });

  if (!skinnedMesh || existingBones.length < 2) {
    console.warn('[ProceduralRig] No SkinnedMesh or insufficient bones found');
    return false;
  }

  // Force world matrices so bone positions and vertex transforms are current
  meshRoot.updateMatrixWorld(true);

  const rootBone = existingBones[0]; // kelp_root — stays as the static anchor
  const rootWorldPos = new THREE.Vector3();
  rootBone.getWorldPosition(rootWorldPos);

  // ── 2. Determine stalk extent from BIND-POSE vertex positions ──
  // We need positions in the BONE space (world space of the source model)
  // to correctly map vertices to bones.
  //
  // For a SkinnedMesh, the geometry positions are in bind-pose local space.
  // To get world positions, we use: bindMatrix * vertex_local
  // (NOT mesh.matrixWorld, which may differ from the bind transform).
  const geo = skinnedMesh.geometry;
  const posAttr = geo.attributes.position;
  const bindMatrix = skinnedMesh.bindMatrix;

  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    _v.fromBufferAttribute(posAttr, i);
    _v.applyMatrix4(bindMatrix);
    if (_v.y < minY) minY = _v.y;
    if (_v.y > maxY) maxY = _v.y;
  }

  const stalkHeight = maxY - minY;
  if (stalkHeight < 0.001) {
    console.warn('[ProceduralRig] Stalk height is zero — cannot rig');
    return false;
  }


  // ── 3. Remove old sway bones from hierarchy ────────────────────
  // Keep rootBone (index 0), remove all descendants
  for (let i = existingBones.length - 1; i >= 1; i--) {
    const bone = existingBones[i];
    if (bone.parent) bone.parent.remove(bone);
  }

  // ── 4. Create new bone chain ───────────────────────────────────
  // rootBone's world rotation is identity (Armature +90°X × root −90°X = I),
  // so children's local Y maps directly to world Y.
  //
  // Bones are spaced evenly from near the stalk base to ~92% of stalk height.
  // The remaining 8% is covered by the tip extension on the last capsule.

  const boneSpanFraction = 0.92;
  const boneSpan = stalkHeight * boneSpanFraction;
  const boneSpacing = segmentCount > 1 ? boneSpan / (segmentCount - 1) : boneSpan;

  // Offset from rootBone to first new bone
  const baseOffset = (minY - rootWorldPos.y) + stalkHeight * 0.02;

  const newSwayBones = [];
  let parentBone = rootBone;

  for (let i = 0; i < segmentCount; i++) {
    const bone = new THREE.Bone();
    bone.name = `proc_bone_${i}`;

    if (i === 0) {
      bone.position.set(0, baseOffset, 0);
    } else {
      bone.position.set(0, boneSpacing, 0);
    }

    parentBone.add(bone);
    newSwayBones.push(bone);
    parentBone = bone;
  }

  // Update world matrices for the new hierarchy
  meshRoot.updateMatrixWorld(true);


  // ── 5. Compute bind matrices (bone inverses) ──────────────────
  // allBones[0] = rootBone, allBones[1..N] = sway bones
  const allBones = [rootBone, ...newSwayBones];
  const boneInverses = allBones.map((bone) => {
    return new THREE.Matrix4().copy(bone.matrixWorld).invert();
  });

  // ── 6. Recompute skin weights ─────────────────────────────────
  // For each vertex, compute its bind-pose Y position and map to bones.
  // Use bindMatrix (not matrixWorld) so we're in the same space as the bones.

  const vertCount = posAttr.count;
  // Use Float32Array for skinIndex to match GLTF loader convention
  const skinIndexArr = new Float32Array(vertCount * 4);
  const skinWeightArr = new Float32Array(vertCount * 4);

  // Get bone world Y positions for direct distance-based weighting
  const boneWorldYs = allBones.map((bone) => {
    bone.getWorldPosition(_bonePos);
    return _bonePos.y;
  });


  // Root blend zone: fraction of stalk where vertices anchor to root
  const rootBlendZone = 0.06;

  for (let vi = 0; vi < vertCount; vi++) {
    _v.fromBufferAttribute(posAttr, vi);
    _v.applyMatrix4(bindMatrix);

    // Height ratio along the stalk: 0 = bottom, 1 = top
    const t = Math.max(0, Math.min(1, (_v.y - minY) / stalkHeight));

    if (t < rootBlendZone) {
      // Blend between root (stationary) and first sway bone
      const blend = t / rootBlendZone;
      skinIndexArr[vi * 4 + 0] = 0;   // root bone
      skinIndexArr[vi * 4 + 1] = 1;   // first sway bone
      skinIndexArr[vi * 4 + 2] = 0;
      skinIndexArr[vi * 4 + 3] = 0;
      skinWeightArr[vi * 4 + 0] = 1.0 - blend;
      skinWeightArr[vi * 4 + 1] = blend;
      skinWeightArr[vi * 4 + 2] = 0.0;
      skinWeightArr[vi * 4 + 3] = 0.0;
    } else {
      // Map height to sway bone range (0 → segmentCount-1)
      const swayT = (t - rootBlendZone) / (1.0 - rootBlendZone);
      const boneFloat = swayT * (segmentCount - 1);
      const boneIdx = Math.min(Math.floor(boneFloat), segmentCount - 2);
      const frac = boneFloat - boneIdx;

      // Indices in allBones array (offset +1 for root at index 0)
      const idx0 = boneIdx + 1;
      const idx1 = Math.min(boneIdx + 1, segmentCount - 1) + 1;

      if (idx0 === idx1) {
        skinIndexArr[vi * 4 + 0] = idx0;
        skinIndexArr[vi * 4 + 1] = 0;
        skinIndexArr[vi * 4 + 2] = 0;
        skinIndexArr[vi * 4 + 3] = 0;
        skinWeightArr[vi * 4 + 0] = 1.0;
        skinWeightArr[vi * 4 + 1] = 0.0;
        skinWeightArr[vi * 4 + 2] = 0.0;
        skinWeightArr[vi * 4 + 3] = 0.0;
      } else {
        const smoothFrac = frac * frac * (3.0 - 2.0 * frac);
        skinIndexArr[vi * 4 + 0] = idx0;
        skinIndexArr[vi * 4 + 1] = idx1;
        skinIndexArr[vi * 4 + 2] = 0;
        skinIndexArr[vi * 4 + 3] = 0;
        skinWeightArr[vi * 4 + 0] = 1.0 - smoothFrac;
        skinWeightArr[vi * 4 + 1] = smoothFrac;
        skinWeightArr[vi * 4 + 2] = 0.0;
        skinWeightArr[vi * 4 + 3] = 0.0;
      }
    }
  }

  // Replace geometry skin attributes
  geo.setAttribute('skinIndex', new THREE.Float32BufferAttribute(skinIndexArr, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeightArr, 4));

  // ── 7. Build new skeleton and rebind mesh ─────────────────────
  const skeleton = new THREE.Skeleton(allBones, boneInverses);

  // Rebind: use the CURRENT bindMatrix (set by GLTF loader at load time).
  // We must clone it to avoid the self-assignment issue in bind().
  const bindMatrixClone = skinnedMesh.bindMatrix.clone();
  skinnedMesh.bind(skeleton, bindMatrixClone);

  return true;
}
