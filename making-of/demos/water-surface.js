// Water Surface Visualizer Module
// WebGL demo - animated water surface mesh with wave animation and lighting

export function init(container) {
  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.className = 'demo-canvas';
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Looking up at water surface from below - view from a fish looking up at the waves above';
  container.appendChild(label);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'demo-controls';
  controls.innerHTML = `
    <label>Wave Speed <input type="range" id="ctrl-ws-speed" min="0" max="2" value="1.0" step="0.05"><span id="val-ws-speed">1.0</span></label>
    <label>Amplitude <input type="range" id="ctrl-ws-amp" min="0" max="3" value="1.0" step="0.05"><span id="val-ws-amp">1.0</span></label>
    <label>Micro Chop <input type="range" id="ctrl-ws-chop" min="0" max="0.5" value="0.18" step="0.01"><span id="val-ws-chop">0.18</span></label>
  `;
  container.appendChild(controls);

  const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
  if (!gl) {
    controls.querySelector('span').textContent = 'WebGL not supported';
    return;
  }

  const extDeriv = gl.getExtension('OES_standard_derivatives');
  gl.getExtension('OES_element_index_uint');

  const state = { speed: 1.0, amplitude: 1.0, chop: 0.18 };

  // Vertex shader: game's exact wave formula
  const vsrc = `
    attribute vec2 a_grid;
    uniform float uTime, uSpeed, uAmplitude, uChop;
    uniform mat4 uProj, uView;
    varying vec3 v_pos;

    void main() {
      vec2 pos = a_grid;
      float speed = 2.0 * uSpeed;
      float scale = 0.12;
      float amp = 3.75 * uAmplitude;

      // Wave 1: along X axis
      float w1 = sin((uTime * speed + pos.x) * scale);
      // Wave 2: along Z axis, different speed/scale
      float w2 = sin((uTime * speed * 0.7 + pos.y) * scale * 1.3);
      // Wave 3: diagonal for extra chop
      float w3 = sin((uTime * speed * 0.5 + pos.x * 0.7 + pos.y * 0.7) * scale * 0.8);

      // Macro motion: broad rolling swells
      float macro = (w1 * 0.5 + w2 * 0.35 + w3 * 0.15) * amp;

      // Micro roughness: high-frequency chop detail (18% of macro amp)
      float microAmp = amp * uChop;
      float microSpeed = speed * 1.15;
      float microScale = scale * 4.0;
      float mA = sin((uTime * microSpeed + pos.x) * microScale) * 0.35;
      float mB = sin((uTime * microSpeed * 1.2 + pos.y + 17.0) * microScale * 1.4) * 0.28;
      float micro = (mA + mB) * microAmp;

      float y = macro + micro;
      v_pos = vec3(pos.x, y, pos.y);
      gl_Position = uProj * uView * vec4(v_pos, 1.0);
    }`;

  // Fragment shader: flat shading via dFdx/dFdy + per-face color variation
  const fsrc = `#extension GL_OES_standard_derivatives : enable
    precision highp float;
    varying vec3 v_pos;
    uniform vec3 uCamPos;

    // Hash for per-face color variation
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      // Flat normal from screen-space derivatives (faceted look)
      vec3 dx = dFdx(v_pos);
      vec3 dy = dFdy(v_pos);
      vec3 N = normalize(cross(dx, dy));

      // Per-TRIANGLE color variation - water surface palette
      float cellSize = 2.0408;
      vec2 cellCoord = (v_pos.xz + 50.0) / cellSize;
      vec2 cellIdx = floor(cellCoord);
      vec2 cellFrac = fract(cellCoord);
      float triHalf = step(1.0, cellFrac.x + cellFrac.y);
      vec2 faceId = cellIdx * 2.0 + vec2(triHalf);
      float h = hash(faceId);
      vec3 waterColor = vec3(
        mix(0.08, 0.22, h),
        mix(0.38, 0.62, fract(h * 7.13)),
        mix(0.48, 0.72, fract(h * 13.71))
      );

      // Light from below - illuminating the underside of the surface
      vec3 lightDir = normalize(vec3(0.2, 0.9, 0.15));
      float NdotL = max(0.0, dot(N, lightDir));

      vec3 V = normalize(uCamPos - v_pos);
      vec3 H = normalize(-lightDir + V);
      float NdotH = max(0.0, dot(-N, H));

      // Glossy wet surface (roughness ~0.15)
      // Fake env map: use normal direction to sample a gradient "sky"
      vec3 Nup = -N; // surface normal pointing up
      vec3 refl = reflect(-V, Nup);
      // Fake environment: bright above, dark at horizon, slight color
      float envY = refl.y * 0.5 + 0.5;
      vec3 envColor = mix(vec3(0.05, 0.12, 0.18), vec3(0.4, 0.6, 0.8), pow(max(0.0, envY), 0.6));

      float spec = pow(NdotH, 180.0);
      float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(Nup, V)), 5.0);

      // Base: dark diffuse (water absorbs light)
      vec3 col = waterColor * (0.08 + NdotL * 0.25);
      // Metallic reflection: blend between dielectric and metallic spec
      // metalness 0.4 means 40% of reflections are tinted by water color
      vec3 F0 = mix(vec3(0.04), waterColor * 0.6, 0.4);
      vec3 specCol = mix(F0, vec3(1.0), fresnel);
      // Environment reflection (this is what makes it look glossy)
      col += envColor * specCol * 0.7;
      // Tight sun specular on top
      col += vec3(0.95, 0.97, 1.0) * spec * 2.5;

      // Distance fade to black
      float dist = length(v_pos - uCamPos);
      float fog = exp(-dist * 0.014);
      col *= fog;

      gl_FragColor = vec4(col, 1.0);
    }`;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('Water shader error:', gl.getShaderInfoLog(s));
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsrc));
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // Build grid mesh (50x50 = 2500 verts, ~5000 tris)
  const N = 50, extent = 50.0;
  const verts = [], indices = [];
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++)
      verts.push((x/(N-1) - 0.5) * extent * 2, (z/(N-1) - 0.5) * extent * 2);

  for (let z = 0; z < N-1; z++)
    for (let x = 0; x < N-1; x++) {
      const i = z * N + x;
      indices.push(i, i+1, i+N, i+1, i+N+1, i+N);
    }

  const vBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  const iBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  const triCount = indices.length;

  const aGrid = gl.getAttribLocation(prog, 'a_grid');
  gl.enableVertexAttribArray(aGrid);
  gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uSpeed = gl.getUniformLocation(prog, 'uSpeed');
  const uAmplitude = gl.getUniformLocation(prog, 'uAmplitude');
  const uChop = gl.getUniformLocation(prog, 'uChop');
  const uProj = gl.getUniformLocation(prog, 'uProj');
  const uView = gl.getUniformLocation(prog, 'uView');
  const uCamPos = gl.getUniformLocation(prog, 'uCamPos');

  // Matrix math utilities
  function perspective(fov, asp, near, far) {
    const f = 1/Math.tan(fov/2), nf = 1/(near-far);
    return new Float32Array([f/asp,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  }

  function sub(a,b) {
    return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  }

  function cross(a,b) {
    return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  }

  function dot(a,b) {
    return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  }

  function norm(v) {
    const l=Math.sqrt(dot(v,v));
    return [v[0]/l,v[1]/l,v[2]/l];
  }

  function lookAt(eye,tgt,up) {
    const z=norm(sub(eye,tgt)),x=norm(cross(up,z)),y=cross(z,x);
    return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
  }

  function resize() {
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    canvas.width = w*dpr;
    canvas.height = h*dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  resize();
  window.addEventListener('resize', resize);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  let t0 = performance.now();
  let prevTime = 0;

  function frame() {
    const elapsed = (performance.now() - t0) * 0.001;
    const deltaTime = elapsed - prevTime;
    prevTime = elapsed;

    // Time accumulation with smooth speed scaling
    if (!window.waveTime) window.waveTime = 0;
    window.waveTime += deltaTime * state.speed;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog);

    // Static camera looking UP from underneath the water surface
    const eye = [0, -12, 0];
    const target = [0, 8, 0];
    const up = [0, 0, 1];

    gl.uniformMatrix4fv(uProj, false, perspective(1.0, canvas.width/canvas.height, 0.5, 200));
    gl.uniformMatrix4fv(uView, false, lookAt(eye, target, up));
    gl.uniform3f(uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform1f(uTime, window.waveTime);
    gl.uniform1f(uSpeed, state.speed);
    gl.uniform1f(uAmplitude, state.amplitude);
    gl.uniform1f(uChop, state.chop);

    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    gl.drawElements(gl.TRIANGLES, triCount, gl.UNSIGNED_INT, 0);
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

  ctrl('ctrl-ws-speed','speed');
  ctrl('ctrl-ws-amp','amplitude');
  ctrl('ctrl-ws-chop','chop');
}
