// Camera Scout Scores - Interest scoring for dramatic moments
// Visualizes behavior scoring: Idle (1) -> Hunting (10)

export function init(container) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-scout-scores';
  canvas.width = 800;
  canvas.height = 220;
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Ecosystem Scout - interest scoring for dramatic moments';
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

  function animate() {
    const now = Date.now();
    const elapsed = (now - startTime) * 0.001;

    ctx.fillStyle = 'rgba(10, 22, 40, 1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const behaviors = [
      { label: 'Idle', score: 1, color: 'rgba(100, 150, 200, 0.7)' },
      { label: 'Clustering', score: 3, color: 'rgba(150, 200, 100, 0.7)' },
      { label: 'Fleeing', score: 5, color: 'rgba(255, 200, 50, 0.7)' },
      { label: 'Reproducing', score: 7, color: 'rgba(255, 150, 100, 0.7)' },
      { label: 'Hunting', score: 9, color: 'rgba(255, 100, 100, 0.7)' }
    ];

    const barX = 60;
    const barTop = 50;
    const barHeight = 120;
    const spacing = (canvas.width - 100) / behaviors.length;

    ctx.font = 'bold 11px JetBrains Mono';
    ctx.textAlign = 'center';

    for (let i = 0; i < behaviors.length; i++) {
      const behavior = behaviors[i];
      const x = barX + spacing * i + spacing * 0.1;
      const height = (behavior.score / 10) * barHeight;
      const y = barTop + barHeight - height;

      // Draw bar
      ctx.fillStyle = behavior.color;
      ctx.fillRect(x, y, spacing * 0.8, height);

      // Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, spacing * 0.8, height);

      // Score label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = 'bold 10px JetBrains Mono';
      ctx.fillText(behavior.score, x + spacing * 0.4, y - 8);

      // Behavior label
      ctx.font = '9px JetBrains Mono';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(behavior.label, x + spacing * 0.4, barTop + barHeight + 20);
    }

    // Draw baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX - 10, barTop + barHeight);
    ctx.lineTo(canvas.width - 20, barTop + barHeight);
    ctx.stroke();

    // Title
    ctx.font = 'bold 12px JetBrains Mono';
    ctx.fillStyle = 'rgba(255, 200, 100, 1)';
    ctx.textAlign = 'center';
    ctx.fillText('Interest Scoring by Behavior', canvas.width / 2, 30);

    animationId = requestAnimationFrame(animate);
  }

  animate();

  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  };
}
