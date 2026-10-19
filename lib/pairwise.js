// The posterior behind This or That (spec sections 6.7 to 6.9): every answer
// is a choice between two cards and "neither" (the outside option, whose
// utility u0 is learned), fitted with the class preset as a Gaussian prior.
//
// A card's utility is u = phi . w, plus delta when it sat on the left (the
// side bias, estimated, so a habit of picking left isn't read as taste).
// "Neither" has utility u0. An answer is a multinomial logit over the options
// it was asked between:
//
//   P(pick A)       = e^{uA} / (e^{uA} + e^{uB} + e^{u0})
//   P(pick neither) = e^{u0} / (same)
//
// "Both great" is a soft label 0.5 on A against B, plus evidence that each
// beats nobody (two pseudo-comparisons at weight 0.5). Skip adds nothing.
//
// The fit is the exact MAP by Newton's method, refitted from every answer
// each time: with about 40 weights and at most a few hundred answers that is
// a millisecond, and it never drifts the way chained online updates can. The
// Laplace covariance at the MAP is what active selection and the stop rule
// read. Plain functions, no imports: tests/duel-deck.test.mjs runs them.

// ── Small dense linear algebra (P is about 40) ──────────────────────────────

/** The Cholesky factor L (lower, row-major) of a symmetric positive definite P x P matrix, or null. */
export function cholesky(A, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (!(s > 1e-12)) return null;
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }
  return L;
}

/** Solve (L L') x = b. */
export function cholSolve(L, n, b) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** The inverse of (L L'), row-major. */
export function cholInverse(L, n) {
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0);
    e[j] = 1;
    const col = cholSolve(L, n, e);
    for (let i = 0; i < n; i++) inv[i * n + j] = col[i];
  }
  return inv;
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
export const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

// ── Answers as choice terms ──────────────────────────────────────────────────

/**
 * The design vector of one option in parameter space (length P): a card's
 * features in the first D places, 1 in the side-bias place when it sat on the
 * left; "neither" is 1 in the u0 place.
 */
export function cardVector(x, { left = false } = {}, { D, SIDE, P }) {
  const v = new Float64Array(P);
  for (let i = 0; i < D; i++) v[i] = Number(x[i]) || 0;
  if (left) v[SIDE] = 1;
  return v;
}

export function outsideVector({ U0, P }) {
  const v = new Float64Array(P);
  v[U0] = 1;
  return v;
}

/**
 * One stored answer as choice terms: [{ X: [vectors], y: [target shares], w }].
 * `answer` is { a: { x }, b: { x }, choice: 'a' | 'b' | 'both' | 'neither' | 'skip',
 * left: 'a' | 'b', weight? }. A reveal reaction ({ kind: 'pair' }) is a plain
 * two-way comparison at full weight.
 */
export function answerTerms(answer, dims) {
  const w = Number.isFinite(answer?.weight) ? answer.weight : 1;
  if (!answer || answer.choice === 'skip' || !(w > 0)) return [];
  const A = cardVector(answer.a.x, { left: answer.left === 'a' }, dims);
  const B = cardVector(answer.b.x, { left: answer.left === 'b' }, dims);
  if (answer.kind === 'pair') {
    // A reaction at the reveal: a against b, no outside option, no side.
    const a = cardVector(answer.a.x, {}, dims);
    const b = cardVector(answer.b.x, {}, dims);
    return [{ X: [a, b], y: answer.choice === 'a' ? [1, 0] : [0, 1], w }];
  }
  const O = outsideVector(dims);
  switch (answer.choice) {
    case 'a': return [{ X: [A, B, O], y: [1, 0, 0], w }];
    case 'b': return [{ X: [A, B, O], y: [0, 1, 0], w }];
    case 'neither': return [{ X: [A, B, O], y: [0, 0, 1], w }];
    case 'both': return [
      { X: [A, B], y: [0.5, 0.5], w },
      { X: [A, O], y: [1, 0], w: 0.5 * w },
      { X: [B, O], y: [1, 0], w: 0.5 * w },
    ];
    default: return [];
  }
}

/**
 * Mirrored repeats: an answer asked again with the sides swapped (`mirrorOf`,
 * the index of the original). If the two disagree, both count half, and the
 * reveal says calmly that some answers disagreed, which is normal.
 * @returns { answers (weights set), disagreed }
 */
export function weighMirrors(answers = []) {
  const out = answers.map((a) => ({ ...a, weight: Number.isFinite(a?.weight) ? a.weight : 1 }));
  let disagreed = 0;
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m?.mirrorOf == null) continue;
    const o = out[m.mirrorOf];
    if (!o || o.choice === 'skip' || m.choice === 'skip') continue;
    // The mirror shows the original's a as its b: the same answer reads swapped.
    const swap = { a: 'b', b: 'a', both: 'both', neither: 'neither' };
    if (swap[o.choice] !== m.choice) {
      disagreed += 1;
      o.weight = Math.min(o.weight, 0.5);
      m.weight = Math.min(m.weight, 0.5);
    }
  }
  return { answers: out, disagreed };
}

// ── The fit ──────────────────────────────────────────────────────────────────

/**
 * The MAP and its Laplace covariance. `prior` is { mean, sd } (length P);
 * `terms` from answerTerms. Returns { mean, cov, iterations }.
 */
export function fitPosterior(prior, terms = [], { maxIter = 30, tol = 1e-7 } = {}) {
  const n = prior.mean.length;
  const theta = Float64Array.from(prior.mean);
  const lambda = Float64Array.from(prior.sd, (s) => 1 / (s * s));
  let L = null;
  let it = 0;
  for (; it < maxIter; it++) {
    const g = new Float64Array(n);
    const H = new Float64Array(n * n);   // the negative Hessian: positive definite
    for (let i = 0; i < n; i++) {
      g[i] = -lambda[i] * (theta[i] - prior.mean[i]);
      H[i * n + i] = lambda[i];
    }
    for (const t of terms) addTerm(t, theta, g, H, n);
    L = cholesky(H, n);
    if (!L) break;
    const step = cholSolve(L, n, g);
    let biggest = 0;
    for (let i = 0; i < n; i++) {
      theta[i] += step[i];
      biggest = Math.max(biggest, Math.abs(step[i]));
    }
    if (biggest < tol) { it += 1; break; }
  }
  // The covariance at the final point.
  const H = new Float64Array(n * n);
  for (let i = 0; i < n; i++) H[i * n + i] = lambda[i];
  const g = new Float64Array(n);
  for (const t of terms) addTerm(t, theta, g, H, n);
  L = cholesky(H, n);
  const cov = L ? cholInverse(L, n) : diag(prior.sd);
  return { mean: theta, cov, iterations: it };
}

function diag(sd) {
  const n = sd.length;
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i++) m[i * n + i] = sd[i] * sd[i];
  return m;
}

/** Add one choice term's gradient and negative Hessian at theta. */
function addTerm({ X, y, w }, theta, g, H, n) {
  const k = X.length;
  const u = X.map((x) => dot(x, theta));
  const top = Math.max(...u);
  const e = u.map((v) => Math.exp(v - top));
  const z = e.reduce((s, v) => s + v, 0);
  const p = e.map((v) => v / z);
  const ysum = y.reduce((s, v) => s + v, 0);
  const mean = new Float64Array(n);
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) mean[i] += p[c] * X[c][i];
  for (let c = 0; c < k; c++) for (let i = 0; i < n; i++) g[i] += w * y[c] * X[c][i];
  for (let i = 0; i < n; i++) g[i] -= w * ysum * mean[i];
  // Negative Hessian: w * ysum * (sum p x x' - mean mean').
  for (let c = 0; c < k; c++) {
    const x = X[c];
    const pc = w * ysum * p[c];
    if (!pc) continue;
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      if (!xi) continue;
      for (let j = 0; j < n; j++) if (x[j]) H[i * n + j] += pc * xi * x[j];
    }
  }
  for (let i = 0; i < n; i++) {
    if (!mean[i]) continue;
    for (let j = 0; j < n; j++) if (mean[j]) H[i * n + j] -= w * ysum * mean[i] * mean[j];
  }
}

// ── Choosing the next pair, and when to stop ─────────────────────────────────

/** d' S d over the first `D` places of a P x P covariance. */
export function quadForm(cov, n, d, D = d.length) {
  let s = 0;
  for (let i = 0; i < D; i++) {
    if (!d[i]) continue;
    let r = 0;
    for (let j = 0; j < D; j++) if (d[j]) r += cov[i * n + j] * d[j];
    s += d[i] * r;
  }
  return s;
}

/**
 * The expected information gain of asking a pair with feature difference d:
 * 1/2 ln(1 + p(1 - p) d' S d), p = sigmoid(mu' d). Ask what the model thinks
 * is a coin flip, along the direction it is least sure about.
 */
export function infoGain(posterior, d, D = d.length) {
  const n = posterior.mean.length;
  let m = 0;
  for (let i = 0; i < D; i++) m += posterior.mean[i] * d[i];
  const p = sigmoid(m);
  return { gain: 0.5 * Math.log(1 + p * (1 - p) * quadForm(posterior.cov, n, d, D)), p, margin: m };
}

/** The calibration meter: 1 - trace(S) / trace(S_prior), over the weights. */
export function calibration(posterior, prior, D) {
  const n = posterior.mean.length;
  let now = 0;
  let before = 0;
  for (let i = 0; i < D; i++) {
    now += posterior.cov[i * n + i];
    before += prior.sd[i] * prior.sd[i];
  }
  return before > 0 ? Math.max(0, Math.min(1, 1 - now / before)) : 0;
}

/** A small seeded random number generator, so a deck is the same for the same seed. */
export function seededRandom(seed = 1) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** `count` draws of the weights from the posterior: arrays of length D. */
export function posteriorDraws(posterior, D, count = 20, rand = seededRandom(7)) {
  const n = posterior.mean.length;
  // The weights' block of the covariance.
  const S = new Float64Array(D * D);
  for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) S[i * D + j] = posterior.cov[i * n + j];
  const L = cholesky(S, D);
  const draws = [];
  for (let k = 0; k < count; k++) {
    const z = Float64Array.from({ length: D }, () => normal(rand));
    const w = new Float64Array(D);
    for (let i = 0; i < D; i++) {
      let s = posterior.mean[i];
      if (L) for (let j = 0; j <= i; j++) s += L[i * D + j] * z[j];
      w[i] = s;
    }
    draws.push(w);
  }
  return draws;
}

/** Kendall's tau between two orderings of the same items, from their scores. */
export function kendallTau(a, b) {
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const s = Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
      if (s > 0) concordant += 1;
      else if (s < 0) discordant += 1;
    }
  }
  const all = concordant + discordant;
  return all ? (concordant - discordant) / all : 1;
}

/**
 * How stable the user's top 50 is: the median Kendall tau between the MAP's
 * order of its top 50 and each posterior draw's order of the same people.
 * `rows` are feature arrays (length D); `offsets` an optional per-row constant.
 */
export function topStability(posterior, rows, D, { top = 50, draws = 20, rand, offsets = null } = {}) {
  if (rows.length < 3) return 1;
  const score = (w, r, i) => {
    let s = offsets ? offsets[i] : 0;
    for (let k = 0; k < D; k++) s += w[k] * r[k];
    return s;
  };
  const map = rows.map((r, i) => score(posterior.mean, r, i));
  const order = map.map((_, i) => i).sort((x, y) => map[y] - map[x]).slice(0, top);
  const best = order.map((i) => map[i]);
  const taus = posteriorDraws(posterior, D, draws, rand).map((w) => kendallTau(best, order.map((i) => score(w, rows[i], i))));
  taus.sort((x, y) => x - y);
  return taus[Math.floor(taus.length / 2)];
}

/**
 * When to stop (spec 6.9): never before the mode's minimum; early once every
 * block's posterior sd is under STOP_SD, or the top 50 is stable across
 * posterior draws (median tau >= STOP_TAU); always at the maximum.
 * `blocks` is { key: [feature indexes that have varied in the asked cards] }.
 * @returns { stop, reason: 'max' | 'sd' | 'stable' | null }
 */
export function shouldStop({ asked, mode, posterior, blocks = {}, stability = null, stopSd = 0.25, stopTau = 0.9 }) {
  if (asked >= mode.max) return { stop: true, reason: 'max' };
  if (asked < mode.min) return { stop: false, reason: null };
  const n = posterior.mean.length;
  const sds = Object.values(blocks).flatMap((idx) => idx.map((i) => Math.sqrt(posterior.cov[i * n + i])));
  if (sds.length && sds.every((s) => s < stopSd)) return { stop: true, reason: 'sd' };
  if (stability != null && stability >= stopTau) return { stop: true, reason: 'stable' };
  return { stop: false, reason: null };
}
