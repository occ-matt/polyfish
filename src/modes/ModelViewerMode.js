/**
 * ModelViewerMode — inspect individual models with orbit controls.
 * Dropdown to pick model type. Skeleton helper toggle.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneMode } from './SceneMode.js';
import { getModelClone } from '../core/ModelLoader.js';
import { CONFIG } from '../config.js';

// Viewer uses runtime scales from CONFIG (single source of truth)
function getViewerScale(key) {
  if (CONFIG.creatures[key]) return CONFIG.creatures[key].scale;
  if (key === 'kelp') return CONFIG.kelpScale;
  if (key === 'food' || key === 'foodAlt') return CONFIG.foodScale;
  return 1;
}

const MODELS = [
  { key: 'fish',    label: 'Fish' },
  { key: 'dolphin', label: 'Dolphin' },
  { key: 'manatee', label: 'Manatee' },
  { key: 'kelp',    label: 'Kelp' },
  { key: 'food',    label: 'Food' },
  { key: 'foodAlt', label: 'Food Alt' },
  { key: 'logo',    label: 'Logo' },
];

export class ModelViewerMode extends SceneMode {
  constructor() {
    super('model-viewer');
    this.currentModel = null;
    this.skeletonHelper = null;
    this.showSkeleton = false;
    this.currentKey = 'fish';
    this._orbitControls = null;
  }

  async enter(ctx) {
    // Disable FPS camera — viewer uses its own orbit controls
    ctx.cameraController.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();

    // Set up OrbitControls for model inspection
    const orbit = new OrbitControls(ctx.camera, ctx.renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.rotateSpeed = 0.6;
    orbit.zoomSpeed = 1.0;
    orbit.minDistance = 0.5;
    orbit.maxDistance = 40;
    this._orbitControls = orbit;

    // Initial camera position
    orbit.target.set(0, 0, 0);
    ctx.camera.position.set(0, 0, 3);
    orbit.update();

    // Show viewer UI
    this._showUI(ctx);

    // Load initial model
    this._loadModel('fish', ctx);
  }

  async exit(ctx) {
    // Re-enable FPS camera controller
    ctx.cameraController.enabled = true;

    // Dispose orbit controls
    if (this._orbitControls) {
      this._orbitControls.dispose();
      this._orbitControls = null;
    }

    this._removeCurrentModel(ctx);
    this._hideUI();
  }

  update(dt, elapsed, ctx) {
    if (this._orbitControls) this._orbitControls.update();
  }

  handleKeyDown(e, ctx) {
    if (e.key === 's' || e.key === 'S') {
      this.showSkeleton = !this.showSkeleton;
      this._updateSkeletonHelper(ctx);
      return true;
    }
    return false;
  }

  _loadModel(key, ctx) {
    this._removeCurrentModel(ctx);

    const def = MODELS.find(m => m.key === key);
    if (!def) return;

    this.currentKey = key;
    const clone = getModelClone(key);
    if (!clone) {
      console.warn(`[ModelViewer] No model for: ${key}`);
      return;
    }

    // Apply runtime scale from CONFIG
    clone.scale.setScalar(getViewerScale(key));

    clone.visible = true;
    clone.position.set(0, 0, 0);

    // Ensure all child meshes are visible and not frustum-culled
    // (skinned meshes can have stale bounding spheres after clone/rebind)
    clone.traverse(child => {
      child.visible = true;
      if (child.isMesh) {
        child.frustumCulled = false;
      }
    });

    ctx.scene.add(clone);
    clone.updateMatrixWorld(true);
    this.currentModel = clone;


    // Auto-fit camera distance based on bounding box
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (this._orbitControls) {
      this._orbitControls.target.copy(center);
      ctx.camera.position.set(center.x, center.y, center.z + maxDim * 2.5);
      this._orbitControls.update();
    }


    // Update skeleton helper
    if (this.showSkeleton) this._updateSkeletonHelper(ctx);

    // Update dropdown highlight
    const select = document.getElementById('viewer-model-select');
    if (select) select.value = key;
  }

  _removeCurrentModel(ctx) {
    if (this.currentModel) {
      ctx.scene.remove(this.currentModel);
      // NOTE: Do NOT dispose geometry/materials — they are shared by reference
      // with the cached source model in ModelLoader. Disposing would break
      // all future clones and pool meshes.
      this.currentModel = null;
    }
    if (this.skeletonHelper) {
      ctx.scene.remove(this.skeletonHelper);
      this.skeletonHelper = null;
    }
  }

  _updateSkeletonHelper(ctx) {
    if (this.skeletonHelper) {
      ctx.scene.remove(this.skeletonHelper);
      this.skeletonHelper = null;
    }
    if (!this.showSkeleton || !this.currentModel) return;

    this.skeletonHelper = new THREE.SkeletonHelper(this.currentModel);
    ctx.scene.add(this.skeletonHelper);
  }

  _showUI(ctx) {
    let el = document.getElementById('viewer-ui');
    if (!el) {
      el = document.createElement('div');
      el.id = 'viewer-ui';
      el.style.cssText = 'position:fixed;top:60px;left:16px;z-index:10;' +
        'background:rgba(10,25,47,0.9);padding:12px;border-radius:6px;' +
        'border:1px solid rgba(100,150,200,0.4);color:#ccc;font:13px monospace;min-width:160px;';

      el.innerHTML = `
        <div style="color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:8px;">Model Viewer</div>
        <select id="viewer-model-select" style="width:100%;padding:4px;margin-bottom:8px;
          background:#1a2a4a;color:#eee;border:1px solid #446;border-radius:3px;font:13px monospace;">
          ${MODELS.map(m => `<option value="${m.key}">${m.label}</option>`).join('')}
        </select>
        <label style="display:block;margin-top:4px;cursor:pointer;">
          <input type="checkbox" id="viewer-skeleton-toggle"> Show skeleton [S]
        </label>
        <div id="viewer-info" style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.4);"></div>
      `;
      document.body.appendChild(el);

      // Wire up events
      document.getElementById('viewer-model-select').addEventListener('change', (e) => {
        this._loadModel(e.target.value, ctx);
      });
      document.getElementById('viewer-skeleton-toggle').addEventListener('change', (e) => {
        this.showSkeleton = e.target.checked;
        this._updateSkeletonHelper(ctx);
      });
    }
    el.style.display = 'block';

    // Sync state
    const chk = document.getElementById('viewer-skeleton-toggle');
    if (chk) chk.checked = this.showSkeleton;
  }

  _hideUI() {
    const el = document.getElementById('viewer-ui');
    if (el) el.style.display = 'none';
  }
}
