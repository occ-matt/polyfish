/**
 * Positional vs Stereo Audio Demo
 * Interactive demonstration comparing stereo panning to 3D spatial audio positioning
 */

export function init(container) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  let audioContext = null;
  let oscillator = null;
  let masterGain = null;
  let panNode = null;
  let pannerNode = null;
  let isPlaying = false;
  let audioMode = 'stereo';

  // Sound source position (in canvas coordinates)
  let sourceX = 400;
  let sourceY = 200;
  let isDragging = false;

  // Listener at center
  const listenerX = canvas.width / 2;
  const listenerY = canvas.height / 2;

  // Create controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'demo-controls';

  const playBtn = document.createElement('button');
  playBtn.id = 'btn-spatial-play';
  playBtn.textContent = '▶ Play Tone';
  controlsDiv.appendChild(playBtn);

  const label1 = document.createElement('label');
  const radio1 = document.createElement('input');
  radio1.type = 'radio';
  radio1.name = 'audio-mode';
  radio1.value = 'stereo';
  radio1.checked = true;
  label1.appendChild(radio1);
  label1.appendChild(document.createTextNode(' Stereo Panning'));
  controlsDiv.appendChild(label1);

  const label2 = document.createElement('label');
  const radio2 = document.createElement('input');
  radio2.type = 'radio';
  radio2.name = 'audio-mode';
  radio2.value = 'positional';
  label2.appendChild(radio2);
  label2.appendChild(document.createTextNode(' Positional (3D)'));
  controlsDiv.appendChild(label2);

  const spatialInfo = document.createElement('span');
  spatialInfo.id = 'spatial-info';
  spatialInfo.style.marginLeft = '20px';
  spatialInfo.style.color = '#89b4fa';
  spatialInfo.textContent = 'Stereo Mode  -  Drag to move source';
  controlsDiv.appendChild(spatialInfo);

  container.appendChild(controlsDiv);

  async function initAudioContext() {
    if (audioContext) return audioContext;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioContext.destination);

    return audioContext;
  }

  function createToneSource() {
    if (!audioContext) return null;

    oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;

    if (audioMode === 'stereo') {
      panNode = audioContext.createStereoPanner();
      oscillator.connect(panNode);
      panNode.connect(masterGain);
    } else {
      pannerNode = audioContext.createPanner();
      pannerNode.panningModel = 'HRTF';
      pannerNode.distanceModel = 'inverse';
      pannerNode.refDistance = 100;
      pannerNode.maxDistance = 400;
      pannerNode.rolloffFactor = 1;

      audioContext.listener.positionX.value = listenerX;
      audioContext.listener.positionY.value = listenerY;
      audioContext.listener.positionZ.value = 0;

      oscillator.connect(pannerNode);
      pannerNode.connect(masterGain);
    }

    return oscillator;
  }

  async function playTone() {
    const ctx = await initAudioContext();

    if (isPlaying) {
      try {
        oscillator.stop();
      } catch (e) { }
      isPlaying = false;
      playBtn.textContent = '▶ Play Tone';
      return;
    }

    createToneSource();
    oscillator.start();
    isPlaying = true;
    playBtn.textContent = '⏸ Stop Tone';
  }

  function updateAudioPosition() {
    if (!isPlaying) return;

    if (audioMode === 'stereo') {
      const panValue = (sourceX / canvas.width) * 2 - 1;
      if (panNode) {
        panNode.pan.value = panValue;
      }
    } else {
      if (pannerNode) {
        const relX = ((sourceX / canvas.width) - 0.5) * 2 * 300;
        const relY = ((sourceY / canvas.height) - 0.5) * 2 * 300;
        const relZ = 0;

        pannerNode.positionX.value = relX;
        pannerNode.positionY.value = relY;
        pannerNode.positionZ.value = relZ;
      }
    }
  }

  function draw() {
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 14px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Listening Area (Overhead View)  -  Mode: ${audioMode === 'stereo' ? 'Stereo Panning' : 'Positional 3D'}`,
      canvas.width / 2,
      25
    );

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(50, 50, canvas.width - 100, canvas.height - 100);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let x = 50; x < canvas.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 50);
      ctx.lineTo(x, canvas.height - 50);
      ctx.stroke();
    }
    for (let y = 50; y < canvas.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(50, y);
      ctx.lineTo(canvas.width - 50, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#a6e3a1';
    ctx.beginPath();
    ctx.arc(listenerX, listenerY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a6e3a1';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#a6e3a1';
    ctx.textAlign = 'center';
    ctx.fillText('Listener', listenerX, listenerY + 35);

    ctx.fillStyle = '#f9e2af';
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f9e2af';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f9e2af';
    ctx.textAlign = 'center';
    ctx.fillText('Source', sourceX, sourceY - 30);

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(listenerX, listenerY);
    ctx.lineTo(sourceX, sourceY);
    ctx.stroke();
    ctx.setLineDash([]);

    const meterY = canvas.height - 60;
    drawBalanceMeter(ctx, 50, meterY, canvas.width - 100);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';

    if (audioMode === 'stereo') {
      const panValue = (sourceX / canvas.width) * 2 - 1;
      ctx.fillText(`Pan: ${panValue.toFixed(2)} (L: -1, C: 0, R: +1)`, 60, canvas.height - 20);
    } else {
      const relX = ((sourceX / canvas.width) - 0.5) * 2 * 300;
      const relY = ((sourceY / canvas.height) - 0.5) * 2 * 300;
      const distance = Math.sqrt(relX * relX + relY * relY);
      ctx.fillText(
        `Position: X=${relX.toFixed(0)}, Y=${relY.toFixed(0)}, Distance=${distance.toFixed(0)}`,
        60,
        canvas.height - 20
      );
    }

    requestAnimationFrame(draw);
  }

  function drawBalanceMeter(ctx, x, y, w) {
    const h = 25;

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = 'rgba(150, 200, 255, 0.3)';
    ctx.fillRect(x, y, w / 2, h);

    ctx.fillStyle = 'rgba(255, 150, 100, 0.3)';
    ctx.fillRect(x + w / 2, y, w / 2, h);

    let indicatorX;
    if (audioMode === 'stereo') {
      const panValue = (sourceX / canvas.width) * 2 - 1;
      indicatorX = x + (w / 2) * (1 + panValue);
    } else {
      indicatorX = sourceX;
    }

    ctx.fillStyle = '#f93';
    ctx.fillRect(indicatorX - 2, y, 4, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    ctx.font = '9px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('L', x + w / 4, y + h + 12);
    ctx.fillText('C', x + w / 2, y + h + 12);
    ctx.fillText('R', x + 3 * w / 4, y + h + 12);
  }

  playBtn.addEventListener('click', playTone);

  const modeRadios = document.querySelectorAll('input[name="audio-mode"]');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const newMode = e.target.value;
      if (isPlaying) {
        try {
          oscillator.stop();
        } catch (e) { }
        audioMode = newMode;
        spatialInfo.textContent = audioMode === 'stereo'
          ? 'Stereo Mode - Drag to pan left/right'
          : 'Positional Mode - Drag to move around listener';
        playTone();
      } else {
        audioMode = newMode;
        spatialInfo.textContent = audioMode === 'stereo'
          ? 'Stereo Mode - Drag to pan left/right'
          : 'Positional Mode - Drag to move around listener';
      }
    });
  });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dist = Math.hypot(x - sourceX, y - sourceY);
    if (dist < 30) {
      isDragging = true;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const rect = canvas.getBoundingClientRect();
      sourceX = Math.max(50, Math.min(e.clientX - rect.left, canvas.width - 50));
      sourceY = Math.max(50, Math.min(e.clientY - rect.top, canvas.height - 100));
      updateAudioPosition();
    }
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });

  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
  });

  draw();
}
