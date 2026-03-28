// ── 3D Creature Viewers Demo ──
// Three.js viewers for fish, dolphin, and manatee with swim animation

const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const GLTFLOADER_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
const ORBITCONTROLS_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

let GLTFLoader;
let OrbitControls;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Skip if already loaded
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
  if (GLTFLoader && OrbitControls) return;

  // Load THREE globally first (needed by GLTFLoader and OrbitControls)
  if (!window.THREE) {
    await loadScript(THREE_CDN);
  }

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

// Swim configs pulled from the game
const SWIM_CONFIGS = {
  fish: {
    frequency: 1.5, maskStart: 0.4, maskFloor: 0.15, headPhase: 0.5, swimAxis: 0,
    modes: {
      idle:   { amplitude: 0.014,  speed: 5.34,  label: 'Idle'   },
      thrust: { amplitude: 0.0022, speed: 18.85, label: 'Thrust' },
      coast:  { amplitude: 0.0,    speed: 0.0,   label: 'Coast'  }
    }
  },
  dolphin: {
    frequency: 1.2, maskStart: 0.25, maskFloor: 0.1, headPhase: 0.4, swimAxis: 1,
    modes: {
      idle:   { amplitude: 0.01,  speed: 4.0,  label: 'Idle'   },
      thrust: { amplitude: 0.002, speed: 15.0, label: 'Thrust' },
      coast:  { amplitude: 0.0,   speed: 0.0,  label: 'Coast'  }
    }
  },
  manatee: {
    frequency: 1.0, maskStart: 0.3, maskFloor: 0.1, headPhase: 0.3, swimAxis: 1,
    modes: {
      idle:   { amplitude: 0.01,  speed: 3.0,  label: 'Idle'   },
      thrust: { amplitude: 0.002, speed: 10.0, label: 'Thrust' },
      coast:  { amplitude: 0.0,   speed: 0.0,  label: 'Coast'  }
    }
  }
};

async function createCreatureViewer(container, creatureType) {
  await loadThreeLibraries();

  const canvas = document.createElement('canvas');
  const spec = SWIM_CONFIGS[creatureType];
  let currentMode = 'idle';

  const scene = new window.THREE.Scene();
  scene.background = new window.THREE.Color(0x0a1628);
  scene.fog = new window.THREE.Fog(0x0a1628, 15, 40);

  // Lighting: match the game's underwater scene
  const ambient = new window.THREE.AmbientLight(0x233943, 2.5);
  scene.add(ambient);
  const sun = new window.THREE.DirectionalLight(0xaaccff, 2.5);
  sun.position.set(50, 100, 50);
  scene.add(sun);
  const hemi = new window.THREE.HemisphereLight(0x3366aa, 0x443320, 0.6);
  scene.add(hemi);

  const camera = new window.THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const renderer = new window.THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Append canvas to container BEFORE calling resize so it has layout dimensions
  container.appendChild(canvas);

  function resize() {
    const w = canvas.clientWidth || container.clientWidth || 400;
    const h = canvas.clientHeight || 300;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const gltfLoader = new GLTFLoader();
  let orbitRadius = 2.5;
  const lookTarget = new window.THREE.Vector3(0, 0, 0);
  const swimMeshes = [];

  const modelPath = creatureType + '_rigged.glb';
  const tryPaths = ['/models/' + modelPath, '/dist/models/' + modelPath];

  function tryLoad(idx) {
    if (idx >= tryPaths.length) {
      console.error('Failed to load model: ' + creatureType);
      return;
    }
    gltfLoader.load(tryPaths[idx], (gltf) => {
      const model = gltf.scene;

      // Fix orientation: Blender-to-glTF has creatures pointing along +Y
      model.rotation.x = -Math.PI / 2;
      scene.add(model);

      // Compute bounding box AFTER rotation
      model.updateMatrixWorld(true);
      const box = new window.THREE.Box3().setFromObject(model);
      const size = new window.THREE.Vector3();
      box.getSize(size);

      // Scale model so longest axis fills ~1.8 units
      const maxDim = Math.max(size.x, size.y, size.z);
      const desiredSize = 1.8;
      const s = desiredSize / maxDim;
      model.scale.setScalar(s);

      // Recompute bounds after scaling, center at origin
      model.updateMatrixWorld(true);
      const box2 = new window.THREE.Box3().setFromObject(model);
      const center2 = new window.THREE.Vector3();
      box2.getCenter(center2);
      model.position.sub(center2);

      orbitRadius = desiredSize * 1.6;

      // Apply materials and gather vertex data for swim animation
      model.traverse((child) => {
        if (child.isMesh && child.material) {
          const geo = child.geometry;
          const hasVC = geo.attributes.color != null;

          child.material = new window.THREE.MeshStandardMaterial({
            vertexColors: hasVC,
            flatShading: true,
            roughness: 0.85,
            metalness: 0.05,
            envMapIntensity: 1.2,
            side: window.THREE.DoubleSide,
            color: hasVC ? 0xffffff : child.material.color
          });

          // Store original positions for JS-based swim displacement
          const posAttr = geo.attributes.position;
          const origPositions = new Float32Array(posAttr.array.length);
          origPositions.set(posAttr.array);

          // Compute local Z bounds
          geo.computeBoundingBox();
          const bb = geo.boundingBox;
          const zMin = bb.min.z;
          const zRange = (bb.max.z - bb.min.z) || 1;

          swimMeshes.push({ posAttr, origPositions, zMin, zRange });
        }
      });
    }, undefined, () => { console.warn('Model load failed for ' + creatureType + ' at path: ' + tryPaths[idx]); tryLoad(idx + 1); });
  }
  tryLoad(0);

  // Build mode toggle buttons
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'demo-controls';
  Object.keys(spec.modes).forEach(modeKey => {
    const btn = document.createElement('button');
    btn.textContent = spec.modes[modeKey].label;
    btn.className = modeKey === 'idle' ? 'creature-mode-btn active' : 'creature-mode-btn';
    btn.addEventListener('click', () => {
      currentMode = modeKey;
      controlsDiv.querySelectorAll('.creature-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    controlsDiv.appendChild(btn);
  });

  container.appendChild(controlsDiv);

  // Accumulated phase
  let phase = 0;
  let lastTime = Date.now() * 0.001;
  let rot = 0;
  let liveAmplitude = spec.modes.idle.amplitude;
  let liveSpeed = spec.modes.idle.speed;

  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now() * 0.001;
    const dt = Math.min(now - lastTime, 0.05);
    lastTime = now;

    // Smooth lerp toward target mode values
    const targetAmp = spec.modes[currentMode].amplitude;
    const targetSpd = spec.modes[currentMode].speed;
    const lerpRate = 1 - Math.pow(0.04, dt);
    liveAmplitude += (targetAmp - liveAmplitude) * lerpRate;
    liveSpeed += (targetSpd - liveSpeed) * lerpRate;

    // Accumulate phase
    phase += liveSpeed * dt;

    rot += 0.004;
    camera.position.x = Math.sin(rot) * orbitRadius;
    camera.position.z = Math.cos(rot) * orbitRadius;
    camera.position.y = orbitRadius * 0.35;
    camera.lookAt(lookTarget);

    // JS vertex displacement - matches SwimMaterial.js logic
    const dispIdx = spec.swimAxis < 0.5 ? 0 : 1;
    for (let m = 0; m < swimMeshes.length; m++) {
      const sm = swimMeshes[m];
      const arr = sm.posAttr.array;
      const orig = sm.origPositions;

      for (let i = 0; i < sm.posAttr.count; i++) {
        const ix = i * 3;
        const z = orig[ix + 2];
        const bodyRange = sm.zRange;

        // Body coordinate: 0 = head, 1 = tail (inverted, matches game)
        const body = bodyRange > 0.001
          ? Math.max(0, Math.min(1, 1.0 - (z - sm.zMin) / bodyRange))
          : 0.5;

        // Head region samples wave at maskStart (rigid head)
        const waveBody = Math.max(body, spec.maskStart);

        // Amplitude ramp with head weighting
        const rampRaw = (body - spec.maskStart) / 0.3;
        const ramp = Math.max(0, Math.min(1, rampRaw));

        // Eye lateral weight
        const lateralIdx = spec.swimAxis < 0.5 ? 1 : 0;
        const lateralOffset = Math.abs(orig[ix + lateralIdx]) / (bodyRange * 0.5 + 0.001);
        const eyeWeight = Math.max(0, Math.min(1, lateralOffset * 3.0));
        const headAmp = spec.maskFloor * eyeWeight;
        const amp = headAmp + (1.0 - headAmp) * ramp;

        // Phase: spatial from body, temporal from accumulated phase
        const headDelay = (1.0 - ramp) * spec.headPhase;
        const wavePhase = waveBody * spec.frequency * 6.2832 - phase + headDelay;
        const wave = Math.sin(wavePhase) * liveAmplitude * amp;

        // Copy original + apply displacement
        arr[ix]     = orig[ix];
        arr[ix + 1] = orig[ix + 1];
        arr[ix + 2] = orig[ix + 2];
        arr[ix + dispIdx] += wave;
      }
      sm.posAttr.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }
  animate();
}

export async function init(container) {
  // Create three separate demo containers for fish, dolphin, manatee with their cards
  const creatureData = [
    {
      type: 'fish',
      title: 'Fish (Herbivore)',
      axisText: 'Side-to-side swim (X-axis)',
      description: 'Fish are the primary prey. They spawn as schools and roam the seabed foraging for kelp particles and food pellets. Each fish has a small turning radius and low top speed - they\'re nimble and can dodge quickly, but they can\'t outrun a determined predator. Their AI updates every frame, so they react instantly to nearby threats. When a dolphin enters their flee radius (1.5 units), they immediately reverse and scatter.'
    },
    {
      type: 'dolphin',
      title: 'Dolphin (Apex Predator)',
      axisText: 'Vertical swim (Y-axis)',
      description: 'Dolphins are the ecosystem\'s intelligence. They hunt fish actively, use echolocation-like raycasts to search, and surface periodically to breathe. Their AI updates at the same per-frame rate as fish, so they react head-on to prey movement, and their velocity is significantly higher (10x thrust multiplier). When hunting, they can sprint at 3.5x normal speed, momentarily overwhelming fish defenses. Dolphins must manage an oxygen tank (60s capacity) that depletes while submerged and refills at the surface.'
    },
    {
      type: 'manatee',
      title: 'Manatee (Grazer)',
      axisText: 'Slow vertical swim (Y-axis)',
      description: 'Manatees are peaceful, slow grazers. They browse seagrass beds and never hunt. With a lower top speed (6.69x thrust multiplier vs. dolphin\'s 10x) and a heavier mass (3.5 vs 2.0), they\'re more passive and deliberate. Manatees don\'t flee from dolphins - they\'re too large - but they do avoid direct collision through simple steering.'
    }
  ];

  for (const creature of creatureData) {
    const heading = document.createElement('h3');
    heading.textContent = creature.title;
    container.appendChild(heading);

    const card = document.createElement('div');
    card.className = 'creature-card';

    const demoContainer = document.createElement('div');
    demoContainer.className = 'demo-container';

    const label = document.createElement('div');
    label.className = 'demo-label';
    label.textContent = creature.axisText;

    demoContainer.appendChild(label);

    const creatureText = document.createElement('div');
    creatureText.className = 'creature-text';
    const para = document.createElement('p');
    para.textContent = creature.description;
    creatureText.appendChild(para);

    card.appendChild(demoContainer);
    card.appendChild(creatureText);

    container.appendChild(card);

    await createCreatureViewer(demoContainer, creature.type);
  }
}
