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
  const isMac = /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) && navigator.maxTouchPoints <= 1;

  if (!isMac) {
    $('not-mac').hidden = false;
  } else {
    const chip = guessChip();
    if (chip) {
      const pick = chip === 'silicon' ? $('dl-silicon') : $('dl-intel');
      pick.classList.add('suggested');
      $('chip-guess').textContent = chip === 'silicon'
        ? 'This looks like an Apple Silicon Mac: the green button is yours.'
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
      const asset = (release.assets || []).find((a) => a.name === 'Six-Degrees-Mac-Apple-Silicon.dmg');
      if (!version) return;
      const size = asset ? ` · ${Math.round(asset.size / 1e6)} MB` : '';
      $('version-line').textContent = `Version ${version} · macOS 13.5 or later${size} · free and open source`;
    })
    .catch(() => { /* keep the fallback line */ });

  const copy = $('copy');
  copy.addEventListener('click', async () => {
    const text = $('cmd').textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('cmd'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copy.textContent = 'Press ⌘C';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
  });
})();
