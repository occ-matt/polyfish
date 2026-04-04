// Shared nav component  -  injected by each page
// Usage: <script src="nav.js"></script> will auto-inject nav

(function() {
  const pages = [
    { href: '/making-of/index.html', label: 'Home' },
    { href: '/making-of/kelp.html', label: 'Kelp' },
    { href: '/making-of/creatures.html', label: 'Creatures' },
    { href: '/making-of/camera.html', label: 'Camera' },
    { href: '/making-of/rendering.html', label: 'Rendering' },
    { href: '/making-of/ecosystem.html', label: 'Ecosystem' },
    { href: '/making-of/audio.html', label: 'Audio' },
  ];

  const current = window.location.pathname;

  const links = pages.map(p =>
    `<a href="${p.href}"${p.href === current ? ' class="active"' : ''}>${p.label}</a>`
  ).join('\n      ');

  const html = `
<nav>
  <div class="nav-inner">
    <a href="/making-of/index.html" class="nav-logo">Making of <span>PolyFish</span></a>
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
