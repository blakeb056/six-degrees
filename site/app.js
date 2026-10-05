// The website's small helpers, on every page. Each page works fully without them.
//   0. Old links to parts of the home page that moved (/#install, /#faq…) go
//      to their new pages.
//   1. The download button for this computer: the Mac download on a Mac (with a
//      guess at the chip), and on Linux or Windows that platform's dimmed
//      "Coming soon" button, with the way to run it today where there is one.
//      A Mac download, once clicked, shows the steps to allow it once.
//   2. The latest version and download sizes, and on /about/ the number of
//      stars, asked of GitHub. If that fails, the page keeps its fallback lines.
//   3. Copy buttons for the Terminal lines.
//   4. Videos play by themselves, silently, while they're on screen, and pause
//      when scrolled away. Pausing one yourself keeps it paused. Not when the
//      computer asks for reduced motion.
//   5. The charts grow in, and the home page's sections fade in, as they come on
//      screen (CSS does it, and skips it for reduced motion).

// Downloads that aren't built yet show as dimmed "Coming soon" buttons, which
// aren't links and do nothing. THE SWITCH: to turn one on, put its file's address
// here. That one line makes every "Coming soon" button for that platform a real
// download (index.html's data-soon="linux" / data-soon="windows" buttons), and
// hides the "Coming soon" notes beside them (data-when-soon).
// Windows and Linux are a beta (docs/brain/DESKTOP.md D3), so their files are on
// that pre-release, not on releases/latest (which skips pre-releases). Once
// they're promoted to a full release, point these at releases/latest/download/.
const DOWNLOADS = {
  linux: 'https://github.com/blakeb056/six-degrees/releases/download/v0.5.1-beta.1/Six-Degrees-Linux-x64.deb',
  windows: 'https://github.com/blakeb056/six-degrees/releases/download/v0.5.1-beta.1/Six-Degrees-Windows-Setup.exe',
};

(() => {
  const $ = (id) => document.getElementById(id);
  const all = (sel) => [...document.querySelectorAll(sel)];
  document.documentElement.classList.add('js');

  // 0. The home page used to hold the install guide, the FAQ and the news.
  const MOVED = {
    '#install': '/download/#install', '#linux': '/download/#linux', '#download': '/download/',
    '#faq': '/docs/#faq', '#network': '/docs/#get-started', '#export': '/docs/#export',
    '#scanning': '/docs/#scanning', '#news': '/releases/', '#what': '#features', '#docs': '/docs/',
    '#community': '/about/#open', '#licence': '/about/#open', '#start': '/docs/#get-started',
  };
  if (location.pathname === '/' && MOVED[location.hash] && !document.getElementById(location.hash.slice(1))) {
    location.replace(MOVED[location.hash]);
    return;
  }

  // 1. Which computer is this?
  const ua = navigator.userAgent || '';
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  // iPadOS Safari says "Macintosh", so an iPad is a "Mac" with a touch screen.
  const isPhone = /iPhone|iPad|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  let os = 'other';
  if (isPhone) os = 'phone';
  else if (/Win/i.test(platform) || /Windows/.test(ua)) os = 'windows';
  else if (/Mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua)) os = 'mac';
  else if (!/CrOS/.test(ua) && /Linux|X11/i.test(platform + ' ' + ua)) os = 'linux';

  for (const [key, url] of Object.entries(DOWNLOADS)) if (url) turnOn(key, url);

  // The hero shows the button for this computer; the Mac one is the default.
  if (os === 'linux' || os === 'windows') {
    for (const el of all('.hero [data-for]')) el.hidden = el.dataset.for !== os;
  }
  const note = $('not-mac');
  if (note && (os === 'phone' || os === 'other')) {
    if (os === 'phone') {
      note.textContent = "You're on a phone or tablet. Sixgree runs on a computer: open this page on your Mac to download it.";
    }
    note.hidden = false;
  }

  let chip = null;
  if (os === 'mac' && $('dl-main')) {
    chip = guessChip();
    if (chip === 'intel') {
      // The main button becomes Intel's; the link offers Apple Silicon.
      const main = $('dl-main');
      const alt = $('dl-alt');
      [main.href, alt.href] = [alt.href, main.href];
      $('dl-main-sub').textContent = 'Free · Intel · for this Mac';
      $('dl-alt-label').textContent = 'Apple Silicon Mac?';
      alt.textContent = 'Download for Apple Silicon';
    } else if (chip === 'silicon') {
      $('dl-main-sub').textContent = 'Free · Apple Silicon · for this Mac';
    }
  }

  // Once a Mac download starts, what to do with the file, under the button:
  // drag it to Applications and open it (signed and notarized, so no Open
  // Anyway step since D4). The click still downloads; this only shows them.
  const after = $('after-dl');
  if (after) {
    for (const link of [$('dl-main'), $('dl-alt')]) {
      if (!link) continue;
      link.addEventListener('click', () => {
        const first = after.hidden;
        after.hidden = false;
        if (!first) return;
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        after.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
        after.focus({ preventScroll: true });
      });
    }
  }

  // A graphics card name gives the chip away in Chrome ("Apple M…", or
  // "Intel"). Safari hides it; then nothing is guessed and the button stays on
  // Apple Silicon, the Mac most people have, with Intel one link away.
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

  // A dimmed "Coming soon" button becomes a download link, keeping its look.
  function turnOn(key, url) {
    for (const button of all(`[data-soon="${key}"]`)) {
      const link = document.createElement('a');
      link.className = button.className.replace(/\bis-soon\b/, '').trim();
      link.classList.add('primary');
      link.href = url;
      link.append(...button.childNodes);
      const title = link.querySelector('.dl-title');
      const sub = link.querySelector('.dl-sub');
      if (title && button.dataset.readyTitle) title.textContent = button.dataset.readyTitle;
      if (sub && button.dataset.readySub) sub.textContent = button.dataset.readySub;
      button.replaceWith(link);
    }
    for (const el of all(`[data-when-soon="${key}"]`)) el.hidden = true;
  }

  // 2. The latest version and sizes, from GitHub.
  fetch('https://api.github.com/repos/blakeb056/six-degrees/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((release) => {
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (!version) return;
      const mb = (name) => {
        const a = (release.assets || []).find((x) => x.name === name);
        return a ? Math.round(a.size / 1e6) : null;
      };
      for (const el of all('[data-asset]')) {
        const size = mb(el.dataset.asset);
        if (size) el.textContent = ` · ${size} MB`;
      }
      const line = $('version-line');
      if (!line) return;
      if (os !== 'mac') {
        // Windows and Linux are a beta on their own pre-release (DOWNLOADS above), not this "latest" version.
        line.textContent = `Mac ${version} · Windows and Linux in beta · free and open source`;
        return;
      }
      const silicon = mb('Sixgree-Mac-Apple-Silicon.dmg');
      const intel = mb('Sixgree-Mac-Intel.dmg');
      // The size of the download this Mac needs, when we know which; else both.
      let size = '';
      if (chip === 'silicon' && silicon) size = ` · ${silicon} MB`;
      else if (chip === 'intel' && intel) size = ` · ${intel} MB`;
      else if (silicon && intel) size = ` · ${silicon} MB (Apple Silicon), ${intel} MB (Intel)`;
      line.textContent = `Version ${version} · macOS 13.5 or later${size} · Windows and Linux in beta · free and open source`;
    })
    .catch(() => { /* keep the fallback lines */ });

  const stars = all('[data-gh-stars]');
  if (stars.length) {
    fetch('https://api.github.com/repos/blakeb056/six-degrees', { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((repo) => {
        if (typeof repo.stargazers_count !== 'number') return;
        for (const el of stars) el.textContent = repo.stargazers_count.toLocaleString('en-US');
      })
      .catch(() => { /* keep the star */ });
  }

  // 3. Copy buttons: data-copy names the <code> whose text they copy.
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  document.body.append(status);
  for (const button of all('button[data-copy]')) {
    button.addEventListener('click', async () => {
      const code = $(button.dataset.copy);
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code.textContent.trim());
        button.textContent = 'Copied';
        status.textContent = 'Command copied.';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        button.textContent = os === 'mac' ? 'Press ⌘C' : 'Press Ctrl-C';
        status.textContent = 'Command selected. Copy it with the keyboard.';
      }
      setTimeout(() => { button.textContent = 'Copy'; }, 1800);
    });
  }

  // 4 and 5: things that happen as they come on screen.
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window)) {
    for (const g of all('.chart-group, .reveal')) g.classList.add('seen');
    return;
  }
  const charts = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) {
        target.classList.add('seen');
        charts.unobserve(target);
      }
    }
  }, { threshold: 0.15 });
  for (const g of all('.chart-group, .reveal')) charts.observe(g);

  if (!reduceMotion) {
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
    for (const v of all('figure.video video')) {
      v.muted = true; // playing by itself needs it, and the videos are silent anyway
      v.addEventListener('pause', () => {
        if (!v.dataset.autoPaused && !v.ended) v.dataset.userPaused = '1';
        delete v.dataset.autoPaused;
      });
      v.addEventListener('play', () => { delete v.dataset.userPaused; });
      seen.observe(v);
    }
  }
})();
