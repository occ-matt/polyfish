// Camera Cinematographer Flow - Camera operator layer visualization
// Shows the pipeline: Subject -> Compute Framing -> Smooth -> Look At

export function init(container) {
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'demo-cinematographer-flow';
  canvas.width = 800;
  canvas.height = 220;
  container.appendChild(canvas);

  // Create label
  const label = document.createElement('div');
  label.className = 'demo-label';
  label.textContent = 'Cinematographer Pipeline - Subject → Compute Framing → Smooth → Look At';
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

    // Draw subject (creature)
    const subjectX = 80;
    const subjectY = 110;
    ctx.fillStyle = 'rgba(100, 220, 100, 0.7)';
    ctx.beginPath();
    ctx.arc(subjectX, subjectY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('Subject', subjectX, subjectY + 25);

    // Draw camera positions
    const positions = [
      { label: 'Compute', x: 200, offset: 40 },
      { label: 'Smooth', x: 350, offset: 0 },
      { label: 'Finalize', x: 500, offset: -40 }
    ];

    ctx.strokeStyle = 'rgba(255, 150, 100, 0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];

      // Draw dashed line from subject to camera
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(subjectX, subjectY);
      ctx.lineTo(pos.x, subjectY + pos.offset);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw camera
      ctx.fillStyle = 'rgba(150, 200, 255, 0.8)';
      ctx.fillRect(pos.x - 12, subjectY + pos.offset - 12, 24, 24);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pos.x - 12, subjectY + pos.offset - 12, 24, 24);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '9px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText(pos.label, pos.x, subjectY + pos.offset + 30);
    }

    // Draw flow direction
    ctx.fillStyle = 'rgba(255, 200, 100, 0.7)';
    ctx.font = '10px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText('Framing Computation Pipeline', canvas.width / 2, 35);

    // Show damping effect
    const dampingAmount = Math.sin(elapsed * 2) * 20 + 20;
    ctx.fillStyle = 'rgba(255, 200, 100, 0.6)';
    ctx.font = '10px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText(`Damping: ${dampingAmount.toFixed(0)}% velocity`, 20, canvas.height - 20);

    animationId = requestAnimationFrame(animate);
  }

  animate();

  return () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  };
}
