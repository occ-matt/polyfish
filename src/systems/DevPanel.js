/**
 * Dev Panel System
 * Builds and manages the developer UI shown when ?dev=true
 */

import GS from '../core/GameState.js';

export function buildDevPanel(context) {
  const { modeManager, modeContext } = context;

  const panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = `
    position: fixed; top: 12px; left: 12px; z-index: 10000;
    display: flex; flex-direction: column; gap: 6px;
    pointer-events: none;
  `;

  // Move perf overlay inside the dev panel so they stack nicely
  const perfEl = document.getElementById('perf-overlay');
  if (perfEl) {
    perfEl.style.position = 'static';
    perfEl.style.top = '';
    perfEl.style.left = '';
    panel.appendChild(perfEl);
  }

  // Dev links container
  const links = document.createElement('div');
  links.style.cssText = `
    background: rgba(0, 0, 0, 0.75);
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid rgba(0, 255, 0, 0.2);
    font-family: 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.8;
    pointer-events: auto;
  `;

  const modes = [
    { key: '1', label: 'Narrative', mode: 'narrative' },
    { key: '2', label: 'Model Viewer', mode: 'model-viewer' },
    { key: '3', label: 'Editor', mode: 'editor' },
  ];

  const header = document.createElement('div');
  header.style.cssText = 'color: #0f0; margin-bottom: 2px; opacity: 0.6;';
  header.textContent = '-- DEV MODE --';
  links.appendChild(header);

  modes.forEach(({ key, label, mode }) => {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = `[${key}] ${label}`;
    a.style.cssText = `
      display: block; color: #0f0; text-decoration: none;
      opacity: 0.8; cursor: pointer;
    `;
    a.addEventListener('mouseenter', () => { a.style.opacity = '1'; a.style.textDecoration = 'underline'; });
    a.addEventListener('mouseleave', () => { a.style.opacity = '0.8'; a.style.textDecoration = 'none'; });
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (modeManager) modeManager.switchMode(mode, modeContext);
    });
    links.appendChild(a);
  });

  // Standalone test scenes (open in new tab to avoid pointer-lock conflicts)
  const separator = document.createElement('div');
  separator.style.cssText = 'border-top: 1px solid rgba(0,255,0,0.15); margin: 6px 0 4px;';
  links.appendChild(separator);

  const testPages = [
    { label: 'Verlet Test', href: '/test-verlet.html' },
    { label: 'Animation Viewer', href: '/model-viewer.html' },
    { label: 'God Rays Test', href: '/test-godrays.html' },
  ];
  testPages.forEach(({ label, href }) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `→ ${label}`;
    a.style.cssText = `
      display: block; color: #0f0; text-decoration: none;
      opacity: 0.8; cursor: pointer;
    `;
    a.addEventListener('mouseenter', () => { a.style.opacity = '1'; a.style.textDecoration = 'underline'; });
    a.addEventListener('mouseleave', () => { a.style.opacity = '0.8'; a.style.textDecoration = 'none'; });
    links.appendChild(a);
  });

  // Shortcut hints
  const hints = document.createElement('div');
  hints.style.cssText = 'color: #0f0; margin-top: 4px; opacity: 0.45; font-size: 10px;';
  hints.innerHTML = '` debug &nbsp; +/= timescale';
  links.appendChild(hints);

  panel.appendChild(links);

  // ── God Ray Controls (collapsible) ──
  const grPanel = document.createElement('div');
  grPanel.style.cssText = `
    background: rgba(0, 0, 0, 0.75);
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid rgba(0, 255, 0, 0.2);
    font-family: 'Courier New', monospace;
    font-size: 11px;
    pointer-events: auto;
  `;

  const grToggle = document.createElement('a');
  grToggle.href = '#';
  grToggle.textContent = '+ God Rays';
  grToggle.style.cssText = 'color: #0f0; text-decoration: none; opacity: 0.8; cursor: pointer; display: block;';
  grToggle.addEventListener('mouseenter', () => { grToggle.style.opacity = '1'; });
  grToggle.addEventListener('mouseleave', () => { grToggle.style.opacity = '0.8'; });
  grPanel.appendChild(grToggle);

  const grBody = document.createElement('div');
  grBody.style.cssText = 'display: none; margin-top: 6px;';
  grPanel.appendChild(grBody);

  let grOpen = false;
  grToggle.addEventListener('click', (e) => {
    e.preventDefault();
    grOpen = !grOpen;
    grBody.style.display = grOpen ? 'block' : 'none';
    grToggle.textContent = (grOpen ? '- ' : '+ ') + 'God Rays';
  });

  const grSliders = [
    { label: 'intensity',  uniform: 'uIntensity',  min: 0, max: 3,   step: 0.05, def: 1.05 },
    { label: 'density',    uniform: 'uDensity',    min: 0, max: 1,   step: 0.05, def: 0.3  },
    { label: 'beamScale',  uniform: 'uBeamScale',  min: 0.01, max: 1, step: 0.01, def: 0.22 },
    { label: 'tilt',       uniform: 'uTilt',       min: 0, max: 1,   step: 0.01, def: 0.42 },
    { label: 'floorReach', uniform: 'uFloorReach', min: 0, max: 1,   step: 0.01, def: 0.06 },
    { label: 'smoothK',    uniform: 'uSmoothK',    min: 0.05, max: 4, step: 0.05, def: 0.4 },
    { label: 'animSpeed',  uniform: 'uAnimSpeed',  min: 0, max: 5,   step: 0.1,  def: 3.38 },
  ];

  grSliders.forEach(({ label, uniform, min, max, step, def }) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 4px; margin: 3px 0;';

    const lbl = document.createElement('span');
    lbl.style.cssText = 'color: #0f0; opacity: 0.7; width: 72px; font-size: 10px;';
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.style.cssText = 'width: 100px; accent-color: #0f0; height: 12px;';

    const val = document.createElement('span');
    val.style.cssText = 'color: #0f0; opacity: 0.8; width: 36px; text-align: right; font-size: 10px;';

    // Read current value from the renderer if available, otherwise use default
    const gr = GS.godRayRenderer;
    const current = gr ? gr.material.uniforms[uniform].value : def;
    slider.value = current;
    val.textContent = Number(current).toFixed(2);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(2);
      const renderer = GS.godRayRenderer;
      if (renderer) renderer.material.uniforms[uniform].value = v;
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    grBody.appendChild(row);
  });

  panel.appendChild(grPanel);

  document.body.appendChild(panel);
}
