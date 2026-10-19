// Every link to one person's LinkedIn profile goes through the shared
// app/components/OpenProfile.js, so in the desktop app it opens in Sixgree's
// own browser (one profile view, recorded) and only falls back to your
// browser where the panel can't. Blake, 2026-10-15: "I sent a request to
// connect manually in the Separation tab and it opened an external tab". This
// keeps any page from opening a profile in a new tab or window of its own again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.join('app', 'components', 'OpenProfile.js');

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(m?js|jsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// A new tab or window: target="_blank" in JSX or HTML, target: '_blank', or window.open.
const OPENS_OUTSIDE = /target=["']_blank["']|target:\s*['"]_blank['"]|window\.open\s*\(/;
// …of a profile: the row's profile link, or a linkedin.com/in/ address.
const PROFILE = /profile_?url|profileUrl|linkedin\.com\/in|\/in\//i;

test('no page opens a LinkedIn profile in a new tab or window except through OpenProfile.js', () => {
  const found = [];
  for (const file of sources('app')) {
    if (file === SHARED) continue;
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!OPENS_OUTSIDE.test(line)) return;
      // The tag it is in, when it is spread over a few lines: back to its <a, and on to its end.
      let start = i;
      while (start > Math.max(0, i - 4) && !/<a\b/.test(lines[start])) start--;
      if (!/<a\b/.test(lines[start])) start = i;
      const after = line.slice(line.search(OPENS_OUTSIDE));
      const near = [...lines.slice(start, i + 1), ...(/>/.test(after) ? [] : lines.slice(i + 1, i + 3))].join('\n');
      if (PROFILE.test(near)) found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, [], `profile links outside ${SHARED}:\n${found.join('\n')}`);
});

test('the check itself would catch one', () => {
  const bad = ['<a href={row.profile_url} target="_blank" rel="noopener noreferrer">', "window.open(p.profileUrl, '_blank')",
    "const html = '<a class=\"btn\" href=\"' + u + '\" target=\"_blank\">' + u.split('/in/')[1]"];
  for (const line of bad) assert.ok(OPENS_OUTSIDE.test(line) && PROFILE.test(line), line);
  // Not a profile: a conversation, an update's download, Chrome's.
  for (const line of ['<a href={thread} target="_blank" rel="noreferrer">Open conversation ↗</a>', '<a href={CHROME_DOWNLOAD} target="_blank">']) {
    assert.ok(!PROFILE.test(line), line);
  }
});

test('the shared link keeps the rules: the panel, straight there, then counted; your browser while a scan has it; one at a time', () => {
  const src = fs.readFileSync(path.join(ROOT, SHARED), 'utf8');
  // Blake, 2026-10-15: Connect "took like 2-3 min to load", View profile was instant. Both are this
  // one link: the shell takes the panel to the profile at once, and the view is counted after, by the server.
  assert.match(src, /return Boolean\(panel\?\.available\) && !scanHoldsPanel\(job, panel\);/);
  assert.match(src, /if \(panelCanOpen\(\) && await showProfileInPanel\(url\)\) \{\s*(?:\/\/[^\n]*\n\s*)?rememberPanelPerson\(person\);\s*countProfileView\(person, url\);\s*return \{ where: 'panel' \};/);
  assert.match(src, /fetch\('\/api\/profile-view', \{/);
  // No scanner job for a profile any more: nothing waits on a scan, the sign-in check or the gap between views.
  assert.doesNotMatch(src, /beginScrape|'outlink'/);
  // One profile per press: Open All and Open Top 10 went with the introductions queue (Blake, 2026-10-17).
  assert.doesNotMatch(src, /openProfiles|Next profile|setSteps/);
  // Every former link uses it: the person card (Separation's connect and View profile), Paths, Insights,
  // Messages & follow-ups, and the Map's "Ask … for an intro".
  for (const file of ['app/components/Sidebar.js', 'app/paths/page.js', 'app/components/insights/parts.js',
    'app/social/Crm.js', 'app/components/WorldMapLayers.js']) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /<OpenProfile /, file);
  }
  // Connect marks the request sent as it opens, in the panel or not.
  const card = fs.readFileSync(path.join(ROOT, 'app/components/Sidebar.js'), 'utf8');
  assert.match(card, /<OpenProfile person=\{selected\}\s+title=\{second \? 'Opens their profile, to connect yourself' : undefined\}[\s\S]{0,600}onOpen=\{\(\) => \{[\s\S]{0,300}markRequested\(selected/);
});

test('no page starts a scanner job to open a profile: the server has no such action now', () => {
  const route = fs.readFileSync(path.join(ROOT, 'app/api/scraper/route.js'), 'utf8');
  const actions = route.slice(route.indexOf('const ACTIONS = {'), route.indexOf('const PROFILE_READ_BATCHES'));
  assert.doesNotMatch(actions, /^\s*outlink:/m);
  assert.doesNotMatch(route, /--outlink=|outlinkTarget|noteOutlink/);
  for (const file of sources('app')) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /beginScrape\('outlink'|startScrape\('outlink'|action: 'outlink'/, file);
  }
});
