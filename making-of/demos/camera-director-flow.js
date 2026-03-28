// Camera Director Flow - Documentary director layer visualization
// Shows the flow: Phase -> Shot Pool -> Sample -> Duration -> Execute

export function init(container) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-director-flow';
  canvas.width = 800;
  canvas.height = 220;
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Documentary Director Flow - Phase → Shot Pool → Sample → Execute';
  container.appendChild(label);

  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 220;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let startTime = Date.now();
  let animationId;

  function drawBox(x, y, w, h, label, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  function animate() {
    const now = Date.now();
    const elapsed = (now - startTime) * 0.001;

    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const y = 110;
    const h = 50;
    const spacing = canvas.width / 5;

    const steps = [
      { label: 'Phase', color: 'rgba(100, 180, 255, 0.8)' },
      { label: 'Shot Pool', color: 'rgba(150, 180, 255, 0.8)' },
      { label: 'Sample', color: 'rgba(180, 150, 255, 0.8)' },
      { label: 'Duration', color: 'rgba(200, 150, 200, 0.8)' },
      { label: 'Execute', color: 'rgba(255, 150, 100, 0.8)' }
    ];

    for (let i = 0; i < steps.length; i++) {
      const x = spacing * i + spacing * 0.1;
      drawBox(x, y - h / 2, spacing * 0.8, h, steps[i].label, steps[i].color);

      if (i < steps.length - 1) {
        const x1 = x + spacing * 0.8;
        const x2 = spacing * (i + 1) + spacing * 0.1;
        const cy = y;

        ctx.strokeStyle = 'rgba(255, 200, 100, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, cy);
        ctx.lineTo(x2, cy);
        ctx.stroke();

        // Arrowhead
        ctx.fillStyle = 'rgba(255, 200, 100, 0.6)';
        ctx.beginPath();
        ctx.moveTo(x2, cy);
        ctx.lineTo(x2 - 8, cy - 4);
        ctx.lineTo(x2 - 8, cy + 4);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Show phase indicator
    const phases = ['ESTABLISHING', 'INTRODUCE', 'DEVELOP', 'CLIMAX', 'RESOLVE'];
    const phaseIdx = Math.floor((elapsed / 2) % phases.length);
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = 'rgba(255, 200, 100, 1)';
    ctx.textAlign = 'left';
    ctx.fillText('Phase: ' + phases[phaseIdx], 20, 40);

    animationId = requestAnimationFrame(animate);
  }

  animate();

  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  };
}
