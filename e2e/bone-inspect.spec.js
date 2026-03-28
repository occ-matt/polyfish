import { test, expect } from '@playwright/test';

test('Inspect bone hierarchies of all rigged models', async ({ page }) => {
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__debug?.scene != null, { timeout: 15_000 });

  const boneData = await page.evaluate(() => {
    const THREE = window.__debug.scene.constructor === undefined ? null : null;
    const d = window.__debug;
    const results = {};

    for (const { pool, type } of d.allCreaturePools) {
      const creature = pool.pool[0];
      if (!creature || !creature.mesh) continue;

      const bones = [];
      const meshInfo = [];
      creature.mesh.traverse((child) => {
        if (child.isBone) {
          const pos = child.position;
          const rot = child.quaternion;
          const euler = child.rotation;
          bones.push({
            name: child.name,
            parent: child.parent?.name || 'none',
            position: [pos.x.toFixed(3), pos.y.toFixed(3), pos.z.toFixed(3)],
            quaternion: [rot.x.toFixed(4), rot.y.toFixed(4), rot.z.toFixed(4), rot.w.toFixed(4)],
            euler: [
              (euler.x * 180 / Math.PI).toFixed(1),
              (euler.y * 180 / Math.PI).toFixed(1),
              (euler.z * 180 / Math.PI).toFixed(1),
              euler.order
            ],
          });
        }
        if (child.isMesh || child.isSkinnedMesh) {
          meshInfo.push({
            name: child.name,
            type: child.isSkinnedMesh ? 'SkinnedMesh' : 'Mesh',
            parent: child.parent?.name || 'none',
          });
        }
      });

      // Also check the root's rotation
      const rootRot = creature.mesh.rotation;
      results[type] = {
        rootName: creature.mesh.name || creature.mesh.type,
        rootEuler: [
          (rootRot.x * 180 / Math.PI).toFixed(1),
          (rootRot.y * 180 / Math.PI).toFixed(1),
          (rootRot.z * 180 / Math.PI).toFixed(1),
        ],
        bones,
        meshes: meshInfo,
        boneCount: bones.length,
      };
    }

    return results;
  });

  console.log('\n========== BONE HIERARCHY INSPECTION ==========');
  for (const [type, data] of Object.entries(boneData)) {
    console.log(`\n--- ${type.toUpperCase()} ---`);
    console.log(`  Root: ${data.rootName}, euler: (${data.rootEuler.join(', ')})`);
    console.log(`  Bones: ${data.boneCount}`);
    for (const bone of data.bones) {
      console.log(`    ${bone.name} (parent: ${bone.parent})`);
      console.log(`      pos: (${bone.position.join(', ')})`);
      console.log(`      quat: (${bone.quaternion.join(', ')})`);
      console.log(`      euler: (${bone.euler.join(', ')})`);
    }
    console.log(`  Meshes:`);
    for (const m of data.meshes) {
      console.log(`    ${m.name} [${m.type}] (parent: ${m.parent})`);
    }
  }
  console.log('\n================================================\n');

  expect(pageErrors).toHaveLength(0);
});
