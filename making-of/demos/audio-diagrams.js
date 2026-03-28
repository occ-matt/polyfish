/**
 * Audio Diagrams Module
 * Combines three informational diagrams:
 * - Audio Architecture
 * - AudioContext Lifecycle
 * - Playlist Shuffle
 */

export function initArchitecture(container) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 240;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 240;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let startTime = Date.now();
  let animationId;

  function drawNode(x, y, r, color, label) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 10px JetBrains Mono';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  function drawArrow(x1, y1, x2, y2, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const dx = x2 - x1;
    const dy = y2 - y1;
    const angle = Math.atan2(dy, dx);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8 * Math.cos(angle - Math.PI / 6), y2 - 8 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - 8 * Math.cos(angle + Math.PI / 6), y2 - 8 * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function animate() {
    const now = Date.now();
    const elapsed = (now - startTime) * 0.001;

    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const inputY = 60;
    const inputX = [100, canvas.width / 2, canvas.width - 100];
    const inputLabels = ['Music', 'Narration', 'SFX'];
    const inputColors = [
      'rgba(100, 200, 100, 0.8)',
      'rgba(150, 200, 255, 0.8)',
      'rgba(255, 150, 100, 0.8)'
    ];

    for (let i = 0; i < 3; i++) {
      drawNode(inputX[i], inputY, 20, inputColors[i], inputLabels[i]);
    }

    const masterX = canvas.width / 2;
    const masterY = 150;
    drawNode(masterX, masterY, 25, 'rgba(200, 200, 100, 0.8)', 'Master');

    const outputY = 200;
    drawNode(masterX, outputY, 20, 'rgba(200, 150, 100, 0.8)', 'Output');

    const arrowColor = 'rgba(255, 150, 100, 0.6)';
    for (let i = 0; i < 3; i++) {
      drawArrow(inputX[i], inputY + 20, masterX, masterY - 25, arrowColor);
    }

    drawArrow(masterX, masterY + 25, masterX, outputY - 20, arrowColor);

    const volumes = [0.25, 0.85, 0.5, 1.0];
    const labels = ['Music: 0.25', 'Narration: 0.85', 'SFX: 0.5', 'Master: 1.0'];

    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
    ctx.textAlign = 'left';
    for (let i = 0; i < labels.length; i++) {
      ctx.fillText(labels[i], 20, 35 + i * 18);
    }

    animationId = requestAnimationFrame(animate);
  }

  animate();
}

export function initLifecycle(container) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 200;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 200;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let startTime = Date.now();
  let animationId;

  function animate() {
    const now = Date.now();
    const elapsed = (now - startTime) * 0.001;

    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const y = 100;
    const h = 50;
    const states = [
      { label: 'Suspended', x: 100, color: 'rgba(255, 100, 100, 0.8)' },
      { label: 'Gesture', x: canvas.width / 2 - 40, color: 'rgba(255, 200, 50, 0.8)' },
      { label: 'Running', x: canvas.width - 100, color: 'rgba(100, 220, 100, 0.8)' }
    ];

    for (const state of states) {
      ctx.fillStyle = state.color;
      ctx.fillRect(state.x - 40, y - 25, 80, 50);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(state.x - 40, y - 25, 80, 50);

      ctx.font = 'bold 11px JetBrains Mono';
      ctx.fillStyle = 'rgba(10, 22, 40, 1)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.label, state.x, y + 5);
    }

    ctx.strokeStyle = 'rgba(150, 200, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(150, 200, 255, 0.7)';

    const x1 = states[0].x + 40;
    const x2 = states[1].x - 40;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y);
    ctx.lineTo(x2 - 8, y - 4);
    ctx.lineTo(x2 - 8, y + 4);
    ctx.closePath();
    ctx.fill();

    ctx.font = '9px JetBrains Mono';
    ctx.fillStyle = 'rgba(150, 200, 255, 1)';
    ctx.textAlign = 'center';
    ctx.fillText('await resume()', (x1 + x2) / 2, y - 20);

    ctx.strokeStyle = 'rgba(100, 220, 100, 0.7)';
    ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(100, 220, 100, 0.7)';
    const x3 = states[1].x + 40;
    const x4 = states[2].x - 40;
    ctx.beginPath();
    ctx.moveTo(x3, y);
    ctx.lineTo(x4, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x4, y);
    ctx.lineTo(x4 - 8, y - 4);
    ctx.lineTo(x4 - 8, y + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(100, 220, 100, 1)';
    ctx.fillText('success', (x3 + x4) / 2, y - 20);

    animationId = requestAnimationFrame(animate);
  }

  animate();
}

export function initPlaylistShuffle(container) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 200;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 200;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let startTime = Date.now();
  let animationId;
  let tracks = [0, 1, 2];

  function animate() {
    const now = Date.now();
    const elapsed = (now - startTime) * 0.001;

    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (Math.floor(elapsed / 4) !== Math.floor((elapsed - 0.016) / 4)) {
      const copy = [...tracks];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      tracks = copy;
    }

    const trackY = 100;
    const trackSpacing = canvas.width / 3;
    const trackW = 60;
    const trackH = 50;

    ctx.font = 'bold 11px JetBrains Mono';
    ctx.textAlign = 'center';

    for (let i = 0; i < 3; i++) {
      const x = trackSpacing * (i + 0.5);
      const trackNum = tracks[i];

      ctx.fillStyle = ['rgba(100, 180, 255, 0.8)', 'rgba(150, 150, 255, 0.8)', 'rgba(100, 150, 255, 0.8)'][trackNum];
      ctx.fillRect(x - trackW / 2, trackY - trackH / 2, trackW, trackH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - trackW / 2, trackY - trackH / 2, trackW, trackH);

      ctx.fillStyle = 'rgba(10, 22, 40, 1)';
      ctx.fillText(`Track ${trackNum + 1}`, x, trackY + 5);

      ctx.fillStyle = 'rgba(255, 200, 100, 1)';
      ctx.font = 'bold 12px JetBrains Mono';
      ctx.fillText(`#${i + 1}`, x, trackY - 25);
    }

    ctx.font = 'bold 12px JetBrains Mono';
    ctx.fillStyle = 'rgba(255, 200, 100, 1)';
    ctx.textAlign = 'center';
    ctx.fillText('Current Shuffle Order (refreshes every 4 sec)', canvas.width / 2, 35);

    animationId = requestAnimationFrame(animate);
  }

  animate();
}
