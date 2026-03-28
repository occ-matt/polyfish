/**
 * TitleScreen system
 * Manages the title screen logo, lighting, positioning, and click interactions.
 * Handles transition from title screen to gameplay.
 */
import * as THREE from 'three';

export class TitleScreen {
  constructor() {
    this.active = true;
    this.logoMesh = null;
  }

  /**
   * Set up the title screen with logo model, lighting, and click handlers
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {Object} context - Object containing: getModelClone, applyCaustics, sceneManager, audioManager,
   *                           narrationSystem, cameraController, desktopHints, xrManager, isMobile,
   *                           spawnerSystem, populationMonitor, stageManager, modeManager, feedingInput,
   *                           seedPool
   */
  async setup(scene, camera, context) {
    const {
      getModelClone,
      applyCaustics,
      sceneManager,
      audioManager,
      narrationSystem,
      cameraController,
      desktopHints,
      xrManager,
      isMobile,
      buildModeContext,
      stageManager,
      modeManager,
      feedingInput,
      seedPool,
    } = context;

    // Place the logo model in the scene, in front of the camera
    const clone = getModelClone('logo');
    if (clone) {
      this.logoMesh = clone;
      this.logoMesh.scale.setScalar(60);

      // Color the logo to match PolyFish  -  sample vertex colors from the fish model
      const fishSource = getModelClone('fish');
      let fishColor = null;
      if (fishSource) {
        fishSource.traverse(child => {
          if (!fishColor && child.isMesh && child.geometry.attributes.color) {
            const colorAttr = child.geometry.attributes.color;
            // Sample the dominant vertex color (middle of the body)
            const idx = Math.floor(colorAttr.count * 0.5);
            fishColor = new THREE.Color(colorAttr.getX(idx), colorAttr.getY(idx), colorAttr.getZ(idx));
          }
        });
      }
      if (fishColor) {
        this.logoMesh.traverse(child => {
          if (child.isMesh && child.material) {
            child.material = child.material.clone();
            child.material.color.copy(fishColor);
            // Subtle warm emission - just enough to keep it readable in shadow,
            // but low enough that the spotlight defines the 3D form
            child.material.emissive = fishColor.clone();
            child.material.emissiveIntensity = 0.35;
            // Shinier material - lets the spotlight create specular highlights
            child.material.roughness = 0.40;
            child.material.metalness = 0.40;
            child.material.envMapIntensity = 1.8;
          }
        });
      }

      // Apply underwater caustics to logo
      // Pre-enable transparency so the shader recompile happens during load,
      // not during the start transition (which would cause a visible hitch).
      this.logoMesh.traverse(child => {
        if (child.isMesh && child.material) {
          applyCaustics(child.material, 4.0);
          child.material.transparent = true;
          child.material.opacity = 1.0;
        }
      });

      scene.add(this.logoMesh);

      // ── Dedicated logo lighting ──────────────────────────────────
      // Warm key light from upper-front - defines 3D form with highlights & shadows
      const logoKeyLight = new THREE.SpotLight(0xffd890, 14.0, 35, Math.PI / 3, 0.4, 0.8);
      logoKeyLight.position.set(-2, 8, 10);   // slightly left, above, in front
      logoKeyLight.target = this.logoMesh;
      scene.add(logoKeyLight);
      scene.add(logoKeyLight.target);

      // Cool rim/back light from upper-right - edge separation from background
      const logoRimLight = new THREE.PointLight(0x99ccff, 4.0, 20, 1.5);
      logoRimLight.position.set(6, 5, -3);   // behind and right
      scene.add(logoRimLight);

      // Store light refs so we can remove them when logo fades out
      this.logoMesh._keyLight = logoKeyLight;
      this.logoMesh._rimLight = logoRimLight;
    }

    // Raycast down to find terrain height at camera XZ position
    const camX = 0, camZ = 6.44;
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(camX, 50, camZ),
      new THREE.Vector3(0, -1, 0)
    );
    // Only intersect Mesh objects (skip Sprites which need raycaster.camera)
    const meshes = [];
    scene.traverse(child => { if (child.isMesh) meshes.push(child); });
    const hits = raycaster.intersectObjects(meshes, false);
    const terrainY = hits.length > 0 ? hits[0].point.y : -7.81;
    const eyeHeight = 0.5;

    camera.position.set(camX, terrainY + eyeHeight, camZ);

    if (this.logoMesh) {
      // Position logo in front of camera - push back on portrait/vertical displays
      // so it fits within the narrower horizontal FOV
      const aspect = window.innerWidth / window.innerHeight;
      const logoZ = aspect < 1.0 ? -5 : (aspect < 1.4 ? -3 : -1);
      this.logoMesh.position.set(0, terrainY + eyeHeight + 3.0, logoZ);
      this.logoMesh.rotation.x = -0.15; // tilt slightly upward to catch more light

      // Adjust on resize (e.g. rotating phone, resizing desktop window)
      const onResize = () => {
        if (!this.logoMesh) return;
        const a = window.innerWidth / window.innerHeight;
        const z = a < 1.0 ? -5 : (a < 1.4 ? -3 : -1);
        this.logoMesh.position.z = z;
      };
      window.addEventListener('resize', onResize);
      // Clean up listener when logo is removed (store ref for later)
      this.logoMesh._resizeHandler = onResize;
    }

    // Set up click handlers for title screen buttons
    const titleEl = document.getElementById('title-screen');
    if (titleEl) {
      titleEl.querySelectorAll('.title-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // prevent bubbling to title overlay
          const withNarration = btn.dataset.narration === 'true';
          this.handleClick(withNarration, context);
        }, { once: true });
      });
    }
  }

  /**
   * Handle title screen click - start the simulation and transition to gameplay
   * @param {boolean} withNarration - Whether to play narration
   * @param {Object} context - Object containing all dependencies
   * @param {Object} [options] - { skipFade: boolean } - skip the logo fade (VR entry)
   */
  async handleClick(withNarration = false, context, options = {}) {
    if (!this.active) return;
    this.active = false;

    const {
      sceneManager,
      audioManager,
      narrationSystem,
      cameraController,
      desktopHints,
      xrManager,
      isMobile,
      spawnerSystem: SpawnerSystem,
      populationMonitor,
      stageManager,
      modeManager,
      feedingInput,
      seedPool,
      buildModeContext,
      updateModeUIVisibility,
    } = context;

    const titleEl = document.getElementById('title-screen');
    const scene = sceneManager.getScene();
    this._scene = scene; // store for showLogo re-add
    const camera = sceneManager.getCamera();
    const renderer = sceneManager.getRenderer();

    // Request pointer lock immediately - must happen in the same user gesture
    // call stack (before any awaits) or browsers will reject it.
    if (!isMobile && renderer?.domElement) {
      renderer.domElement.requestPointerLock?.();
    }

    // ── 1. Start the simulation IMMEDIATELY (before any awaits) ──
    // This is critical for VR: the sim must be live on the very next frame.
    // Keep this block minimal to avoid a hitch on the click frame.
    narrationSystem.reset();
    if (withNarration) narrationSystem.start();
    const newSpawnerSystem = new SpawnerSystem();
    populationMonitor.reset();
    stageManager.stageTimer = 0;
    stageManager.stageRunning = true;
    stageManager.stageEvents?.forEach(e => e.fired = false);
    const modeContext = buildModeContext();

    // Tell mode manager we're in narrative (without calling enter, which would restartEcosystem)
    const narrativeMode = modeManager.modes.get('narrative');
    narrativeMode.active = true;
    modeManager.currentMode = narrativeMode;

    // Start music + ambience + UI click SFX
    audioManager.playSFXVariant('uiStart');
    audioManager.restartMusic();
    audioManager.startAmbience();

    // Initialize desktop hints early (before awaits) so showFeedPrompt works at T+1s
    if (!cameraController.isMobile && !stageManager.desktopHints) {
      stageManager.desktopHints = new desktopHints({ cameraController, feedingInput });
    }

    // Store camera start position for VR rig
    if (xrManager) {
      xrManager._startPos = camera.position.clone();
      xrManager._startPos.y -= cameraController.eyeHeight;
    }

    // Drop the seed from just above the camera's view
    const seedPos = new THREE.Vector3(0, camera.position.y + 3, -2);
    const seed = seedPool.get();
    if (seed) {
      seed.activate(seedPos);
      seed.forceGerminate = true;
    }

    // Sim started - narrative mode active, seed dropped.

    // ── 2. Visual cleanup (async - sim is already running) ──
    performance.mark('title-fade-start');
    if (titleEl) {
      titleEl.style.opacity = '0';
      titleEl.style.pointerEvents = 'none';
    }

    // Fade out the logo model in-world (smooth opacity fade).
    // In VR mode (skipFade), remove immediately - the window.requestAnimationFrame
    // used by the fade loop may not sync with the XR render loop on Quest.
    if (this.logoMesh) {
      if (options.skipFade) {
        // VR: hide immediately via visible=false (prevents rendering entirely).
        // Setting opacity alone still draws the mesh. visible=false skips it.
        this.logoMesh.visible = false;
        // Also set opacity to 0 on all child meshes as belt-and-suspenders
        this.logoMesh.traverse(child => {
          if (child.isMesh && child.material) child.material.opacity = 0;
        });
        if (this.logoMesh._keyLight) this.logoMesh._keyLight.intensity = 0;
        if (this.logoMesh._rimLight) this.logoMesh._rimLight.intensity = 0;
        // Remove from scene entirely after a brief delay (safe cleanup)
        const _logoRef = this.logoMesh;
        const _scene = scene;
        setTimeout(() => {
          if (_logoRef.parent) _logoRef.parent.remove(_logoRef);
          if (_logoRef._keyLight?.parent) _logoRef._keyLight.parent.remove(_logoRef._keyLight);
          if (_logoRef._rimLight?.parent) _logoRef._rimLight.parent.remove(_logoRef._rimLight);
          // Logo removed from scene (VR)
        }, 500);
      } else {
        // Desktop/mobile: smooth 1.5s fade
        // Transparency was pre-enabled during setup to avoid a shader recompile hitch here.
        const duration = 1500;
        const startTime = performance.now();
        const _logoRef = this.logoMesh;
        const _keyIntensity = _logoRef._keyLight ? _logoRef._keyLight.intensity : 0;
        const _rimIntensity = _logoRef._rimLight ? _logoRef._rimLight.intensity : 0;

        // Pre-collect mesh children once instead of traversing every frame
        const _logoMeshes = [];
        _logoRef.traverse(child => {
          if (child.isMesh && child.material) _logoMeshes.push(child);
        });

        await new Promise(resolve => {
          const animateLogo = () => {
            const t = Math.min((performance.now() - startTime) / duration, 1);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const opacity = 1 - ease;
            for (let i = 0; i < _logoMeshes.length; i++) {
              _logoMeshes[i].material.opacity = opacity;
            }
            if (_logoRef._keyLight) _logoRef._keyLight.intensity = _keyIntensity * opacity;
            if (_logoRef._rimLight) _logoRef._rimLight.intensity = _rimIntensity * opacity;
            if (t < 1) {
              requestAnimationFrame(animateLogo);
            } else {
              resolve();
            }
          };
          animateLogo();
        });
      }
      performance.mark('title-fade-end');
      performance.measure('logo-fade', 'title-fade-start', 'title-fade-end');
    }

    // ── 3. Post-fade cleanup ──
    // Spread heavy work across frames to avoid a single long-frame hitch.
    // Each await yields to the browser so the render loop gets a
    // frame between DOM mutations and GPU resource releases.

    // Frame 1: remove title overlay DOM (triggers reflow)
    performance.mark('title-cleanup-start');
    if (xrManager && xrManager._vrButton && titleEl && titleEl.contains(xrManager._vrButton)) {
      xrManager._vrButton.style.display = 'none';
      document.body.appendChild(xrManager._vrButton);
    }
    if (titleEl) titleEl.remove();
    updateModeUIVisibility();
    performance.mark('title-dom-removed');
    performance.measure('title-dom-cleanup', 'title-cleanup-start', 'title-dom-removed');

    // Yield a frame so the DOM reflow settles before GPU work
    await new Promise(r => requestAnimationFrame(r));

    // Frame 2: remove logo mesh from scene.
    // IMPORTANT: Do NOT remove the SpotLight or PointLight from the scene.
    // Changing the light count forces Three.js to recompile every material's
    // shader program on the next render, which causes an ~800ms stall.
    // Instead, leave the lights in the scene at intensity 0 (already faded)
    // - zero-intensity lights have negligible GPU cost.
    if (this.logoMesh) {
      const _logoRef = this.logoMesh;
      if (_logoRef._resizeHandler) {
        window.removeEventListener('resize', _logoRef._resizeHandler);
        _logoRef._resizeHandler = null;
      }
      // Lights stay in scene at intensity 0 - no shader recompile
      if (_logoRef._keyLight) {
        _logoRef._keyLight.intensity = 0;
        // Detach target from logo so the light doesn't follow a removed object
        _logoRef._keyLight.target.position.set(0, 0, 0);
      }
      if (_logoRef._rimLight) _logoRef._rimLight.intensity = 0;
      _logoRef.visible = false;
      // Keep logoMesh ref alive for showLogo/hideLogo API (screenshots, etc.)
      // The mesh stays in the scene graph but invisible, zero GPU cost.
      this._logoScene = scene;
    }
    performance.mark('title-gpu-cleanup');
    performance.measure('logo-gpu-cleanup', 'title-dom-removed', 'title-gpu-cleanup');

    // Yield another frame so the GPU flush from scene.remove() is absorbed
    await new Promise(r => requestAnimationFrame(r));

    // Frame 3: create mobile controls (DOM insertion + style calc)
    if (cameraController.joystick) {
      cameraController.joystick.show();
      cameraController.createGyroButton();
      cameraController.createCinemaButton(feedingInput);
      feedingInput.showMobileButton();
    }
    performance.mark('title-mobile-ui');
    performance.measure('mobile-ui-create', 'title-gpu-cleanup', 'title-mobile-ui');

    // Show HUD with a gentle delay
    await new Promise(r => setTimeout(r, 800));
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = '';
    const hudElement = document.getElementById('hud-population');
    if (hudElement) hudElement.classList.add('hud-hidden');
    performance.mark('title-transition-done');
    performance.measure('title-full-transition', 'title-fade-start', 'title-transition-done');
    // Title transition timings available via Performance API if needed
  }

  /**
   * Show the 3D logo in the scene (for screenshots, videos, etc.).
   * The logo remains at its original position and lighting is restored.
   */
  showLogo() {
    if (!this.logoMesh) return;
    // Re-add to scene if previously removed (VR cleanup)
    if (!this.logoMesh.parent && this._scene) {
      this._scene.add(this.logoMesh);
      if (this.logoMesh._keyLight) this._scene.add(this.logoMesh._keyLight);
      if (this.logoMesh._rimLight) this._scene.add(this.logoMesh._rimLight);
    }
    this.logoMesh.visible = true;
    this.logoMesh.traverse(child => {
      if (child.isMesh && child.material) child.material.opacity = 1.0;
    });
    if (this.logoMesh._keyLight) this.logoMesh._keyLight.intensity = 14.0;
    if (this.logoMesh._rimLight) this.logoMesh._rimLight.intensity = 4.0;
  }

  /**
   * Hide the 3D logo from the scene.
   */
  hideLogo() {
    if (!this.logoMesh) return;
    this.logoMesh.visible = false;
    this.logoMesh.traverse(child => {
      if (child.isMesh && child.material) child.material.opacity = 0;
    });
    if (this.logoMesh._keyLight) this.logoMesh._keyLight.intensity = 0;
    if (this.logoMesh._rimLight) this.logoMesh._rimLight.intensity = 0;
  }
}
