/**
 * Audio Signal Chain Interactive Demo
 * Demonstrates signal flow through gain channels with real-time volume control
 */

export function init(container) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 280;
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let W, H, dpr;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.width;
    H = canvas.height;
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  let musicVol = 0.25;
  let narrationVol = 0.85;
  let sfxVol = 0.5;
  let masterVol = 1.0;

  // Create controls
  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'demo-controls';

  const playBtn = document.createElement('button');
  playBtn.id = 'btn-play-audio';
  playBtn.textContent = '▶ Play Audio';
  controlsDiv.appendChild(playBtn);

  function createLabel(labelText, id, valId, min, max, value) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = min;
    input.max = max;
    input.value = value;
    input.step = '0.01';

    const valueSpan = document.createElement('span');
    valueSpan.id = valId;
    valueSpan.textContent = parseFloat(value).toFixed(2);

    label.appendChild(document.createTextNode(labelText + ' '));
    label.appendChild(input);
    label.appendChild(valueSpan);
    return label;
  }

  controlsDiv.appendChild(createLabel('Music ', 'ctrl-music-vol', 'val-music-vol', '0', '1', '0.25'));
  controlsDiv.appendChild(createLabel('Narration ', 'ctrl-narration-vol', 'val-narration-vol', '0', '1', '0.85'));
  controlsDiv.appendChild(createLabel('SFX ', 'ctrl-sfx-vol', 'val-sfx-vol', '0', '1', '0.5'));
  controlsDiv.appendChild(createLabel('Master ', 'ctrl-master-vol', 'val-master-vol', '0', '1', '1.0'));

  container.appendChild(controlsDiv);

  function setupControl(id, valId, cb) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      valEl.textContent = v.toFixed(2);
      cb(v);
    });
  }

  setupControl('ctrl-music-vol', 'val-music-vol', (v) => { musicVol = v; });
  setupControl('ctrl-narration-vol', 'val-narration-vol', (v) => { narrationVol = v; });
  setupControl('ctrl-sfx-vol', 'val-sfx-vol', (v) => { sfxVol = v; });
  setupControl('ctrl-master-vol', 'val-master-vol', (v) => { masterVol = v; });

  let time = 0;
  let audioContext = null;
  let musicGain = null;
  let narrationGain = null;
  let sfxGain = null;
  let masterGain = null;
  let currentMusicSource = null;
  let currentNarrationSource = null;
  let currentSFXSource = null;
  let audioBuffers = new Map();
  let isPlaying = false;

  const narrationClips = [
    '/assets/audio/narration/welcome.mp3',
    '/assets/audio/narration/polyfish_intro.mp3',
    '/assets/audio/narration/manatee_intro.mp3',
    '/assets/audio/narration/dolphin_intro.mp3',
    '/assets/audio/narration/outro.mp3'
  ];

  async function initAudioContext() {
    if (audioContext) return audioContext;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    masterGain = audioContext.createGain();
    masterGain.gain.value = masterVol;
    masterGain.connect(audioContext.destination);

    musicGain = audioContext.createGain();
    musicGain.gain.value = musicVol;
    musicGain.connect(masterGain);

    narrationGain = audioContext.createGain();
    narrationGain.gain.value = narrationVol;
    narrationGain.connect(masterGain);

    sfxGain = audioContext.createGain();
    sfxGain.gain.value = sfxVol;
    sfxGain.connect(masterGain);

    return audioContext;
  }

  async function loadAudioBuffer(url) {
    if (audioBuffers.has(url)) {
      return audioBuffers.get(url);
    }

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.set(url, decoded);
      return decoded;
    } catch (error) {
      console.error('Failed to load audio:', url, error);
      return null;
    }
  }

  async function playAudio() {
    const ctx = await initAudioContext();

    stopAudio();

    try {
      const musicUrl = '/assets/audio/music/purrple-cat-field-of-fireflies.mp3';
      const musicBuffer = await loadAudioBuffer(musicUrl);
      if (musicBuffer) {
        currentMusicSource = ctx.createBufferSource();
        currentMusicSource.buffer = musicBuffer;
        currentMusicSource.loop = true;
        currentMusicSource.connect(musicGain);
        currentMusicSource.start(0);
      }
    } catch (error) {
      console.error('Error playing music:', error);
    }

    async function playRandomNarration() {
      if (!isPlaying) return;

      try {
        const randomIndex = Math.floor(Math.random() * narrationClips.length);
        const narrationUrl = narrationClips[randomIndex];
        const narrationBuffer = await loadAudioBuffer(narrationUrl);
        if (narrationBuffer) {
          const now = ctx.currentTime;
          musicGain.gain.setValueAtTime(musicGain.gain.value, now);
          musicGain.gain.linearRampToValueAtTime(0.075, now + 0.3);

          currentNarrationSource = ctx.createBufferSource();
          currentNarrationSource.buffer = narrationBuffer;
          currentNarrationSource.connect(narrationGain);
          currentNarrationSource.start(0);

          const narrationDuration = narrationBuffer.duration;
          musicGain.gain.setValueAtTime(0.075, now + narrationDuration);
          musicGain.gain.linearRampToValueAtTime(musicVol, now + narrationDuration + 0.5);

          currentNarrationSource.onended = () => {
            if (isPlaying) {
              setTimeout(playRandomNarration, 1000);
            }
          };
        }
      } catch (error) {
        console.error('Error playing narration:', error);
      }
    }

    setTimeout(playRandomNarration, 500);

    setTimeout(async () => {
      try {
        const sfxUrl = '/assets/audio/sfx/birth/collect_item_sparkle_pop_13.mp3';
        const sfxBuffer = await loadAudioBuffer(sfxUrl);
        if (sfxBuffer) {
          const playRandomSFX = () => {
            if (!isPlaying) return;

            currentSFXSource = audioContext.createBufferSource();
            currentSFXSource.buffer = sfxBuffer;
            currentSFXSource.connect(sfxGain);
            currentSFXSource.start(0);

            setTimeout(playRandomSFX, 2000 + Math.random() * 1000);
          };
          playRandomSFX();
        }
      } catch (error) {
        console.error('Error playing SFX:', error);
      }
    }, 1000);

    isPlaying = true;
    playBtn.textContent = '⏸ Stop Audio';
  }

  function stopAudio() {
    if (currentMusicSource) {
      try { currentMusicSource.stop(); } catch (e) { }
      currentMusicSource = null;
    }
    if (currentNarrationSource) {
      try { currentNarrationSource.stop(); } catch (e) { }
      currentNarrationSource = null;
    }
    if (currentSFXSource) {
      try { currentSFXSource.stop(); } catch (e) { }
      currentSFXSource = null;
    }
    isPlaying = false;
    playBtn.textContent = '▶ Play Audio';
  }

  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      stopAudio();
    } else {
      playAudio();
    }
  });

  // Volume control updates
  document.getElementById('ctrl-music-vol').addEventListener('input', () => {
    if (musicGain) {
      musicGain.gain.value = parseFloat(document.getElementById('ctrl-music-vol').value);
    }
  });

  document.getElementById('ctrl-narration-vol').addEventListener('input', () => {
    if (narrationGain) {
      narrationGain.gain.value = parseFloat(document.getElementById('ctrl-narration-vol').value);
    }
  });

  document.getElementById('ctrl-sfx-vol').addEventListener('input', () => {
    if (sfxGain) {
      sfxGain.gain.value = parseFloat(document.getElementById('ctrl-sfx-vol').value);
    }
  });

  document.getElementById('ctrl-master-vol').addEventListener('input', () => {
    if (masterGain) {
      masterGain.gain.value = parseFloat(document.getElementById('ctrl-master-vol').value);
    }
  });

  function draw() {
    time += 0.016;
    const W_units = W / dpr;
    const H_units = H / dpr;

    // Background
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, W_units, H_units);

    // Title
    ctx.font = 'bold 13px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText('Signal Flow: Source Nodes → Gain Channels → Master → Output', W_units / 2, 25);

    const boxH = 60;
    const boxW = 100;
    const startY = 50;
    const channelY = startY + 40;

    // Music channel
    drawBox(ctx, 40, channelY, boxW, boxH, 'Music', musicVol, '#a6e3a1');
    drawWaveform(ctx, 55, channelY + 20, 70, 30, time * 2.5, 0.4 * musicVol);

    // Narration channel
    drawBox(ctx, 160, channelY, boxW, boxH, 'Narration', narrationVol, '#89b4fa');
    drawWaveform(ctx, 175, channelY + 20, 70, 30, time * 3.0, 0.5 * narrationVol);

    // SFX channel
    drawBox(ctx, 280, channelY, boxW, boxH, 'SFX', sfxVol, '#f9e2af');
    drawWaveform(ctx, 295, channelY + 20, 70, 30, time * 2.8, 0.3 * sfxVol);

    // Arrows pointing to master
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, channelY + boxH);
    ctx.lineTo(90, channelY + boxH + 30);
    ctx.moveTo(210, channelY + boxH);
    ctx.lineTo(210, channelY + boxH + 30);
    ctx.moveTo(330, channelY + boxH);
    ctx.lineTo(330, channelY + boxH + 30);
    ctx.stroke();

    // Master gain box (centered)
    const masterX = (W_units - boxW) / 2;
    const masterY = channelY + boxH + 40;
    drawBox(ctx, masterX, masterY, boxW, boxH, 'Master', masterVol, '#f93');
    const waveY = masterY + 18;
    const waveH = 32;
    const waveAmp = (musicVol * 0.4 + narrationVol * 0.5 + sfxVol * 0.3) * masterVol;
    drawWaveform(ctx, masterX + 15, waveY, 70, waveH, time * 2.7, waveAmp);

    // Arrow pointing to output
    ctx.beginPath();
    ctx.moveTo(masterX + boxW / 2, masterY + boxH);
    ctx.lineTo(masterX + boxW / 2, masterY + boxH + 25);
    ctx.stroke();

    // Output box
    const outputX = (W_units - 80) / 2;
    const outputY = masterY + boxH + 40;
    drawBox(ctx, outputX, outputY, 80, 50, 'Output', 1.0, '#ccc');

    // Draw animated volume meters
    const meterY = H_units - 80;
    drawMeter(ctx, 40, meterY, 100, musicVol, 'Music\nLevel', '#a6e3a1');
    drawMeter(ctx, 160, meterY, 100, narrationVol, 'Narration\nLevel', '#89b4fa');
    drawMeter(ctx, 280, meterY, 100, sfxVol, 'SFX\nLevel', '#f9e2af');
    drawMeter(ctx, 400, meterY, 100, masterVol, 'Master\nLevel', '#f93');

    requestAnimationFrame(draw);
  }

  function drawBox(ctx, x, y, w, h, label, value, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y, w, h);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + 12);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.fillText(value.toFixed(2), x + w / 2, y + h - 8);
  }

  function drawWaveform(ctx, x, y, w, h, phase, amp) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < w; i++) {
      const px = x + i;
      const val = Math.sin((i / w) * Math.PI * 4 + phase) * (h / 2) * amp;
      if (i === 0) ctx.moveTo(px, y + h / 2);
      else ctx.lineTo(px, y + h / 2 + val);
    }
    ctx.stroke();
  }

  function drawMeter(ctx, x, y, w, value, label, color) {
    const meterH = 40;
    const filledH = meterH * value;

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, y, w / 2, meterH);

    ctx.fillStyle = color;
    ctx.fillRect(x, y + meterH - filledH, w / 2, filledH);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w / 2, meterH);

    ctx.font = '9px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 4, y + meterH + 15);
  }

  draw();
}
