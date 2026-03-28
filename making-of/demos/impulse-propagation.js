/**
 * Impulse Propagation Demo
 *
 * Demonstrates how impulses propagate through kelp stalks with a swimming fish.
 * Controls for:
 * - Impulse decay rate
 * - Neighbor spread factor
 * - Impulse strength
 */
import { VerletChain2D } from './VerletChain2D.js';

function setupSlider(sliderId, valueId, callback) {
  const el = document.getElementById(sliderId);
  const valEl = document.getElementById(valueId);
  el.addEventListener('input', () => {
    valEl.textContent = el.value;
    callback(parseFloat(el.value));
  });
  return parseFloat(el.value);
}

export function init(container) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-impulse';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Creature impulse - fish pushes kelp aside as it swims through';
  container.appendChild(label);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Decay <input type="range" id="ctrl-decay" min="0.7" max="0.99" value="0.88" step="0.01"><span id="val-decay">0.88</span></label>
    <label>Spread <input type="range" id="ctrl-spread" min="0" max="0.8" value="0.2" step="0.05"><span id="val-spread">0.2</span></label>
    <label>Strength <input type="range" id="ctrl-str" min="0.1" max="3" value="1.0" step="0.1"><span id="val-str">1.0</span></label>
  `;
  container.appendChild(controls);

  const ctx = canvas.getContext('2d');
  let W, H, dpr;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Rebuild chains
    buildChains();
  }

  const chains = [];

  function buildChains() {
    chains.length = 0;
    const count = 5;
    const spacing = W / (count + 1);
    for (let i = 0; i < count; i++) {
      const x = spacing * (i + 1);
      const c = new VerletChain2D(14, x, H - 35, 22);
      c.impulseDecay = parseFloat(document.getElementById('ctrl-decay').value);
      c.impulseSpread = parseFloat(document.getElementById('ctrl-spread').value);
      c.buoyancy = 0.35 * 40;
      c.inertia = 0.86;
      c.stiffness = 3;
      c.currentAmp = 0.3 * 30;
      c.currentSpeed = 0.1;
      c.currentPhaseSpan = 3.0;
      c.phaseOffset = Math.random() * Math.PI * 2;
      chains.push(c);
    }
  }

  resize();
  window.addEventListener('resize', resize);

  let impulseStrength = 1.0;
  setupSlider('ctrl-decay', 'val-decay', v => chains.forEach(c => c.impulseDecay = v));
  setupSlider('ctrl-spread', 'val-spread', v => chains.forEach(c => c.impulseSpread = v));
  setupSlider('ctrl-str', 'val-str', v => impulseStrength = v);

  // Click to apply impulse
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // Random direction with upward bias
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
    const fx = Math.cos(angle) * 8 * impulseStrength;
    const fy = Math.sin(angle) * 8 * impulseStrength;

    for (const ch of chains) {
      ch.applyImpulseNear(mx, my, fx, fy, 80);
    }

    // Spawn ripple
    ripples.push({ x: mx, y: my, r: 0, alpha: 0.6 });
  });

  const ripples = [];

  const creature = {
    x: W * 0.2,
    y: H * 0.45,
    vx: 120,
    vy: 0,
    width: 18,
    height: 8
  };

  let last = 0;
  function draw(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const t = now * 0.001;

    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a1628');
    grad.addColorStop(1, '#0f2440');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Seafloor
    ctx.fillStyle = 'rgba(30, 50, 35, 0.6)';
    ctx.fillRect(0, H - 28, W, 28);

    // Update creature
    creature.x += creature.vx * dt;
    creature.y += Math.sin(now * 0.002) * 0.5;
    if (creature.x > W - 30) {
      creature.vx = -Math.abs(creature.vx);
    }
    if (creature.x < 30) {
      creature.vx = Math.abs(creature.vx);
    }

    // Apply impulse from creature to nearby chains
    const impDir = creature.vx > 0 ? 1 : -1;
    for (const ch of chains) {
      ch.applyImpulseNear(creature.x, creature.y, impDir * 3.5 * impulseStrength, -0.5, 50);
    }

    // Ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.r += 120 * dt;
      r.alpha -= 0.8 * dt;
      if (r.alpha <= 0) {
        ripples.splice(i, 1);
        continue;
      }
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,153,51,${r.alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Update & draw chains
    for (const ch of chains) {
      ch.update(dt, t, true);

      // Draw with impulse-colored nodes
      ctx.beginPath();
      ctx.moveTo(ch.x[0], ch.y[0]);
      for (let i = 1; i < ch.n; i++) ctx.lineTo(ch.x[i], ch.y[i]);
      ctx.strokeStyle = '#4a9';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Nodes colored by impulse magnitude
      for (let i = 0; i < ch.n; i++) {
        const imp = Math.sqrt(ch.ix[i] * ch.ix[i] + ch.iy[i] * ch.iy[i]);
        const heat = Math.min(imp * 3, 1);

        const nodeRadius = i === 0 ? 6 : 5 + heat * 4;
        ctx.beginPath();
        ctx.arc(ch.x[i], ch.y[i], nodeRadius, 0, Math.PI * 2);

        if (i === 0) {
          ctx.fillStyle = '#f44';
        } else if (heat > 0.01) {
          // Interpolate green - orange - white
          const r = Math.round(100 + heat * 155);
          const g = Math.round(255 - heat * 100);
          const b = Math.round(150 - heat * 100);
          ctx.fillStyle = `rgb(${r},${g},${b})`;

          // Glow
          ctx.shadowColor = `rgba(255,153,51,${heat * 0.8})`;
          ctx.shadowBlur = heat * 25;
        } else {
          ctx.fillStyle = '#6fc';
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // Draw creature (fish)
    const fishDir = creature.vx > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(creature.x, creature.y);
    ctx.scale(fishDir, 1);

    // Trail/wake
    ctx.fillStyle = 'rgba(80, 200, 255, 0.06)';
    ctx.beginPath();
    ctx.ellipse(-20, 0, 25, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = 'rgba(80, 200, 255, 0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, creature.width, creature.height, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(-creature.width + 2, 0);
    ctx.lineTo(-creature.width - 10, -8);
    ctx.lineTo(-creature.width - 10, 8);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(creature.width * 0.5, -2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(10, 20, 40, 0.9)';
    ctx.beginPath();
    ctx.arc(creature.width * 0.5 + 0.5, -2, 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Instructions
    ctx.font = '12px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center';
    ctx.fillText('Watch the fish push through kelp - click to add impulse', W / 2, 25);
    ctx.textAlign = 'left';

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
