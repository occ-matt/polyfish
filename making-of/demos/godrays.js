// God Ray Visualizer Module
// WebGL demo - screen-space volumetric god rays with domain warping

export function init(container) {
  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.className = 'demo-canvas';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Screen-space volumetric god rays - tilted beams with per-beam depth staggering';
  container.appendChild(label);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Intensity <input type="range" id="ctrl-gr-intensity" min="0.1" max="1.5" value="0.7" step="0.05"><span id="val-gr-intensity">0.7</span></label>
    <label>Beam Scale <input type="range" id="ctrl-gr-scale" min="0.03" max="0.25" value="0.12" step="0.01"><span id="val-gr-scale">0.12</span></label>
    <label>Tilt <input type="range" id="ctrl-gr-tilt" min="0" max="0.5" value="0.25" step="0.01"><span id="val-gr-tilt">0.25</span></label>
    <label>Floor Reach <input type="range" id="ctrl-gr-reach" min="0" max="1" value="0.35" step="0.05"><span id="val-gr-reach">0.35</span></label>
    <label>Breakup <input type="range" id="ctrl-gr-breakup" min="0" max="1" value="0.55" step="0.05"><span id="val-gr-breakup">0.55</span></label>
  `;
  container.appendChild(controls);

  const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) {
    controls.querySelector('span').textContent = 'WebGL not supported';
    return;
  }

  // State
  const state = { intensity: 0.7, beamScale: 0.12, tilt: 0.25, floorReach: 0.35, breakup: 0.55 };

  const vsrc = `attribute vec2 a_pos; varying vec2 v_uv;
    void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0, 1); }`;

  const fsrc = `precision highp float;
    varying vec2 v_uv;
    uniform float uTime, uIntensity, uBeamScale, uTilt, uFloorReach, uBreakup;
    uniform vec2 uRes;

    vec2 grHash(vec2 p) {
      return vec2(fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453),
                  fract(sin(dot(p, vec2(269.5,183.3)))*43758.5453));
    }

    float grNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      float a = fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453);
      float b = fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
      float c = fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453);
      float d = fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
    }

    vec3 beamInfo(vec2 uv, float time) {
      float ws = time * 0.08;
      vec2 w1 = vec2(grNoise(uv*0.35+ws), grNoise(uv*0.35+vec2(7.3,2.8)+ws*0.9));
      vec2 w2 = vec2(grNoise(uv*0.7+vec2(3.1,5.9)+ws*1.3), grNoise(uv*0.7+vec2(11.4,8.2)+ws*0.7));
      uv += (w1-0.5)*1.1 + (w2-0.5)*0.4;
      vec2 id = floor(uv), p = fract(uv)-0.5;
      float md = 1.0; vec2 nc = vec2(0.0);
      for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
        vec2 nb = vec2(float(x),float(y)), cid = id+nb;
        vec2 off = grHash(cid);
        off = 0.5 + 0.45*sin(6.2831*off);
        float d = length(nb+off-p);
        if(d<md){md=d; nc=cid;}
      }
      float beam = 1.0-smoothstep(0.0,0.9,md); beam*=beam;
      float reach = fract(sin(dot(nc,vec2(53.7,91.3)))*43758.5453);
      reach = reach*reach*reach;
      return vec3(beam, reach, 0.0);
    }

    float breakup(vec2 xz, float t) {
      float n1 = grNoise(xz*0.7+t*0.06);
      float n2 = grNoise(xz*1.4+vec2(4.7,1.3)+t*0.04);
      return smoothstep(0.2, 0.55, n1*0.65+n2*0.35);
    }

    void main() {
      // Side view: Y=0 is top (surface), Y=1 is bottom (floor)
      float flipY = 1.0 - v_uv.y;
      float surfaceY = 8.0;
      float floorY = -2.0;

      float worldX = (v_uv.x - 0.5) * 40.0;
      float worldZ = (v_uv.x - 0.5) * 10.0 + 5.0;
      float worldY = mix(surfaceY, floorY, flipY);
      float depth = max(0.0, surfaceY - worldY);

      // Tilted beam lookup
      float t = uTime * 0.4;
      vec2 tiltDir = vec2(uTilt, uTilt * 0.5);
      vec2 sampleUV = (vec2(worldX, worldZ) + depth * tiltDir) * uBeamScale;
      vec3 info = beamInfo(sampleUV, t);
      float pattern = info.x;
      float depthReach = info.y;

      float fadeHL = mix(1.5, mix(2.0,16.0,uFloorReach), depthReach);
      float heightFade = exp(-depth / fadeHL);

      vec2 tiltedXZ = vec2(worldX, worldZ) + depth * tiltDir;
      float bk = breakup(tiltedXZ, t);
      pattern *= mix(1.0, mix(0.45, 1.0, bk), uBreakup);

      // Soft-clamp to prevent harsh overlapping beam edges
      float accum = pattern * heightFade * uIntensity;
      accum = 1.0 - exp(-accum * 1.8);

      // Background gradient: lighter near surface (top), darker at depth (bottom)
      vec3 bgDeep = vec3(0.02, 0.06, 0.14);
      vec3 bgShallow = vec3(0.08, 0.22, 0.38);
      vec3 bg = mix(bgShallow, bgDeep, flipY);

      // Seafloor hint at the very bottom of screen
      float floorZone = smoothstep(0.85, 1.0, flipY);
      vec3 floorColor = vec3(0.18, 0.35, 0.40) * floorZone;

      vec3 rayColor = vec3(0.55, 0.78, 1.0) * accum;
      vec3 col = bg + floorColor + rayColor;

      // Surface bright line at top
      float surfLine = 1.0 - smoothstep(0.0, 0.025, flipY);
      col += vec3(0.15, 0.25, 0.3) * surfLine;

      gl_FragColor = vec4(col, 1.0);
    }`;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsrc));
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uIntensity = gl.getUniformLocation(prog, 'uIntensity');
  const uBeamScale = gl.getUniformLocation(prog, 'uBeamScale');
  const uTilt = gl.getUniformLocation(prog, 'uTilt');
  const uFloorReach = gl.getUniformLocation(prog, 'uFloorReach');
  const uBreakup = gl.getUniformLocation(prog, 'uBreakup');
  const uRes = gl.getUniformLocation(prog, 'uRes');

  function resize() {
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  resize();
  window.addEventListener('resize', resize);

  let startTime = performance.now();
  function frame() {
    const t = (performance.now() - startTime) * 0.001;
    gl.useProgram(prog);
    gl.uniform1f(uTime, t);
    gl.uniform1f(uIntensity, state.intensity);
    gl.uniform1f(uBeamScale, state.beamScale);
    gl.uniform1f(uTilt, state.tilt);
    gl.uniform1f(uFloorReach, state.floorReach);
    gl.uniform1f(uBreakup, state.breakup);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }

  frame();

  // Set up controls
  function ctrl(id, key) {
    const input = controls.querySelector(`#${id}`);
    const valSpan = controls.querySelector(`#${id.replace('ctrl-','val-')}`);
    if (input && valSpan) {
      input.addEventListener('input', function(e) {
        state[key] = parseFloat(e.target.value);
        valSpan.textContent = e.target.value;
      });
    }
  }

  ctrl('ctrl-gr-intensity','intensity');
  ctrl('ctrl-gr-scale','beamScale');
  ctrl('ctrl-gr-tilt','tilt');
  ctrl('ctrl-gr-reach','floorReach');
  ctrl('ctrl-gr-breakup','breakup');
}
