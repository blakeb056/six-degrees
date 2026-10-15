// The chimes manual mode plays (Blake, 2026-10-12: "a chime sound that is very
// addicting every time its scanned so it notifies the user its ready to continue
// and when they hit the next button … a chime to react right when they click it
// … and add that into settings for audio").
//
//   read-1 … read-8   a page was read: a two-note bell, one step higher up an
//                     E major pentatonic ladder for each page in a row, so a run
//                     of pages climbs (the streak is what makes it satisfying)
//   next              you clicked Next: a short, crisp tap, the moment the next
//                     page starts to load
//   done              their list is finished: a four-note rising flourish
//   tick              once a second through a break by hand (Blake, 2026-10-15:
//                     "20 seconds with a ticking sound"; scrape.py _manual_break,
//                     lib/manual-breaks.js): a dry, wooden clock tick, quieter
//                     than the rest, so twenty of them in a row never grate
//
// Synthesised here, not recorded, so there's no file to license and one source
// for every copy: the scanner plays the WAV files lib/chime-files.js writes into
// the data folder (scrape.py _chime), and Settings → Sound plays the same bytes
// in the page to preview them. Deterministic: the same name always gives the
// same bytes. No Node imports, so the page can share it.

export const SAMPLE_RATE = 44100;
// Bump when the sounds change, so the data folder's copies are written again.
export const CHIME_VERSION = 2;
// E5 to G#6, the E major pentatonic: any two of these sound good together.
const LADDER = [659.25, 739.99, 830.61, 987.77, 1108.73, 1318.51, 1479.98, 1661.22];
export const READ_STEPS = LADDER.length;
export const CHIME_NAMES = Object.freeze([...LADDER.map((_, i) => `read-${i + 1}`), 'next', 'done', 'tick']);
export const CHIME_DEFAULTS = Object.freeze({ chimes: true, chimeVolume: 0.6 });

/** A volume the app keeps: 0 to 1. */
export const validVolume = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** The read chime for the nth page in a row (1 on): it climbs, then stays at the top. */
export const readChime = (n) => `read-${Math.min(Math.max(1, Math.floor(n) || 1), READ_STEPS)}`;

/** The root note of each read step, in Hz, for the tests and anyone tuning it. */
export const readPitch = (step) => LADDER[Math.min(Math.max(1, step), READ_STEPS) - 1];

// A bell: a soft 4 ms attack and partials that die away at their own rates; the
// inharmonic 4.16 gives it the shimmer, the octave below gives it body.
const PARTIALS = [[0.5, 0.12, 1.4], [1, 1, 1], [2, 0.32, 0.6], [3, 0.1, 0.45], [4.16, 0.05, 0.3]];

function bell(out, start, freq, amp, tau) {
  const s0 = Math.round(start * SAMPLE_RATE);
  for (let i = s0; i < out.length; i++) {
    const t = (i - s0) / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.004);
    let v = 0;
    for (const [ratio, gain, decay] of PARTIALS) v += gain * Math.sin(2 * Math.PI * freq * ratio * t) * Math.exp(-t / (tau * decay));
    out[i] += amp * attack * v;
  }
}

// The tap: a glassy blip that drops in pitch, over a few milliseconds of noise
// for the click, from a fixed seed so it's the same every time.
function tap(out) {
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const freq = 1400 + 700 * Math.exp(-t / 0.012);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.0015);
    out[i] += attack * Math.sin(phase) * Math.exp(-t / 0.022);
    if (t < 0.006) out[i] += 0.35 * noise() * Math.exp(-t / 0.0015);
  }
}

// The tick: two short wooden partials and a millisecond of noise for the knock,
// low enough that it never sounds like the Next tap, gone in 70 ms.
function tick(out) {
  let seed = 4242;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.0008);
    out[i] += attack * (Math.sin(2 * Math.PI * 950 * t) * Math.exp(-t / 0.011)
      + 0.55 * Math.sin(2 * Math.PI * 2310 * t) * Math.exp(-t / 0.005));
    if (t < 0.003) out[i] += 0.4 * noise() * Math.exp(-t / 0.0008);
  }
}

function render(name) {
  if (name === 'tick') {
    const out = new Float64Array(Math.round(0.07 * SAMPLE_RATE));
    tick(out);
    return finish(out, 0.45);
  }
  if (name === 'next') {
    const out = new Float64Array(Math.round(0.12 * SAMPLE_RATE));
    tap(out);
    return finish(out, 0.55);
  }
  if (name === 'done') {
    const out = new Float64Array(Math.round(1.5 * SAMPLE_RATE));
    [[659.25, 0], [830.61, 0.085], [987.77, 0.17]].forEach(([f, at]) => bell(out, at, f, 0.42, 0.26));
    bell(out, 0.255, 1318.51, 0.55, 0.5);
    return finish(out, 0.85);
  }
  const m = /^read-(\d+)$/.exec(String(name));
  const step = m ? Number(m[1]) : 0;
  if (!(step >= 1 && step <= READ_STEPS)) throw new Error(`No chime called ${name}`);
  const root = LADDER[step - 1];
  const out = new Float64Array(Math.round(0.9 * SAMPLE_RATE));
  bell(out, 0, root, 0.55, 0.28);
  bell(out, 0.075, root * 1.259921, 0.45, 0.32);   // a major third above, a beat later
  return finish(out, 0.85);
}

/** Scaled to `peak`, with the last 20 ms faded so it never ends on a click. */
function finish(out, peak) {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 0;
  const fade = Math.round(0.02 * SAMPLE_RATE);
  for (let i = 0; i < out.length; i++) {
    const tail = out.length - i;
    out[i] *= k * (tail < fade ? tail / fade : 1);
  }
  return out;
}

/** 16-bit mono PCM WAV bytes for `samples` (-1 to 1). */
export function encodeWav(samples, rate = SAMPLE_RATE) {
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);          // PCM
  dv.setUint16(22, 1, true);          // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);   // bytes a second
  dv.setUint16(32, 2, true);          // bytes a frame
  dv.setUint16(34, 16, true);         // bits a sample
  text(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return bytes;
}

/** The chime called `name` (CHIME_NAMES) as WAV bytes. */
export function chimeWav(name) {
  return encodeWav(render(name));
}

/** The chime's samples, for the tests. */
export function chimeSamples(name) {
  return render(name);
}
