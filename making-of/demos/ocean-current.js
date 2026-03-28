/**
 * Ocean Current Visualization Demo
 *
 * Demonstrates multiple kelp stalks swaying in an ocean current with controls for:
 * - Current amplitude
 * - Current speed
 * - Phase span (wave travel along stalk)
 * - Direction bias (primary vs cross-wave balance)
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
  canvas.id = 'demo-current';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Ocean current - kelp forest with varying parameters';
  container.appendChild(label);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Amplitude <input type="range" id="ctrl-amp" min="0" max="3" value="1.5" step="0.1"><span id="val-amp">1.5</span></label>
    <label>Speed <input type="range" id="ctrl-speed" min="0.02" max="0.5" value="0.15" step="0.01"><span id="val-speed">0.15</span></label>
    <label>Phase Span <input type="range" id="ctrl-phase" min="0.5" max="8" value="4.0" step="0.1"><span id="val-phase">4.0</span></label>
    <label>Dir. Bias <input type="range" id="ctrl-bias" min="0" max="1" value="0.7" step="0.05"><span id="val-bias">0.7</span></label>
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
    // Rebuild chains on resize
    buildForest();
  }

  const chains = [];
  const chainColors = [];

  function buildForest() {
    chains.length = 0;
    chainColors.length = 0;
    const count = Math.max(5, Math.floor(W / 80));
    const spacing = W / (count + 1);
    for (let i = 0; i < count; i++) {
      const x = spacing * (i + 1) + (Math.random() - 0.5) * 20;
      const nodes = 10 + Math.floor(Math.random() * 5);
      const seg = 18 + Math.random() * 8;
      const c = new VerletChain2D(nodes, x, H - 30, seg);
      c.phaseOffset = Math.random() * Math.PI * 2;
      c.currentAmp = parseFloat(document.getElementById('ctrl-amp').value) * (30 + Math.random() * 15);
      c.currentSpeed = parseFloat(document.getElementById('ctrl-speed').value);
      c.currentPhaseSpan = parseFloat(document.getElementById('ctrl-phase').value);
      c.currentBias = parseFloat(document.getElementById('ctrl-bias').value);
      c.inertia = 0.82 + Math.random() * 0.08;
      c.buoyancy = (0.35 + Math.random() * 0.1) * 40;
      c.stiffness = 3;
      chains.push(c);

      const hue = 120 + Math.random() * 40;
      const sat = 40 + Math.random() * 20;
      const lit = 35 + Math.random() * 15;
      chainColors.push(`hsl(${hue},${sat}%,${lit}%)`);
    }
  }

  resize();
  window.addEventListener('resize', resize);

  setupSlider('ctrl-amp', 'val-amp', v => chains.forEach(c => c.currentAmp = v * (30 + Math.random() * 15)));
  setupSlider('ctrl-speed', 'val-speed', v => chains.forEach(c => c.currentSpeed = v));
  setupSlider('ctrl-phase', 'val-phase', v => chains.forEach(c => c.currentPhaseSpan = v));
  setupSlider('ctrl-bias', 'val-bias', v => chains.forEach(c => c.currentBias = v));

  let last = 0;
  function draw(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const t = now * 0.001;

    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#061220');
    grad.addColorStop(0.6, '#0a1e38');
    grad.addColorStop(1, '#132a1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Seafloor
    ctx.fillStyle = 'rgba(30, 50, 35, 0.6)';
    ctx.beginPath();
    ctx.moveTo(0, H - 25);
    for (let x = 0; x <= W; x += 20) {
      ctx.lineTo(x, H - 25 + Math.sin(x * 0.03) * 5);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();

    // Current arrow indicator
    const arrowX = W - 60, arrowY = 30;
    const wave = Math.sin(t * 0.3) * 15;
    ctx.beginPath();
    ctx.moveTo(arrowX - 20 + wave, arrowY);
    ctx.lineTo(arrowX + 20 + wave, arrowY);
    ctx.lineTo(arrowX + 15 + wave, arrowY - 5);
    ctx.moveTo(arrowX + 20 + wave, arrowY);
    ctx.lineTo(arrowX + 15 + wave, arrowY + 5);
    ctx.strokeStyle = 'rgba(100,180,255,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(100,180,255,0.4)';
    ctx.fillText('current', arrowX - 18, arrowY + 16);

    // Update & draw chains
    for (let c = 0; c < chains.length; c++) {
      const ch = chains[c];
      ch.update(dt, t, true);

      // Draw chain as thick lines
      ctx.beginPath();
      ctx.moveTo(ch.x[0], ch.y[0]);
      for (let i = 1; i < ch.n; i++) {
        ctx.lineTo(ch.x[i], ch.y[i]);
      }
      ctx.strokeStyle = chainColors[c];
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Subtle glow
      ctx.strokeStyle = chainColors[c].replace(')', ',0.2)').replace('hsl', 'hsla');
      ctx.lineWidth = 8;
      ctx.stroke();
    }

    // Floating particles
    ctx.fillStyle = 'rgba(180,220,200,0.15)';
    for (let i = 0; i < 30; i++) {
      const px = ((i * 137.5 + t * 8) % W);
      const py = ((i * 89.3 + t * 3 + Math.sin(t + i) * 10) % H);
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
