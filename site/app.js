// The download page's small helpers. The page works fully without them.
//   1. Not on a Mac: say so plainly, with the Linux route.
//   2. A likely chip: if the graphics card name gives it away (Chrome shows
//      "Apple M…", or "Intel"), point at that download. Safari hides it; then
//      nothing is guessed and both buttons stay equal.
//   3. The latest version and its size, asked of GitHub once. If that fails,
//      the page keeps its fallback line.
//   4. A Copy button for the Terminal line.

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
    if (chip) {
      const pick = chip === 'silicon' ? $('dl-silicon') : $('dl-intel');
      pick.classList.add('suggested');
      $('chip-guess').textContent = chip === 'silicon'
        ? 'This looks like an Apple Silicon Mac: take the Apple Silicon download.'
        : 'This looks like an Intel Mac: take the Intel download.';
      $('chip-guess').hidden = false;
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
