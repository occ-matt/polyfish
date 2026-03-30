/**
 * EditorMode — spawns one of each entity type in a row for inspection.
 * Click an entity to inspect and edit its CONFIG properties.
 * Features: orbit controls, zoom-to-entity, collider visualization,
 *           mouth offset markers, tint override.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneMode } from './SceneMode.js';
import { getModelClone } from '../core/ModelLoader.js';
import { CONFIG } from '../config.js';
import { createColorMaterial } from '../rendering/IBLMaterial.js';
import { CREATURE_ANIM_CONFIGS } from '../systems/ProceduralAnim.js';
import { applySwimMaterial, updateSwimUniforms } from '../rendering/SwimMaterial.js';

// Layout: entities spaced along X axis.
// LINEUP_Y must be well above the terrain surface (which ranges -9.81 to -5.81,
// base at -7.81). -3.0 places entities comfortably in the water column.
const LINEUP_Y = -3.0;
const LINEUP_Z = 2;
const SPACING = 5.5;

const ENTITY_ORDER = [
  { type: 'fish',    label: 'Fish',    configKey: 'creatures.fish' },
  { type: 'dolphin', label: 'Dolphin', configKey: 'creatures.dolphin' },
  { type: 'manatee', label: 'Manatee', configKey: 'creatures.manatee' },
  { type: 'kelp',    label: 'Kelp',    configKey: null },
  { type: 'food',    label: 'Food',    configKey: null },
  { type: 'poo',     label: 'Seed',    configKey: null },
];

const CREATURE_TYPES = ['fish', 'dolphin', 'manatee'];

function getRuntimeScale(type) {
  if (CONFIG.creatures[type]) return CONFIG.creatures[type].scale;
  if (type === 'kelp') return CONFIG.kelpScale;
  if (type === 'food') return CONFIG.foodScale;
  if (type === 'poo') return CONFIG.seedScale;
  return 1;
}

function getConfigForType(type) {
  if (CONFIG.creatures[type]) return CONFIG.creatures[type];
  if (type === 'kelp') return { kelpScale: CONFIG.kelpScale, collisionRadius: CONFIG.plant.collisionRadius };
  if (type === 'food') return { foodScale: CONFIG.foodScale, color: CONFIG.foodColor };
  if (type === 'poo') return { seedScale: CONFIG.seedScale, color: CONFIG.seedColor };
  return null;
}

// Editable fields per entity type — must match CONFIG.creatures[type] keys.
// Grouped: movement → eating → physics → metabolism → visual
const EDITABLE_FIELDS = {
  fish: ['speed', 'thrustMultiplier', 'lookTime', 'engineBurnTime',
         'foodToReproduce', 'foodToLeaveWaste', 'foodEnergy',
         'mouthRadius', 'mouthOffset', 'fleeRadius',
         'mass', 'drag', 'angularDrag', 'capsuleRadius', 'capsuleHalfHeight',
         'hasMetabolism', 'metabolicClock', 'startingMetabolism', 'energyUsedPerMinute',
         'minLifetime', 'scale', 'color'],
  dolphin: ['speed', 'thrustMultiplier', 'lookTime', 'engineBurnTime',
            'foodToReproduce', 'foodToLeaveWaste', 'foodEnergy',
            'mouthRadius', 'mouthOffset',
            'mass', 'drag', 'angularDrag', 'capsuleRadius', 'capsuleHalfHeight',
            'hasMetabolism', 'metabolicClock', 'startingMetabolism', 'energyUsedPerMinute',
            'minLifetime', 'scale', 'color'],
  manatee: ['speed', 'thrustMultiplier', 'lookTime', 'engineBurnTime',
            'foodToReproduce', 'foodToLeaveWaste', 'foodEnergy',
            'mouthRadius', 'mouthOffset', 'fleeRadius',
            'mass', 'drag', 'angularDrag', 'capsuleRadius', 'capsuleHalfHeight',
            'hasMetabolism', 'metabolicClock', 'startingMetabolism', 'energyUsedPerMinute',
            'minLifetime', 'scale', 'color'],
  kelp: ['kelpScale', 'collisionRadius'],
  food: ['foodScale', 'color'],
  poo: ['seedScale', 'color'],
};

const INPUT_STYLE = 'background:rgba(30,50,80,0.8);border:1px solid rgba(100,150,200,0.3);' +
  'color:#fff;padding:3px 6px;border-radius:3px;font:12px monospace;text-align:right';
const ROW_STYLE = 'margin:4px 0;display:flex;justify-content:space-between;align-items:center;gap:8px';

export class EditorMode extends SceneMode {
  constructor() {
    super('editor');
    this.spawnedMeshes = [];
    this.labels = [];
    this.selectedIndex = -1;
    this.swimDataList = [];   // per-entity swim shader data (or null for non-creatures)
    this.debugObjects = [];
    this.showColliders = true;
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._onPointerDown = null;
    this._onPointerUp = null;
    this._ctx = null;
    this._orbitControls = null;

    // Camera animation state
    this._camAnim = null; // { from, to, targetFrom, targetTo, t, duration }
  }

  async enter(ctx) {
    this._ctx = ctx;

    // Disable FPS camera — editor uses its own orbit controls
    ctx.cameraController.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();

    // Set up OrbitControls
    const orbit = new OrbitControls(ctx.camera, ctx.renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.rotateSpeed = 0.6;
    orbit.zoomSpeed = 1.0;
    orbit.panSpeed = 0.8;
    orbit.minDistance = 1;
    orbit.maxDistance = 60;
    orbit.maxPolarAngle = Math.PI * 0.85;
    this._orbitControls = orbit;

    // Initial camera — overview of lineup
    const centerX = (ENTITY_ORDER.length - 1) * SPACING / 2;
    orbit.target.set(centerX, LINEUP_Y + 1.5, LINEUP_Z);
    ctx.camera.position.set(centerX, LINEUP_Y + 6, LINEUP_Z + 18);
    orbit.update();

    this._showUI();
    this._spawnLineup(ctx);
    this._buildDebugVisuals(ctx);

    // Click detection — track pointer down position to distinguish clicks from drags
    this._downPos = { x: 0, y: 0 };
    this._onPointerDown = (e) => { this._downPos.x = e.clientX; this._downPos.y = e.clientY; };
    this._onPointerUp = (e) => {
      const dx = e.clientX - this._downPos.x;
      const dy = e.clientY - this._downPos.y;
      // Only treat as click if mouse barely moved (not a drag/orbit)
      if (dx * dx + dy * dy < 25) this._handleClick(e, ctx);
    };
    ctx.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    ctx.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
  }

  async exit(ctx) {
    // Re-enable FPS camera controller
    ctx.cameraController.enabled = true;

    // Dispose orbit controls
    if (this._orbitControls) {
      this._orbitControls.dispose();
      this._orbitControls = null;
    }

    const scene = ctx.scene;
    for (const mesh of this.spawnedMeshes) scene.remove(mesh);
    this.spawnedMeshes = [];

    for (const lbl of this.labels) scene.remove(lbl);
    this.labels = [];

    for (const obj of this.debugObjects) scene.remove(obj);
    this.debugObjects = [];

    this.swimDataList = [];

    this.selectedIndex = -1;
    this._ctx = null;
    this._camAnim = null;
    this._hideUI();
    this._hidePropertiesPanel();

    if (this._onPointerDown) {
      ctx.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
      ctx.renderer.domElement.removeEventListener('pointerup', this._onPointerUp);
      this._onPointerDown = null;
      this._onPointerUp = null;
    }
  }

  update(dt, elapsed, ctx) {
    // Tick swim shader animations
    for (const sd of this.swimDataList) {
      if (sd) updateSwimUniforms(sd, elapsed, 0.3, 0);
    }

    // Animate camera toward selected entity
    if (this._camAnim) {
      const anim = this._camAnim;
      anim.t += dt;
      const raw = Math.min(anim.t / anim.duration, 1);
      const t = raw * raw * (3 - 2 * raw); // smoothstep

      ctx.camera.position.lerpVectors(anim.from, anim.to, t);
      this._orbitControls.target.lerpVectors(anim.targetFrom, anim.targetTo, t);

      if (raw >= 1) this._camAnim = null;
    }

    // Update orbit controls
    if (this._orbitControls) this._orbitControls.update();

    // Update debug visuals
    this._updateDebugVisuals();
  }

  _handleClick(event, ctx) {
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._mouse, ctx.camera);

    for (let i = 0; i < this.spawnedMeshes.length; i++) {
      const mesh = this.spawnedMeshes[i];
      const intersects = this._raycaster.intersectObject(mesh, true);
      if (intersects.length > 0) {
        this._selectEntity(i);
        return;
      }
    }
  }

  _selectEntity(index) {
    this.selectedIndex = index;
    const entry = ENTITY_ORDER[index];
    const mesh = this.spawnedMeshes[index];

    // Highlight selected — dim others
    for (let i = 0; i < this.spawnedMeshes.length; i++) {
      const m = this.spawnedMeshes[i];
      m.traverse(child => {
        if (child.isMesh && child.material) {
          child.material.opacity = (i === index) ? 1.0 : 0.4;
          child.material.transparent = (i !== index);
        }
      });
    }

    // Zoom camera to selected entity
    if (mesh && this._orbitControls) {
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      // Camera distance: scale-dependent — close for small things, further for kelp
      const dist = Math.max(maxDim * 2.5, 3);

      // Animate from current position
      const camTarget = new THREE.Vector3(
        center.x + dist * 0.3,
        center.y + dist * 0.4,
        center.z + dist * 0.8
      );

      this._camAnim = {
        from: this._ctx.camera.position.clone(),
        to: camTarget,
        targetFrom: this._orbitControls.target.clone(),
        targetTo: center,
        t: 0,
        duration: 0.6,
      };
    }

    this._showPropertiesPanel(entry.type, entry.label);
  }

  _spawnLineup(ctx) {
    const scene = ctx.scene;

    for (let i = 0; i < ENTITY_ORDER.length; i++) {
      const { type, label } = ENTITY_ORDER[i];
      const x = i * SPACING;
      // Kelp grows from the seafloor; everything else floats in the water column
      const y = type === 'kelp' ? -7.0 : LINEUP_Y;
      const z = LINEUP_Z;

      let mesh = null;
      const scale = getRuntimeScale(type);

      if (type === 'poo') {
        const pooGeo = new THREE.OctahedronGeometry(0.1, 0);
        const pooMat = createColorMaterial(CONFIG.seedColor, { flatShading: true });
        mesh = new THREE.Mesh(pooGeo, pooMat);
        mesh.scale.setScalar(scale);
        mesh.userData.editorSpin = true;
      } else if (type === 'food') {
        mesh = getModelClone(type);
        if (!mesh) {
          const foodGeo = new THREE.OctahedronGeometry(0.12, 1);
          const foodMat = createColorMaterial(CONFIG.foodColor, { flatShading: true });
          mesh = new THREE.Mesh(foodGeo, foodMat);
        }
        if (mesh) {
          mesh.scale.setScalar(scale);
          mesh.userData.editorSpin = true;
        }
      } else {
        mesh = getModelClone(type);
        if (mesh) {
          mesh.scale.setScalar(scale);
          mesh.userData.editorSpin = (type !== 'kelp');
        }
      }

      if (mesh) {
        mesh.position.set(x, y, z);
        mesh.visible = true;
        mesh.traverse(child => {
          child.visible = true;
          if (child.isMesh) child.frustumCulled = false;
        });
        scene.add(mesh);
        mesh.updateMatrixWorld(true);
        this.spawnedMeshes.push(mesh);

        if (CREATURE_TYPES.includes(type)) {
          const sd = applySwimMaterial(mesh, type);
          this.swimDataList.push(sd);
        } else {
          this.swimDataList.push(null);
        }
      } else {
        console.warn(`[Editor] Failed to clone model for: ${type}`);
        const placeholder = new THREE.Object3D();
        placeholder.position.set(x, y, z);
        scene.add(placeholder);
        this.spawnedMeshes.push(placeholder);
        this.swimDataList.push(null);
      }

      const labelY = y - 1.8;
      const sprite = this._makeLabel(label, x, labelY, z);
      scene.add(sprite);
      this.labels.push(sprite);
    }
  }

  // ── Debug Visuals (actual Jolt collision shapes) ─────────────────

  _buildDebugVisuals(ctx) {
    for (const obj of this.debugObjects) ctx.scene.remove(obj);
    this.debugObjects = [];

    const scene = ctx.scene;
    const wireframeMat = (color, opacity = 0.4) => new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity, depthTest: false,
    });
    const solidMat = (color, opacity = 0.25) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide,
    });

    for (let i = 0; i < ENTITY_ORDER.length; i++) {
      const { type } = ENTITY_ORDER[i];
      const mesh = this.spawnedMeshes[i];
      if (!mesh) continue;

      if (CREATURE_TYPES.includes(type)) {
        const cfg = CONFIG.creatures[type];

        // Capsule collider — matches Jolt CapsuleShape(halfHeight, radius)
        // Capsule is rotated 90° on X to align with Z (swim direction)
        const capsuleGroup = this._makeCapsuleMesh(
          cfg.capsuleHalfHeight, cfg.capsuleRadius, 0xff4444
        );
        // Rotate to match Jolt body rotation (90° around X)
        capsuleGroup.rotation.x = Math.PI / 2;
        capsuleGroup.position.copy(mesh.position);
        capsuleGroup.renderOrder = 998;
        capsuleGroup.userData.debugType = 'capsule';
        capsuleGroup.userData.entityIndex = i;
        scene.add(capsuleGroup);
        this.debugObjects.push(capsuleGroup);

        // Mouth radius sphere at mouth offset
        const mouthGeo = new THREE.SphereGeometry(1, 12, 8);
        const mouthSphere = new THREE.Mesh(mouthGeo, solidMat(0x44ff44, 0.3));
        mouthSphere.renderOrder = 998;
        mouthSphere.userData.debugType = 'mouth';
        mouthSphere.userData.entityIndex = i;
        scene.add(mouthSphere);
        this.debugObjects.push(mouthSphere);

        // Mouth offset line
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0),
        ]);
        const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x44ff44, depthTest: false }));
        line.renderOrder = 999;
        line.userData.debugType = 'mouthLine';
        line.userData.entityIndex = i;
        scene.add(line);
        this.debugObjects.push(line);

      } else if (type === 'kelp') {
        // Ragdoll capsule chain — one capsule per bone segment
        const plantR = CONFIG.plant.collisionRadius * 0.4;
        mesh.updateMatrixWorld(true);
        const allBones = [];
        mesh.traverse(child => { if (child.isBone) allBones.push(child); });
        // Skip kelp_root (index 0), same as Plant.js swayBones
        for (let b = 1; b < allBones.length; b++) {
          const bone = allBones[b];
          const wp = new THREE.Vector3();
          bone.getWorldPosition(wp);

          // Approximate segment half-height from spacing to next bone
          let segHH = 0.3;
          if (b + 1 < allBones.length) {
            const nextWp = new THREE.Vector3();
            allBones[b + 1].getWorldPosition(nextWp);
            segHH = Math.max(wp.distanceTo(nextWp) * 0.4, 0.05);
          }

          const capsule = this._makeCapsuleMesh(segHH, plantR, 0x44ff44);
          capsule.position.copy(wp);
          capsule.renderOrder = 998;
          capsule.userData.debugType = 'plantCapsule';
          capsule.userData.entityIndex = i;
          capsule.userData.boneIndex = b - 1;
          scene.add(capsule);
          this.debugObjects.push(capsule);
        }

      } else if (type === 'poo') {
        // Seed octahedron convex hull collider — matches render mesh
        const seedR = 0.1 * CONFIG.seedScale;
        const octGeo = new THREE.OctahedronGeometry(seedR, 0);
        const oct = new THREE.Mesh(octGeo, wireframeMat(0xffaa00));
        oct.position.copy(mesh.position);
        oct.renderOrder = 998;
        oct.userData.debugType = 'seedHull';
        oct.userData.entityIndex = i;
        scene.add(oct);
        this.debugObjects.push(oct);

      } else if (type === 'food') {
        // Food has no Jolt collider currently — show a small indicator
        const foodR = 0.05;
        const sphereGeo = new THREE.SphereGeometry(foodR, 8, 6);
        const sphere = new THREE.Mesh(sphereGeo, wireframeMat(0x888888, 0.2));
        sphere.position.copy(mesh.position);
        sphere.renderOrder = 998;
        sphere.userData.debugType = 'noCollider';
        sphere.userData.entityIndex = i;
        scene.add(sphere);
        this.debugObjects.push(sphere);
      }
    }
  }

  /**
   * Create a capsule wireframe mesh (cylinder + two hemisphere caps).
   */
  _makeCapsuleMesh(halfHeight, radius, color) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity: 0.5, depthTest: false,
    });

    // Cylinder body
    const cylGeo = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 12, 1, true);
    const cyl = new THREE.Mesh(cylGeo, mat);
    group.add(cyl);

    // Top cap
    const capGeo = new THREE.SphereGeometry(radius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const topCap = new THREE.Mesh(capGeo, mat);
    topCap.position.y = halfHeight;
    group.add(topCap);

    // Bottom cap
    const bottomCap = new THREE.Mesh(capGeo, mat);
    bottomCap.position.y = -halfHeight;
    bottomCap.rotation.x = Math.PI;
    group.add(bottomCap);

    return group;
  }

  _updateDebugVisuals() {
    for (const obj of this.debugObjects) {
      obj.visible = this.showColliders;
      if (!this.showColliders) continue;

      const i = obj.userData.entityIndex;
      const { type } = ENTITY_ORDER[i];
      const mesh = this.spawnedMeshes[i];
      if (!mesh) continue;

      if (obj.userData.debugType === 'capsule' && CREATURE_TYPES.includes(type)) {
        obj.position.copy(mesh.position);
      }

      if (obj.userData.debugType === 'mouth' && CREATURE_TYPES.includes(type)) {
        const cfg = CONFIG.creatures[type];
        const fwd = new THREE.Vector3(0, 0, 1);
        fwd.applyQuaternion(mesh.quaternion);
        const mouthPos = mesh.position.clone().addScaledVector(fwd, cfg.mouthOffset || 0);
        obj.position.copy(mouthPos);
        obj.scale.setScalar(cfg.mouthRadius);
      }

      if (obj.userData.debugType === 'mouthLine' && CREATURE_TYPES.includes(type)) {
        const cfg = CONFIG.creatures[type];
        const fwd = new THREE.Vector3(0, 0, 1);
        fwd.applyQuaternion(mesh.quaternion);
        const mouthPos = mesh.position.clone().addScaledVector(fwd, cfg.mouthOffset || 0);
        const positions = obj.geometry.attributes.position;
        positions.setXYZ(0, mesh.position.x, mesh.position.y, mesh.position.z);
        positions.setXYZ(1, mouthPos.x, mouthPos.y, mouthPos.z);
        positions.needsUpdate = true;
      }

      // Plant capsules follow bone world positions
      if (obj.userData.debugType === 'plantCapsule') {
        const allBones = [];
        mesh.traverse(child => { if (child.isBone) allBones.push(child); });
        const boneIdx = obj.userData.boneIndex + 1; // +1 because we skip kelp_root
        if (boneIdx < allBones.length) {
          const wp = new THREE.Vector3();
          allBones[boneIdx].getWorldPosition(wp);
          obj.position.copy(wp);
        }
      }
    }
  }

  _rebuildDebugVisuals() {
    if (this._ctx) this._buildDebugVisuals(this._ctx);
  }

  _makeLabel(text, x, y, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 36;
    const c = canvas.getContext('2d');
    c.shadowColor = 'rgba(0,0,0,0.8)';
    c.shadowBlur = 4;
    c.shadowOffsetX = 1;
    c.shadowOffsetY = 1;
    c.fillStyle = '#ffffff';
    c.font = 'bold 20px monospace';
    c.textAlign = 'center';
    c.fillText(text, canvas.width / 2, 26);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(2.2 * aspect, 2.2, 1);
    return sprite;
  }

  // ── Properties Panel ──────────────────────────────────────────

  _showPropertiesPanel(type, label) {
    let panel = document.getElementById('editor-props');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'editor-props';
      panel.style.cssText =
        'position:fixed;top:60px;right:12px;z-index:20;' +
        'background:rgba(10,25,47,0.94);padding:14px 18px;border-radius:8px;' +
        'border:1px solid rgba(100,150,200,0.4);color:#ddd;font:13px monospace;' +
        'max-height:80vh;overflow-y:auto;min-width:280px;' +
        'scrollbar-width:thin;scrollbar-color:rgba(100,150,200,0.3) transparent;';
      document.body.appendChild(panel);
    }

    const cfg = getConfigForType(type);
    const fields = EDITABLE_FIELDS[type] || [];

    let html = `<div style="font-size:16px;font-weight:bold;margin-bottom:12px;color:#8cf;border-bottom:1px solid rgba(100,150,200,0.3);padding-bottom:8px">${label}</div>`;

    html += `<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Properties</div>`;

    for (const field of fields) {
      if (field === 'color') continue;
      const value = cfg[field];
      const inputType = typeof value === 'boolean' ? 'checkbox' : 'number';

      if (inputType === 'checkbox') {
        html += `<div style="${ROW_STYLE}">` +
          `<label style="color:#aaa">${field}</label>` +
          `<input type="checkbox" data-field="${field}" data-type="${type}" ${value ? 'checked' : ''} ` +
          `style="accent-color:#4af">` +
          `</div>`;
      } else {
        html += `<div style="${ROW_STYLE}">` +
          `<label style="color:#aaa">${field}</label>` +
          `<input type="number" data-field="${field}" data-type="${type}" value="${value}" step="any" ` +
          `style="width:80px;${INPUT_STYLE}">` +
          `</div>`;
      }
    }

    // Tint/Color section
    if (fields.includes('color')) {
      const colorVal = cfg.color;
      const hexStr = '#' + (colorVal & 0xFFFFFF).toString(16).padStart(6, '0');
      html += `<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:12px 0 6px;border-top:1px solid rgba(100,150,200,0.2);padding-top:10px">Tint</div>`;
      html += `<div style="${ROW_STYLE}">` +
        `<label style="color:#aaa">color</label>` +
        `<div style="display:flex;align-items:center;gap:6px">` +
        `<input type="color" data-color-field="color" data-type="${type}" value="${hexStr}" ` +
        `style="width:36px;height:28px;border:1px solid rgba(100,150,200,0.3);border-radius:3px;cursor:pointer;background:transparent;padding:0">` +
        `<input type="text" data-color-hex="color" data-type="${type}" value="${hexStr}" ` +
        `style="width:70px;${INPUT_STYLE};text-align:center">` +
        `</div></div>`;
    }

    // Animation section for creatures
    const animConfig = CREATURE_ANIM_CONFIGS[type];
    if (animConfig) {
      html += `<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:12px 0 6px;border-top:1px solid rgba(100,150,200,0.2);padding-top:10px">Animation</div>`;

      const animFields = ['frequency', 'amplitude', 'rotationLimit', 'cascadeDelay'];

      for (const boneName of Object.keys(animConfig)) {
        const bone = animConfig[boneName];
        html += `<div style="color:#adf;font-size:12px;margin:8px 0 2px;font-weight:bold">${boneName}</div>`;

        html += `<div style="margin:2px 0;display:flex;align-items:center;gap:4px;font-size:11px">` +
          `<label style="width:70px;color:#888">axis</label>` +
          `<input type="number" data-anim-bone="${boneName}" data-anim-axis="x" value="${bone.axis.x}" step="0.1" ` +
          `style="width:45px;${INPUT_STYLE}">` +
          `<input type="number" data-anim-bone="${boneName}" data-anim-axis="y" value="${bone.axis.y}" step="0.1" ` +
          `style="width:45px;${INPUT_STYLE}">` +
          `<input type="number" data-anim-bone="${boneName}" data-anim-axis="z" value="${bone.axis.z}" step="0.1" ` +
          `style="width:45px;${INPUT_STYLE}">` +
          `</div>`;

        for (const field of animFields) {
          const val = bone[field] !== undefined ? bone[field] : (field === 'cascadeDelay' ? 0.4 : '');
          if (field === 'cascadeDelay' && bone[field] === undefined && boneName === Object.keys(animConfig)[0]) continue;
          html += `<div style="margin:2px 0;display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:11px">` +
            `<label style="width:70px;color:#888">${field}</label>` +
            `<input type="number" data-anim-bone="${boneName}" data-anim-field="${field}" value="${val}" step="any" ` +
            `style="width:80px;${INPUT_STYLE}">` +
            `</div>`;
        }

        if (bone.phaseOffset !== undefined) {
          html += `<div style="margin:2px 0;display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:11px">` +
            `<label style="width:70px;color:#888">phaseOffset</label>` +
            `<input type="number" data-anim-bone="${boneName}" data-anim-field="phaseOffset" value="${bone.phaseOffset.toFixed(4)}" step="0.1" ` +
            `style="width:80px;${INPUT_STYLE}">` +
            `</div>`;
        }
      }
    }

    // Buttons
    html += `<div style="margin-top:14px;display:flex;gap:8px">` +
      `<button id="editor-save-btn" style="flex:1;padding:7px;background:rgba(40,120,80,0.8);border:1px solid rgba(80,200,120,0.5);` +
      `color:#fff;border-radius:4px;cursor:pointer;font:13px monospace">Save</button>` +
      `<button id="editor-export-btn" style="flex:1;padding:7px;background:rgba(40,70,120,0.8);border:1px solid rgba(80,130,200,0.5);` +
      `color:#fff;border-radius:4px;cursor:pointer;font:13px monospace">Export</button>` +
      `</div>`;

    panel.innerHTML = html;
    panel.style.display = 'block';

    // Wire up color picker sync
    const colorPicker = panel.querySelector('input[data-color-field]');
    const colorHex = panel.querySelector('input[data-color-hex]');
    if (colorPicker && colorHex) {
      colorPicker.addEventListener('input', () => { colorHex.value = colorPicker.value; });
      colorHex.addEventListener('change', () => {
        if (/^#[0-9a-f]{6}$/i.test(colorHex.value)) colorPicker.value = colorHex.value;
      });
    }

    document.getElementById('editor-save-btn').addEventListener('click', () => {
      this._applyProperties(type);
    });

    document.getElementById('editor-export-btn').addEventListener('click', () => {
      this._exportConfig();
    });
  }

  _applyProperties(type) {
    const cfg = getConfigForType(type);
    const panel = document.getElementById('editor-props');
    if (!panel || !cfg) return;

    const inputs = panel.querySelectorAll('input[data-field]');
    for (const input of inputs) {
      const field = input.dataset.field;
      if (input.type === 'checkbox') {
        cfg[field] = input.checked;
      } else {
        const val = parseFloat(input.value);
        if (!isNaN(val)) {
          cfg[field] = val;

          if (type === 'kelp' && field === 'kelpScale') CONFIG.kelpScale = val;
          if (type === 'kelp' && field === 'collisionRadius') CONFIG.plant.collisionRadius = val;
          if (type === 'food' && field === 'foodScale') CONFIG.foodScale = val;
          if (type === 'poo' && field === 'seedScale') CONFIG.seedScale = val;
        }
      }
    }

    // Apply color
    const colorInput = panel.querySelector('input[data-color-field]');
    if (colorInput) {
      const hex = parseInt(colorInput.value.replace('#', ''), 16);
      if (type === 'food') CONFIG.foodColor = hex;
      else if (type === 'poo') CONFIG.seedColor = hex;
      else if (CONFIG.creatures[type]) CONFIG.creatures[type].color = hex;

      if (this.selectedIndex >= 0) {
        const mesh = this.spawnedMeshes[this.selectedIndex];
        if (mesh) {
          mesh.traverse(child => {
            if (child.isMesh && child.material && child.material.color) {
              child.material.color.setHex(hex);
            }
          });
        }
      }
    }

    // Update mesh scale
    if (this.selectedIndex >= 0) {
      const mesh = this.spawnedMeshes[this.selectedIndex];
      const newScale = getRuntimeScale(type);
      if (mesh) mesh.scale.setScalar(newScale);
    }

    // Apply animation config changes and rebuild controllers live
    const animConfig = CREATURE_ANIM_CONFIGS[type];
    if (animConfig && this.selectedIndex >= 0) {
      const axisInputs = panel.querySelectorAll('input[data-anim-axis]');
      for (const input of axisInputs) {
        const boneName = input.dataset.animBone;
        const axisComp = input.dataset.animAxis;
        const val = parseFloat(input.value);
        if (!isNaN(val) && animConfig[boneName]) {
          animConfig[boneName].axis[axisComp] = val;
        }
      }

      const animInputs = panel.querySelectorAll('input[data-anim-field]');
      for (const input of animInputs) {
        const boneName = input.dataset.animBone;
        const field = input.dataset.animField;
        const val = parseFloat(input.value);
        if (!isNaN(val) && animConfig[boneName]) {
          animConfig[boneName][field] = val;
        }
      }

      // Swim shader params are live via uniforms — no rebuild needed.
      // (The old bone-based system needed teardown/rebuild here.)
    }

    this._rebuildDebugVisuals();

    // Editor: properties saved for type

    const btn = document.getElementById('editor-save-btn');
    if (btn) {
      btn.textContent = 'Saved!';
      btn.style.background = 'rgba(40,180,80,0.9)';
      setTimeout(() => {
        btn.textContent = 'Save';
        btn.style.background = 'rgba(40,120,80,0.8)';
      }, 1000);
    }
  }

  _exportConfig() {
    const animExport = {};
    for (const [type, bones] of Object.entries(CREATURE_ANIM_CONFIGS)) {
      animExport[type] = {};
      for (const [boneName, bone] of Object.entries(bones)) {
        animExport[type][boneName] = {
          axis: { x: bone.axis.x, y: bone.axis.y, z: bone.axis.z },
          frequency: bone.frequency,
          amplitude: bone.amplitude,
          rotationLimit: bone.rotationLimit,
        };
        if (bone.cascadeDelay !== undefined) animExport[type][boneName].cascadeDelay = bone.cascadeDelay;
        if (bone.phaseOffset !== undefined) animExport[type][boneName].phaseOffset = bone.phaseOffset;
      }
    }

    const exportData = { config: CONFIG, animConfigs: animExport };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'polyfish-config.json';
    a.click();
    URL.revokeObjectURL(url);
    // Editor: exported CONFIG + animation as JSON
  }

  _hidePropertiesPanel() {
    const panel = document.getElementById('editor-props');
    if (panel) panel.style.display = 'none';
  }

  // ── UI ─────────────────────────────────────────────────────────

  _showUI() {
    let el = document.getElementById('editor-ui');
    if (!el) {
      el = document.createElement('div');
      el.id = 'editor-ui';
      el.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:10;' +
        'background:rgba(10,25,47,0.9);padding:10px 20px;border-radius:6px;border:1px solid rgba(100,150,200,0.4);' +
        'color:#ccc;font:13px monospace;text-align:center;display:flex;align-items:center;gap:16px;';
      document.body.appendChild(el);
    }
    el.innerHTML =
      `<span>Editor — orbit: drag | zoom: scroll | pan: right-drag</span>` +
      `<label style="display:flex;align-items:center;gap:6px;cursor:pointer">` +
      `<input type="checkbox" id="editor-collider-toggle" checked style="accent-color:#f44">` +
      `<span style="color:#f88;font-size:12px">Colliders</span></label>`;
    el.style.display = 'flex';

    el.querySelector('#editor-collider-toggle').addEventListener('change', (e) => {
      this.showColliders = e.target.checked;
    });
  }

  _hideUI() {
    const el = document.getElementById('editor-ui');
    if (el) el.style.display = 'none';
  }
}
