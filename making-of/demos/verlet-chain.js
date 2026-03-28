/**
 * Interactive Verlet Chain Demo
 *
 * Demonstrates a single draggable verlet chain with controls for:
 * - Number of nodes
 * - Inertia (damping)
 * - Buoyancy
 * - Stiffness (constraint iterations)
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
  canvas.id = 'demo-chain';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Interactive Verlet Chain - drag any node';
  container.appendChild(label);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Nodes <input type="range" id="ctrl-nodes" min="4" max="20" value="12" step="1"><span id="val-nodes">12</span></label>
    <label>Inertia <input type="range" id="ctrl-inertia" min="0.5" max="0.99" value="0.88" step="0.01"><span id="val-inertia">0.88</span></label>
    <label>Buoyancy <input type="range" id="ctrl-buoyancy" min="0" max="2" value="0.4" step="0.05"><span id="val-buoyancy">0.4</span></label>
    <label>Stiffness <input type="range" id="ctrl-stiffness" min="1" max="8" value="3" step="1"><span id="val-stiffness">3</span></label>
    <button id="btn-reset-chain">Reset</button>
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
  }
  resize();
  window.addEventListener('resize', resize);

  let nodeCount = 12;
  const segLen = 25;
  let chain = new VerletChain2D(nodeCount, W / 2, H - 40, segLen);

  function rebuildChain(n) {
    nodeCount = n;
    chain = new VerletChain2D(n, W / 2, H - 40, segLen);
    chain.inertia = parseFloat(document.getElementById('ctrl-inertia').value);
    chain.buoyancy = parseFloat(document.getElementById('ctrl-buoyancy').value) * 50;
    chain.stiffness = parseInt(document.getElementById('ctrl-stiffness').value);
  }

  setupSlider('ctrl-nodes', 'val-nodes', v => rebuildChain(v));
  setupSlider('ctrl-inertia', 'val-inertia', v => chain.inertia = v);
  setupSlider('ctrl-buoyancy', 'val-buoyancy', v => chain.buoyancy = v * 50);
  setupSlider('ctrl-stiffness', 'val-stiffness', v => chain.stiffness = v);
  chain.buoyancy = 0.4 * 50;

  document.getElementById('btn-reset-chain').addEventListener('click', () => rebuildChain(nodeCount));

  // Dragging
  let dragIdx = -1;
  function getNearestNode(mx, my) {
    let best = -1, bestD = 20;
    for (let i = 0; i < chain.n; i++) {
      const dx = chain.x[i] - mx, dy = chain.y[i] - my;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    dragIdx = getNearestNode(mx, my);
    if (dragIdx === 0) dragIdx = -1; // can't drag anchor
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (dragIdx < 0) return;
    const rect = canvas.getBoundingClientRect();
    chain.x[dragIdx] = e.clientX - rect.left;
    chain.y[dragIdx] = e.clientY - rect.top;
    chain.px[dragIdx] = chain.x[dragIdx];
    chain.py[dragIdx] = chain.y[dragIdx];
  });

  canvas.addEventListener('pointerup', () => {
    dragIdx = -1;
  });

  let last = 0;
  function draw(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    // Reanchor on resize
    chain.x[0] = chain.restX[0] = W / 2;
    chain.y[0] = chain.restY[0] = H - 40;

    chain.update(dt, now * 0.001, false);

    ctx.clearRect(0, 0, W, H);

    // Draw gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a1628');
    grad.addColorStop(1, '#0f2440');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Draw seafloor
    ctx.fillStyle = 'rgba(40, 60, 50, 0.5)';
    ctx.fillRect(0, H - 30, W, 30);

    // Draw chain segments
    ctx.beginPath();
    ctx.moveTo(chain.x[0], chain.y[0]);
    for (let i = 1; i < chain.n; i++) ctx.lineTo(chain.x[i], chain.y[i]);
    ctx.strokeStyle = '#4a9';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw nodes
    for (let i = 0; i < chain.n; i++) {
      ctx.beginPath();
      ctx.arc(chain.x[i], chain.y[i], i === 0 ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#f44' : (i === dragIdx ? '#fff' : '#6fc');
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Labels
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('anchor (pinned)', chain.x[0] + 14, chain.y[0] + 4);
    ctx.fillText('tip (free)', chain.x[chain.n - 1] + 14, chain.y[chain.n - 1] + 4);

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
