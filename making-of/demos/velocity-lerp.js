// ── Thrust vs Velocity Demo ──
// Canvas 2D simulator showing physics-based acceleration and drag

export function init(container) {
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-velocity-lerp';
  canvas.width = 800;
  canvas.height = 350;

  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Thrust vs. velocity - watch the fish coast when thrust cuts out. Drag the throttle slider to feel it.';

  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Throttle <input type="range" id="ctrl-thrust-throttle" min="0" max="2.5" value="1" step="0.05"><span id="val-thrust-throttle">1.0x</span></label>
    <label>Drag <input type="range" id="ctrl-thrust-drag" min="0.90" max="0.99" value="0.95" step="0.005"><span id="val-thrust-drag">0.950</span></label>
    <button id="btn-thrust-reset">Reset</button>
  `;

  container.appendChild(canvas);
  container.appendChild(label);
  container.appendChild(controls);

  const ctx = canvas.getContext('2d');
  const throttleSlider = document.getElementById('ctrl-thrust-throttle');
  const dragSlider = document.getElementById('ctrl-thrust-drag');
  const throttleVal = document.getElementById('val-thrust-throttle');
  const dragVal = document.getElementById('val-thrust-drag');
  const resetBtn = document.getElementById('btn-thrust-reset');

  // Fish state
  let fishX = 60;
  let fishVel = 0;
  const accelRate = 4.0;
  const baseSpeed = 200;
  let prevThrottle = 0;
  let lastTime = Date.now() * 0.001;

  // History for graph
  const history = [];
  const historyLen = 300;

  // Tail wiggle phase
  let tailPhase = 0;

  function reset() {
    fishX = 60;
    fishVel = 0;
    history.length = 0;
    prevThrottle = 0;
    lastTime = Date.now() * 0.001;
  }
  if (resetBtn) resetBtn.addEventListener('click', reset);
  if (throttleSlider) throttleSlider.addEventListener('input', () => {
    throttleVal.textContent = parseFloat(throttleSlider.value).toFixed(1) + 'x';
  });
  if (dragSlider) dragSlider.addEventListener('input', () => {
    dragVal.textContent = parseFloat(dragSlider.value).toFixed(3);
  });

  function drawFish(x, y, vel, thrust) {
    const size = 18;

    ctx.save();
    ctx.translate(x, y);

    // Thrust flame when engine is on
    if (thrust > 0.05) {
      const flameLen = 8 + thrust * 12;
      const flicker = Math.sin(Date.now() * 0.02) * 2;
      ctx.fillStyle = 'rgba(255, 120, 30, ' + (0.4 + thrust * 0.3) + ')';
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, -3);
      ctx.lineTo(-size * 0.5 - flameLen + flicker, 0);
      ctx.lineTo(-size * 0.5, 3);
      ctx.closePath();
      ctx.fill();
      // Inner flame
      ctx.fillStyle = 'rgba(255, 220, 80, ' + (0.3 + thrust * 0.2) + ')';
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, -1.5);
      ctx.lineTo(-size * 0.5 - flameLen * 0.6, 0);
      ctx.lineTo(-size * 0.5, 1.5);
      ctx.closePath();
      ctx.fill();
    }

    // Body - simple fish shape with tail wiggle
    const wiggle = Math.sin(tailPhase) * 4 * Math.min(1, vel / 80);
    ctx.fillStyle = '#f0a030';
    ctx.strokeStyle = 'rgba(255, 180, 60, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Nose
    ctx.moveTo(size * 0.7, 0);
    // Top arc
    ctx.quadraticCurveTo(size * 0.3, -size * 0.4, -size * 0.2, -size * 0.25);
    // Tail top
    ctx.lineTo(-size * 0.5, -size * 0.4 + wiggle);
    // Tail notch
    ctx.lineTo(-size * 0.35, wiggle * 0.5);
    // Tail bottom
    ctx.lineTo(-size * 0.5, size * 0.4 + wiggle);
    // Bottom arc
    ctx.lineTo(-size * 0.2, size * 0.25);
    ctx.quadraticCurveTo(size * 0.3, size * 0.4, size * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Eye
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(size * 0.35, -size * 0.05, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function animate() {
    const now = Date.now() * 0.001;
    const dt = Math.min(now - lastTime, 0.05);
    lastTime = now;

    const throttle = parseFloat(throttleSlider.value);
    const dragRaw = parseFloat(dragSlider.value);
    // Invert: low slider = low drag = long coast, high slider = high drag = quick stop
    const retention = 1.89 - dragRaw;

    // Physics: accelerate toward target, apply drag
    const targetVel = throttle * baseSpeed;
    if (throttle > 0.01) {
      // Accelerate toward target
      const diff = targetVel - fishVel;
      fishVel += diff * accelRate * dt;
    }
    // Always apply drag (retention is per-frame velocity multiplier)
    fishVel *= Math.pow(retention, dt * 60);

    // Clamp tiny values
    if (Math.abs(fishVel) < 0.1) fishVel = 0;

    // Move fish
    fishX += fishVel * dt;

    // Wrap around
    if (fishX > canvas.width + 30) fishX = -20;
    if (fishX < -30) fishX = canvas.width + 20;

    // Tail wiggle based on velocity
    tailPhase += dt * (3 + fishVel * 0.04);

    // Record history
    history.push({ vel: fishVel, throttle: throttle, time: now });
    while (history.length > historyLen) history.shift();

    // ── DRAW ──
    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ── TOP: Fish swimming lane ──
    const laneH = 100;
    const laneY = laneH / 2 + 10;

    // Lane background
    ctx.fillStyle = 'rgba(10, 30, 55, 0.6)';
    ctx.fillRect(0, 0, canvas.width, laneH);

    // Speed lines (motion streaks)
    if (fishVel > 10) {
      const streakAlpha = Math.min(0.3, fishVel / 500);
      ctx.strokeStyle = 'rgba(150, 200, 255, ' + streakAlpha + ')';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const sy = laneY - 15 + Math.random() * 30;
        const sx = fishX - 25 - Math.random() * fishVel * 0.3;
        const sl = 5 + fishVel * 0.05;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - sl, sy);
        ctx.stroke();
      }
    }

    // Draw the fish
    drawFish(fishX, laneY, fishVel, throttle);

    // Velocity readout
    ctx.fillStyle = 'rgba(255, 200, 100, 0.9)';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('vel: ' + (fishVel / baseSpeed).toFixed(2) + 'x', 10, laneH - 8);

    // Thrust indicator
    ctx.fillStyle = throttle > 0.01 ? 'rgba(100, 220, 100, 0.8)' : 'rgba(255, 100, 80, 0.8)';
    ctx.fillText('thrust: ' + (throttle > 0.01 ? 'ON ' + throttle.toFixed(1) + 'x' : 'OFF'), canvas.width - 150, laneH - 8);

    // ── BOTTOM: Graph ──
    const graphTop = laneH + 15;
    const graphH = canvas.height - graphTop - 35;
    const graphLeft = 50;
    const graphRight = canvas.width - 15;
    const graphW = graphRight - graphLeft;

    // Graph background
    ctx.fillStyle = 'rgba(5, 15, 30, 0.5)';
    ctx.fillRect(graphLeft, graphTop, graphW, graphH);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = graphTop + graphH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(graphLeft, y);
      ctx.lineTo(graphRight, y);
      ctx.stroke();
    }

    // Y labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    const maxV = 2.5;
    for (let i = 0; i <= 4; i++) {
      const val = (i / 4 * maxV).toFixed(1);
      const y = graphTop + graphH * (1 - i / 4);
      ctx.fillText(val + 'x', graphLeft - 5, y + 3);
    }

    // Y axis title
    ctx.save();
    ctx.translate(12, graphTop + graphH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('speed', 0, 0);
    ctx.restore();

    // Draw history curves
    if (history.length > 1) {
      const step = graphW / historyLen;

      // Throttle curve (teal, filled area)
      ctx.fillStyle = 'rgba(79, 195, 247, 0.12)';
      ctx.beginPath();
      ctx.moveTo(graphLeft, graphTop + graphH);
      for (let i = 0; i < history.length; i++) {
        const x = graphLeft + i * step;
        const y = graphTop + graphH * (1 - history[i].throttle / maxV);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(graphLeft + (history.length - 1) * step, graphTop + graphH);
      ctx.closePath();
      ctx.fill();

      // Throttle line
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = graphLeft + i * step;
        const y = graphTop + graphH * (1 - history[i].throttle / maxV);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Velocity curve (orange, solid)
      ctx.strokeStyle = 'rgba(255, 180, 60, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = graphLeft + i * step;
        const y = graphTop + graphH * (1 - (history[i].vel / baseSpeed) / maxV);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Legend
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    // Velocity
    ctx.strokeStyle = 'rgba(255, 180, 60, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(graphLeft + 5, graphTop + graphH + 15); ctx.lineTo(graphLeft + 25, graphTop + graphH + 15); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 200, 100, 0.7)';
    ctx.fillText('velocity', graphLeft + 30, graphTop + graphH + 19);
    // Throttle
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(graphLeft + 120, graphTop + graphH + 15); ctx.lineTo(graphLeft + 140, graphTop + graphH + 15); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(79, 195, 247, 0.7)';
    ctx.fillText('throttle', graphLeft + 145, graphTop + graphH + 19);
    // Drag label
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'right';
    ctx.fillText('drag = ' + dragRaw.toFixed(3) + '/frame', graphRight, graphTop + graphH + 19);

    requestAnimationFrame(animate);
  }

  animate();
}
