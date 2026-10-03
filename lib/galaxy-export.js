// Save the Galaxy as a picture, or record its replay as a video (the physics
// lab, experimental). The Galaxy registers its <svg> here while it's on screen;
// the lab's buttons call these. Nothing leaves the computer: the file is saved
// like any other download.

import { clockNow, setClock, play, pause } from './galaxy-lab.js';
import { MAP_LOOK } from './themes.js';

let current = null;   // { svg, stamp: () => text or null, legend: () => [[label, colour]] }

export function registerGalaxy(entry) {
  current = entry;
  return () => { if (current === entry) current = null; };
}

export const galaxyShown = () => current != null;

// The lab's highlight rules live in the page's CSS, which a picture of the
// <svg> alone doesn't carry, so they ride along inside it.
const EXPORT_CSS = `
.lab-focus .gn:not(.lit), .lab-focus .gl:not(.lit) { opacity: 0.06; }
.lab-focus .gl.lit { stroke-opacity: 0.7; }
.lab-focus .dot-rings, .lab-focus .catalyst-ring { opacity: 0.15; }
.lab-find .gn:not(.found), .lab-find .gl:not(.found) { opacity: 0.07; }
.lab-find .gn.found { stroke: #fff; stroke-width: 2px; }
`;

function svgImage(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // The page's font, which the <svg> inherits on screen but not in a file.
  clone.setAttribute('font-family', getComputedStyle(svg).fontFamily || 'system-ui, sans-serif');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  // The theme's colours (lib/themes.js), which the map reads from the page and a file can't.
  const root = document.documentElement;
  const vars = [...root.style].filter((k) => k.startsWith('--sd-')).map((k) => `${k}:${root.style.getPropertyValue(k)}`).join(';');
  style.textContent = `svg{${vars}}${EXPORT_CSS}`;
  clone.insertBefore(style, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  return img.decode().then(() => img);
}

// One frame: the Galaxy, its date while a replay runs, the legend, and a small credit.
async function drawFrame(ctx, w, h) {
  const img = await svgImage(current.svg);
  ctx.fillStyle = MAP_LOOK.bg;   // the theme's colour (lib/themes.js)
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const scale = w / current.svg.clientWidth;
  ctx.save();
  ctx.scale(scale, scale);
  const cw = w / scale;
  const ch = h / scale;
  const stamp = current.stamp();
  if (stamp) {
    ctx.font = '600 15px -apple-system, system-ui, sans-serif';
    const tw = ctx.measureText(stamp).width;
    ctx.fillStyle = 'rgba(10,15,30,0.85)';
    ctx.beginPath();
    ctx.roundRect?.(cw / 2 - tw / 2 - 16, ch - 52, tw + 32, 32, 16);
    ctx.fill();
    ctx.fillStyle = '#e6edf5';
    ctx.textAlign = 'center';
    ctx.fillText(stamp, cw / 2, ch - 31);
  }
  ctx.textAlign = 'left';
  ctx.font = '11px -apple-system, system-ui, sans-serif';
  let x = 20;
  for (const [label, colour] of current.legend()) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x + 4, ch - 24, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa';
    ctx.fillText(label, x + 12, ch - 20);
    x += 20 + ctx.measureText(label).width;
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('Six Degrees', cw - 16, 24);
  ctx.restore();
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // Anything appended to <body> is position: fixed (TRAPS §29). Gone at once.
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const today = () => new Date().toISOString().slice(0, 10);

function canvasFor(scale) {
  const w = Math.round(current.svg.clientWidth * scale);
  const h = Math.round(current.svg.clientHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d'), w, h };
}

/** The Galaxy as it is on screen, at twice the size, as a PNG. */
export async function savePicture() {
  if (!current) throw new Error('Open the Galaxy first.');
  const { canvas, ctx, w, h } = canvasFor(2);
  await drawFrame(ctx, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  save(blob, `six-degrees-galaxy-${today()}.png`);
}

export const canRecord = () => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined'
  && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

/**
 * Plays the replay from the start and records it: a video the length of the
 * replay, at 12 frames a second. Resolves when it's saved.
 */
export async function recordReplay() {
  if (!current) throw new Error('Open the Galaxy first.');
  if (!canRecord()) throw new Error('This window can’t record video.');
  const { canvas, ctx, w, h } = canvasFor(1);
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('This window can’t record video.');
  await drawFrame(ctx, w, h);
  const recorder = new MediaRecorder(canvas.captureStream(12), { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(250);
  pause();
  setClock({ at: clockNow().min });
  play();
  let drawing = false;
  await new Promise((resolve) => {
    const tick = setInterval(async () => {
      if (drawing) return;
      drawing = true;
      try { await drawFrame(ctx, w, h); } finally { drawing = false; }
      if (!clockNow().playing) { clearInterval(tick); setTimeout(resolve, 600); }
    }, 1000 / 12);
  });
  await drawFrame(ctx, w, h);
  recorder.stop();
  await done;
  const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  save(new Blob(chunks, { type: type.split(';')[0] }), `six-degrees-replay-${today()}.${ext}`);
}
