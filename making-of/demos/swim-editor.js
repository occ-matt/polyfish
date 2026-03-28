// ── Swim Animation Editor Demo ──
// Three.js 3D viewer with vertex displacement animation control

const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const GLTFLOADER_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
const ORBITCONTROLS_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

let THREE;
let GLTFLoader;
let OrbitControls;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadThreeLibraries() {
  if (THREE && GLTFLoader && OrbitControls) return;

  // Load THREE globally first (needed by GLTFLoader and OrbitControls)
  if (!window.THREE) {
    await loadScript(THREE_CDN);
  }
  THREE = window.THREE;

  // Load GLTFLoader via script tag
  if (!window.THREE.GLTFLoader) {
    await loadScript(GLTFLOADER_CDN);
  }
  GLTFLoader = window.THREE.GLTFLoader;

  // Load OrbitControls via script tag
  if (!window.THREE.OrbitControls) {
    await loadScript(ORBITCONTROLS_CDN);
  }
  OrbitControls = window.THREE.OrbitControls;
}

export async function init(container) {
  await loadThreeLibraries();

  const wrapper = document.createElement('div');
  wrapper.id = 'swim-editor-wrapper';
  wrapper.style.cssText = 'display: flex; height: 500px; gap: 15px;';

  const sidebar = document.createElement('div');
  sidebar.id = 'swim-editor-sidebar';
  sidebar.style.cssText = 'width: 220px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 6px; overflow-y: auto;';
  sidebar.innerHTML = `
    <div class="swim-editor-section">
      <div class="swim-editor-label">Species</div>
      <select id="swim-model-select">
        <option value="fish">Fish (X-axis)</option>
        <option value="dolphin">Dolphin (Y-axis)</option>
        <option value="manatee">Manatee (Y-axis)</option>
      </select>
    </div>

    <div class="swim-editor-section">
      <div class="swim-editor-label">Wave Parameters</div>

      <div class="swim-slider-row">
        <span class="swim-slider-label">Frequency</span>
        <input type="range" id="swim-freq" min="0.3" max="4" step="0.1" value="1.5">
        <span class="swim-slider-val" id="swim-freq-val">1.50</span>
      </div>
      <div class="swim-slider-row">
        <span class="swim-slider-label">Amplitude</span>
        <input type="range" id="swim-amp" min="0" max="0.05" step="0.001" value="0.014">
        <span class="swim-slider-val" id="swim-amp-val">0.014</span>
      </div>
      <div class="swim-slider-row">
        <span class="swim-slider-label">Speed</span>
        <input type="range" id="swim-speed" min="0" max="20" step="0.1" value="5.34">
        <span class="swim-slider-val" id="swim-speed-val">5.34</span>
      </div>
      <div class="swim-slider-row">
        <span class="swim-slider-label">Eye Mask</span>
        <input type="range" id="swim-mask" min="0" max="0.8" step="0.02" value="0.40">
        <span class="swim-slider-val" id="swim-mask-val">0.40</span>
      </div>
      <div class="swim-slider-row">
        <span class="swim-slider-label">Head Phase</span>
        <input type="range" id="swim-headphase" min="0" max="1.5" step="0.05" value="0.50">
        <span class="swim-slider-val" id="swim-headphase-val">0.50</span>
      </div>
    </div>

    <div class="swim-editor-section">
      <div class="swim-editor-label">Presets</div>
      <button id="swim-preset-fish">Fish Defaults</button>
      <button id="swim-preset-dolphin">Dolphin Defaults</button>
      <button id="swim-preset-manatee">Manatee Defaults</button>
    </div>

    <div class="swim-editor-section">
      <div class="swim-editor-label">Display</div>
      <button id="swim-toggle-wireframe">Toggle Wireframe</button>
      <button id="swim-toggle-orbit">Auto Orbit</button>
    </div>
  `;

  const viewport = document.createElement('div');
  viewport.id = 'swim-editor-viewport';
  viewport.style.cssText = 'flex: 1; position: relative; background: #0a1628;';

  wrapper.appendChild(sidebar);
  wrapper.appendChild(viewport);
  container.appendChild(wrapper);

  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Vertex displacement drives animation - no bones. The sine wave travels along the body while the eye mask keeps the head stable. Try cranking amplitude to 3 to see the wave exaggerated.';
  container.appendChild(label);

  // Initialize the Three.js scene and demo
  initSwimEditor(viewport);
}

function initSwimEditor(viewport) {
  // ── Three.js Scene ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1628);
  scene.fog = new THREE.Fog(0x0a1628, 15, 40);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  viewport.appendChild(renderer.domElement);

  // OrbitControls
  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.05;

  // Lighting
  scene.add(new THREE.AmbientLight(0x233943, 2.5));
  const sun = new THREE.DirectionalLight(0xaaccff, 2.5);
  sun.position.set(50, 100, 50);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x3366aa, 0x443320, 0.6));

  // Grid and Axis helpers
  const gridHelper = new THREE.GridHelper(4, 20, 0x1a2a40, 0x111e30);
  scene.add(gridHelper);
  const axesHelper = new THREE.AxesHelper(1.2);
  scene.add(axesHelper);

  // ── State ──
  const gltfLoader = new GLTFLoader();
  let currentModel = null;
  let swimMeshes = [];
  let orbitRadius = 2.5;
  const lookTarget = new THREE.Vector3(0, 0, 0);
  let phase = 0;
  let lastTime = Date.now() * 0.001;
  let autoOrbitAngle = 0;
  let autoOrbitEnabled = false;
  let currentCreatureType = 'fish';
  let waveLine = null;
  let modelBounds = { min: new THREE.Vector3(), max: new THREE.Vector3(), localZMin: 0, localZRange: 1, bodyAxis: 2 };

  // Species configs
  const SWIM_CONFIGS = {
    fish:    { frequency: 1.5, amplitude: 0.014, speed: 5.34, maskStart: 0.4, maskFloor: 0.15, headPhase: 0.5, swimAxis: 0 },
    dolphin: { frequency: 1.2, amplitude: 0.010, speed: 4.0,  maskStart: 0.25, maskFloor: 0.1, headPhase: 0.4, swimAxis: 1 },
    manatee: { frequency: 1.0, amplitude: 0.010, speed: 3.0,  maskStart: 0.3, maskFloor: 0.1, headPhase: 0.3, swimAxis: 1 },
  };

  // ── Resize ──
  function resize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Model Loading ──
  function loadModel(creatureType) {
    if (currentModel) {
      scene.remove(currentModel);
      currentModel.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }
    swimMeshes = [];
    phase = 0;

    const modelPath = creatureType + '_rigged.glb';
    const tryPaths = ['/models/' + modelPath, '/dist/models/' + modelPath];

    function tryLoad(idx) {
      if (idx >= tryPaths.length) {
        console.error('Failed to load model: ' + creatureType);
        return;
      }
      gltfLoader.load(tryPaths[idx], (gltf) => {
        const model = gltf.scene;

        // Fix orientation
        model.rotation.x = -Math.PI / 2;
        scene.add(model);

        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z);
        const desiredSize = 1.8;
        const s = desiredSize / maxDim;
        model.scale.setScalar(s);

        model.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(model);
        const center2 = new THREE.Vector3();
        box2.getCenter(center2);
        model.position.sub(center2);
        lookTarget.set(0, 0, 0);

        orbitRadius = desiredSize * 1.6;
        camera.position.set(orbitRadius * 0.9, orbitRadius * 0.4, orbitRadius * 1.2);
        orbitControls.target.copy(lookTarget);

        // Apply materials and gather vertex data
        model.traverse((child) => {
          if (child.isMesh && child.material) {
            const geo = child.geometry;
            const hasVC = geo.attributes.color != null;

            child.material = new THREE.MeshStandardMaterial({
              vertexColors: hasVC,
              flatShading: true,
              roughness: 0.85,
              metalness: 0.05,
              envMapIntensity: 1.2,
              side: THREE.DoubleSide,
              color: hasVC ? 0xffffff : child.material.color
            });

            const posAttr = geo.attributes.position;
            const origPositions = new Float32Array(posAttr.array.length);
            origPositions.set(posAttr.array);

            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            const zMin = bb.min.z;
            const zRange = (bb.max.z - bb.min.z) || 1;

            swimMeshes.push({ mesh: child, posAttr, origPositions, zMin, zRange });
          }
        });

        currentModel = model;

        // Cache bounds for wave visualization
        model.updateMatrixWorld(true);
        const wBox = new THREE.Box3().setFromObject(model);
        modelBounds.min.copy(wBox.min);
        modelBounds.max.copy(wBox.max);
        const sizes = new THREE.Vector3();
        wBox.getSize(sizes);
        if (sizes.x >= sizes.y && sizes.x >= sizes.z) modelBounds.bodyAxis = 0;
        else if (sizes.y >= sizes.z) modelBounds.bodyAxis = 1;
        else modelBounds.bodyAxis = 2;
        if (swimMeshes.length > 0) {
          modelBounds.localZMin = swimMeshes[0].zMin;
          modelBounds.localZRange = swimMeshes[0].zRange;
        }

        buildWaveLine();
      }, undefined, () => {
        tryLoad(idx + 1);
      });
    }
    tryLoad(0);
  }

  // ── Wave Visualization ──
  const WAVE_SEGMENTS = 80;
  const WAVE_OVERSHOOT = 0;

  function buildWaveLine() {
    if (waveLine) {
      scene.remove(waveLine);
      waveLine.geometry.dispose();
      waveLine.material.dispose();
      waveLine = null;
    }

    const points = [];
    for (let i = 0; i <= WAVE_SEGMENTS; i++) {
      points.push(new THREE.Vector3(0, 0, 0));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, WAVE_SEGMENTS, 0.018, 6, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    waveLine = new THREE.Mesh(tubeGeo, tubeMat);
    waveLine.renderOrder = 999;
    waveLine.frustumCulled = false;
    scene.add(waveLine);
  }

  function updateWaveLine(freq, liveAmplitude, speed, mask, headPhase, spec) {
    if (!waveLine || swimMeshes.length === 0) return;

    const ba = modelBounds.bodyAxis;
    const baMin = ba === 0 ? modelBounds.min.x : ba === 1 ? modelBounds.min.y : modelBounds.min.z;
    const baMax = ba === 0 ? modelBounds.max.x : ba === 1 ? modelBounds.max.y : modelBounds.max.z;
    const baRange = baMax - baMin;
    if (baRange < 0.001) return;

    const localZRange = modelBounds.localZRange;
    let dispAxis = spec.swimAxis < 0.5 ? 0 : 1;
    if (dispAxis === ba) dispAxis = (ba + 1) % 3;

    const points = [];
    const totalLen = baRange * (1 + WAVE_OVERSHOOT);

    for (let i = 0; i <= WAVE_SEGMENTS; i++) {
      const t = i / WAVE_SEGMENTS;
      const bodyPos = baMax - t * totalLen;
      const body = Math.max(0, Math.min(1, (baMax - bodyPos) / baRange));
      const waveBody = Math.max(body, mask);
      const rampRaw = (body - mask) / 0.3;
      const ramp = Math.max(0, Math.min(1, rampRaw));
      const amp = ramp;
      const headDelay = (1.0 - ramp) * headPhase;
      const wavePhase = waveBody * freq * 6.2832 - phase + headDelay;
      const wave = Math.sin(wavePhase) * liveAmplitude * amp;
      const scaleFactor = baRange / (localZRange > 0.001 ? localZRange : 1);
      const visWave = wave * scaleFactor * 1.5;

      const pt = new THREE.Vector3(0, 0, 0);
      if (ba === 0) pt.x = bodyPos; else if (ba === 1) pt.y = bodyPos; else pt.z = bodyPos;
      if (dispAxis === 0) pt.x += visWave; else if (dispAxis === 1) pt.y += visWave; else pt.z += visWave;

      points.push(pt);
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const newGeo = new THREE.TubeGeometry(curve, WAVE_SEGMENTS, 0.018, 6, false);
    waveLine.geometry.dispose();
    waveLine.geometry = newGeo;
  }

  // ── Read slider values ──
  function getFreq() { return parseFloat(document.getElementById('swim-freq').value); }
  function getAmp() { return parseFloat(document.getElementById('swim-amp').value); }
  function getSpeed() { return parseFloat(document.getElementById('swim-speed').value); }
  function getMask() { return parseFloat(document.getElementById('swim-mask').value); }
  function getHeadPhase() { return parseFloat(document.getElementById('swim-headphase').value); }

  function setSlider(id, val) {
    document.getElementById(id).value = val;
    const decimals = id === 'swim-amp' ? 3 : 2;
    document.getElementById(id + '-val').textContent = parseFloat(val).toFixed(decimals);
  }

  function applyPreset(species) {
    const cfg = SWIM_CONFIGS[species];
    setSlider('swim-freq', cfg.frequency);
    setSlider('swim-amp', cfg.amplitude);
    setSlider('swim-speed', cfg.speed);
    setSlider('swim-mask', cfg.maskStart);
    setSlider('swim-headphase', cfg.headPhase);
    document.getElementById('swim-model-select').value = species;
    if (currentCreatureType !== species) {
      currentCreatureType = species;
      loadModel(species);
    }
  }

  // ── Animation Loop ──
  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now() * 0.001;
    const dt = Math.min(now - lastTime, 0.05);
    lastTime = now;

    const freq = getFreq();
    const liveAmplitude = getAmp();
    const speed = getSpeed();
    const mask = getMask();
    const headPhase = getHeadPhase();
    const mode = document.getElementById('swim-model-select').value;

    if (mode !== currentCreatureType) {
      currentCreatureType = mode;
      loadModel(mode);
    }

    const spec = SWIM_CONFIGS[mode];
    phase += speed * dt;

    if (autoOrbitEnabled) {
      autoOrbitAngle += 0.004;
      camera.position.x = Math.sin(autoOrbitAngle) * orbitRadius;
      camera.position.z = Math.cos(autoOrbitAngle) * orbitRadius;
      camera.position.y = orbitRadius * 0.35;
      camera.lookAt(lookTarget);
      orbitControls.target.copy(lookTarget);
      orbitControls.update();
    } else {
      orbitControls.update();
    }

    // Vertex displacement
    const dispIdx = spec.swimAxis < 0.5 ? 0 : 1;
    for (let m = 0; m < swimMeshes.length; m++) {
      const sm = swimMeshes[m];
      const arr = sm.posAttr.array;
      const orig = sm.origPositions;

      for (let i = 0; i < sm.posAttr.count; i++) {
        const ix = i * 3;
        const z = orig[ix + 2];
        const bodyRange = sm.zRange;

        const body = bodyRange > 0.001
          ? Math.max(0, Math.min(1, 1.0 - (z - sm.zMin) / bodyRange))
          : 0.5;

        const waveBody = Math.max(body, mask);
        const rampRaw = (body - mask) / 0.3;
        const ramp = Math.max(0, Math.min(1, rampRaw));

        const lateralIdx = spec.swimAxis < 0.5 ? 1 : 0;
        const lateralOffset = Math.abs(orig[ix + lateralIdx]) / (bodyRange * 0.5 + 0.001);
        const eyeWeight = Math.max(0, Math.min(1, lateralOffset * 3.0));
        const headAmp = spec.maskFloor * eyeWeight;
        const amp = headAmp + (1.0 - headAmp) * ramp;

        const headDelay = (1.0 - ramp) * headPhase;
        const wavePhase = waveBody * freq * 6.2832 - phase + headDelay;
        const wave = Math.sin(wavePhase) * liveAmplitude * amp;

        arr[ix]     = orig[ix];
        arr[ix + 1] = orig[ix + 1];
        arr[ix + 2] = orig[ix + 2];
        arr[ix + dispIdx] += wave;
      }
      sm.posAttr.needsUpdate = true;
    }

    updateWaveLine(freq, liveAmplitude, speed, mask, headPhase, spec);
    renderer.render(scene, camera);
  }

  // ── UI Event Handlers ──
  document.getElementById('swim-model-select').addEventListener('change', (e) => {
    const species = e.target.value;
    if (species !== currentCreatureType) {
      currentCreatureType = species;
      loadModel(species);
      const cfg = SWIM_CONFIGS[species];
      setSlider('swim-freq', cfg.frequency);
      setSlider('swim-amp', cfg.amplitude);
      setSlider('swim-speed', cfg.speed);
      setSlider('swim-mask', cfg.maskStart);
      setSlider('swim-headphase', cfg.headPhase);
    }
  });

  ['swim-freq', 'swim-amp', 'swim-speed', 'swim-mask', 'swim-headphase'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const decimals = id === 'swim-amp' ? 3 : 2;
      document.getElementById(id + '-val').textContent = val.toFixed(decimals);
    });
  });

  document.getElementById('swim-preset-fish').addEventListener('click', () => applyPreset('fish'));
  document.getElementById('swim-preset-dolphin').addEventListener('click', () => applyPreset('dolphin'));
  document.getElementById('swim-preset-manatee').addEventListener('click', () => applyPreset('manatee'));

  document.getElementById('swim-toggle-wireframe').addEventListener('click', () => {
    if (!currentModel) return;
    currentModel.traverse(c => {
      if (c.isMesh && c.material) c.material.wireframe = !c.material.wireframe;
    });
  });

  document.getElementById('swim-toggle-orbit').addEventListener('click', () => {
    autoOrbitEnabled = !autoOrbitEnabled;
    document.getElementById('swim-toggle-orbit').textContent = autoOrbitEnabled ? 'Pause Orbit' : 'Auto Orbit';
  });

  loadModel('fish');
  animate();
}
