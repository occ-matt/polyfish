// Shared nav component  -  injected by each page
// Usage: <script src="nav.js"></script> will auto-inject nav

(function() {
  const pages = [
    { href: 'index.html', label: 'Home' },
    { href: 'kelp.html', label: 'Kelp' },
    { href: 'creatures.html', label: 'Creatures' },
    { href: 'camera.html', label: 'Camera' },
    { href: 'rendering.html', label: 'Rendering' },
    { href: 'ecosystem.html', label: 'Ecosystem' },
    { href: 'audio.html', label: 'Audio' },
  ];

  const current = window.location.pathname.split('/').pop() || 'index.html';

  const links = pages.map(p =>
    `<a href="${p.href}"${p.href === current ? ' class="active"' : ''}>${p.label}</a>`
  ).join('\n      ');

  const html = `
<nav>
  <div class="nav-inner">
    <a href="index.html" class="nav-logo">Making of <span>PolyFish</span></a>
    <button class="nav-toggle" onclick="document.querySelector('.nav-links').classList.toggle('open')" aria-label="Menu">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
    </button>
    <div class="nav-links">
      ${links}
      <a href="/" class="nav-play">Play PolyFish</a>
    </div>
  </div>
</nav>`;

  // Insert at start of body
  document.body.insertAdjacentHTML('afterbegin', html);
})();
