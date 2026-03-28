/**
 * Narration Timeline & Music Ducking Demo
 * Visualizes narration cues and music volume ducking over simulation timeline
 */

export function init(container) {
  const canvas = document.createElement('canvas');
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width || 800;
  canvas.height = 250;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let W, H, dpr;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const parentRect = canvas.parentElement.getBoundingClientRect();
    W = parentRect.width * dpr;
    H = canvas.height * dpr;
    canvas.width = W;
    canvas.height = H;
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  const narrationCues = [
    { time: 4.15, label: 'Welcome', duration: 28, color: '#a6e3a1' },
    { time: 7.15, label: 'PolyFish', duration: 25, color: '#89b4fa' },
    { time: 74.15, label: 'Manatee', duration: 22, color: '#f9e2af' },
    { time: 104.65, label: 'Dolphin', duration: 18, color: '#cba6f7' },
    { time: 120, label: 'Outro', duration: 20, color: '#fab387' },
  ];

  const totalDuration = 120;
  const timelineY = 100;
  const timelineH = 40;

  let playheadTime = 0;
  let isPlaying = false;
  let speed = 1.0;
  let lastFrame = performance.now();

  // Create controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'demo-controls';

  const playBtn = document.createElement('button');
  playBtn.id = 'btn-timeline-play-pause';
  playBtn.textContent = '▶ Play';
  controlsDiv.appendChild(playBtn);

  const speedLabel = document.createElement('label');
  const speedInput = document.createElement('input');
  speedInput.type = 'range';
  speedInput.id = 'ctrl-timeline-speed';
  speedInput.min = '0.25';
  speedInput.max = '2';
  speedInput.value = '1';
  speedInput.step = '0.25';

  const speedVal = document.createElement('span');
  speedVal.id = 'val-timeline-speed';
  speedVal.textContent = '1.0×';

  speedLabel.appendChild(document.createTextNode('Speed '));
  speedLabel.appendChild(speedInput);
  speedLabel.appendChild(speedVal);
  controlsDiv.appendChild(speedLabel);

  container.appendChild(controlsDiv);

  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    lastFrame = performance.now();
  });

  speedInput.addEventListener('input', () => {
    speed = parseFloat(speedInput.value);
    speedVal.textContent = speed.toFixed(2) + '×';
  });

  function draw(now) {
    if (isPlaying) {
      const delta = (now - lastFrame) / 1000;
      playheadTime += delta * speed;
      if (playheadTime >= totalDuration) {
        playheadTime = 0;
      }
    }
    lastFrame = now;

    const W_units = W / dpr;
    const H_units = H / dpr;

    // Background
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, W_units, H_units);

    // Title
    ctx.font = 'bold 13px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText('Simulation Timeline (~120s)  -  Narration Cues & Music Ducking', W_units / 2, 30);

    // Timeline background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(40, timelineY, W_units - 80, timelineH);

    // Timeline border
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(40, timelineY, W_units - 80, timelineH);

    const timelineW = W_units - 80;
    const pxPerSec = timelineW / totalDuration;

    // Draw narration cues as boxes on timeline
    for (const cue of narrationCues) {
      const cueX = 40 + cue.time * pxPerSec;
      const cueDurationPx = cue.duration * pxPerSec;

      // Cue box
      ctx.fillStyle = cue.color + '40';
      ctx.fillRect(cueX, timelineY, cueDurationPx, timelineH);

      // Cue border
      ctx.strokeStyle = cue.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cueX, timelineY, cueDurationPx, timelineH);

      // Label
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = cue.color;
      ctx.textAlign = 'center';
      if (cueDurationPx > 30) {
        ctx.fillText(cue.label, cueX + cueDurationPx / 2, timelineY + 20);
      }
    }

    // Playhead
    const playheadX = 40 + playheadTime * pxPerSec;
    ctx.strokeStyle = '#f93';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, timelineY - 5);
    ctx.lineTo(playheadX, timelineY + timelineH + 5);
    ctx.stroke();

    // Playhead triangle
    ctx.fillStyle = '#f93';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, timelineY - 8);
    ctx.lineTo(playheadX + 6, timelineY - 8);
    ctx.lineTo(playheadX, timelineY - 2);
    ctx.closePath();
    ctx.fill();

    // Time labels
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'center';
    for (let s = 0; s <= totalDuration; s += 20) {
      const x = 40 + s * pxPerSec;
      ctx.fillText(s + 's', x, timelineY + timelineH + 18);
      ctx.fillRect(x - 1, timelineY - 3, 2, 6);
    }

    // Current time display
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f93';
    ctx.textAlign = 'left';
    ctx.fillText(`Playhead: ${playheadTime.toFixed(2)}s`, 50, H_units - 30);

    // Music ducking visualization
    const musicMeterY = timelineY + 120;
    const musicDuckingAmount = isInNarrationWindow(playheadTime) ? 0.3 : 1.0;
    drawDuckingMeter(ctx, 40, musicMeterY, 150, musicDuckingAmount, 'Music Level (Ducked)');

    // Narration presence indicator
    const narrationAmount = isInNarrationWindow(playheadTime) ? 1.0 : 0.0;
    drawDuckingMeter(ctx, 220, musicMeterY, 150, narrationAmount, 'Narration Present');

    requestAnimationFrame(draw);
  }

  function isInNarrationWindow(time) {
    for (const cue of narrationCues) {
      if (time >= cue.time && time < cue.time + cue.duration) {
        return true;
      }
    }
    return false;
  }

  function drawDuckingMeter(ctx, x, y, w, value, label) {
    const h = 30;
    const filledW = w * value;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y, w, h);

    // Filled portion
    const color = value > 0.5 ? '#a6e3a1' : '#f9613b';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, y, filledW, h);
    ctx.globalAlpha = 1;

    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Label
    ctx.font = '9px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 5);

    // Percentage
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText((value * 100).toFixed(0) + '%', x + w / 2, y + h - 6);
  }

  draw(performance.now());
}
