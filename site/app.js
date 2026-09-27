// The download page's small helpers. The page works fully without them.
//   1. Not on a Mac: say so plainly, with the Linux route.
//   2. A likely chip: if the graphics card name gives it away (Chrome shows
//      "Apple M…", or "Intel"), point at that download. Safari hides it; then
//      nothing is guessed and the button stays on Apple Silicon, the Mac most
//      people have, with Intel one link away.
//   3. The latest version and its size, asked of GitHub once. If that fails,
//      the page keeps its fallback line.
//   4. A Copy button for the Terminal line.
//   5. Videos play by themselves, silently, while they're on screen, and pause
//      when scrolled away. Pausing one yourself keeps it paused. Not when the
//      Mac asks for reduced motion.

(() => {
  const $ = (id) => document.getElementById(id);
  const ua = navigator.userAgent || '';
  // iPadOS Safari says "Macintosh", so an iPad is a "Mac" with a touch screen.
  const isPhone = /iPhone|iPad|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isMac = /Macintosh|Mac OS X/.test(ua) && !isPhone;
  let chip = null;

  if (!isMac) {
    if (isPhone) {
      $('not-mac').textContent = "You're on a phone or tablet. Six Degrees is a Mac app: open this page on your Mac to download it.";
    }
    $('not-mac').hidden = false;
  } else {
    chip = guessChip();
    if (chip === 'intel') {
      // The main button becomes Intel's; the link offers Apple Silicon.
      const main = $('dl-main');
      const alt = $('dl-alt');
      [main.href, alt.href] = [alt.href, main.href];
      $('dl-main-sub').textContent = 'Intel · for this Mac';
      $('dl-alt-label').textContent = 'Apple Silicon Mac?';
      alt.textContent = 'Download for Apple Silicon';
    } else if (chip === 'silicon') {
      $('dl-main-sub').textContent = 'Apple Silicon · for this Mac';
    }
  }

  function guessChip() {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      if (/Apple M\d/.test(name)) return 'silicon';
      if (/Intel|AMD|Radeon/.test(name)) return 'intel';
    } catch { /* no WebGL: no guess */ }
    return null;
  }

  fetch('https://api.github.com/repos/blakeb056/six-degrees/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((release) => {
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (!version) return;
      const mb = (name) => {
        const a = (release.assets || []).find((x) => x.name === name);
        return a ? Math.round(a.size / 1e6) : null;
      };
      const silicon = mb('Six-Degrees-Mac-Apple-Silicon.dmg');
      const intel = mb('Six-Degrees-Mac-Intel.dmg');
      // The size of the download this Mac needs, when we know which; else both.
      let size = '';
      if (chip === 'silicon' && silicon) size = ` · ${silicon} MB`;
      else if (chip === 'intel' && intel) size = ` · ${intel} MB`;
      else if (silicon && intel) size = ` · ${silicon} MB (Apple Silicon), ${intel} MB (Intel)`;
      $('version-line').textContent = `Version ${version} · macOS 13.5 or later${size} · free and open source`;
    })
    .catch(() => { /* keep the fallback line */ });

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const { target: v, isIntersecting, intersectionRatio } of entries) {
        if (isIntersecting && intersectionRatio >= 0.5) {
          if (v.paused && !v.ended && !v.dataset.userPaused) v.play().catch(() => { /* the browser said no: controls still work */ });
        } else if (!v.paused) {
          v.dataset.autoPaused = '1';
          v.pause();
        }
      }
    }, { threshold: [0, 0.5] });
    for (const v of document.querySelectorAll('figure.video video')) {
      v.muted = true; // playing by itself needs it, and the videos are silent anyway
      v.addEventListener('pause', () => {
        if (!v.dataset.autoPaused && !v.ended) v.dataset.userPaused = '1';
        delete v.dataset.autoPaused;
      });
      v.addEventListener('play', () => { delete v.dataset.userPaused; });
      seen.observe(v);
    }
  }

  const copy = $('copy');
  copy.addEventListener('click', async () => {
    const text = $('cmd').textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      $('copy-status').textContent = 'Install command copied.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('cmd'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copy.textContent = 'Press ⌘C';
      $('copy-status').textContent = 'Install command selected. Press Command C to copy it.';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
  });
})();
