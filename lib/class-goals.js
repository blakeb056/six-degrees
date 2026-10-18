// Where a class lives: user_profile.goals, one JSON object, the single source
// of truth (spec section 12). It holds the class picked, the one-time offer to
// existing users, and a saved build per class (Blake, 10/17: "answers are
// saved per class"): the target named, every This or That answer with both
// cards' features, the Never show me list, and the weights the answers led
// to. Switching class keeps every build; switching back restores that class's
// scoring exactly, from its own saved weights.
//
// The table travels with the network (an export, a backup, a restore), so a
// class does too. No new table: a deep questionnaire plus retunes is a few
// hundred answers at most.

import { newId } from './db-client.js';
import {
  CLASS_KEYS, PRESET_VERSION, FEATURE_SET_VERSION, ROLE_CHIPS, DEFAULT_ROLES, AVOID_CHIPS, defaultAvoid, classByKey,
  FEATURE_KEYS,
} from './class-presets.js';
import { SECTOR_KEYS } from './sector-directory.js';
import { companyName } from './breach.js';

export const GOALS_VERSION = 1;
export const MAX_ANSWERS = 400;
const MAX_TARGETS = 25;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The profile row the goals sit on, made when there is none. */
function profileRow(db, userId) {
  const row = (userId && db.prepare('SELECT * FROM user_profile WHERE user_id = ? ORDER BY created_at LIMIT 1').get(userId))
    || db.prepare('SELECT * FROM user_profile ORDER BY created_at LIMIT 1').get();
  if (row) return row;
  const id = newId();
  db.prepare('INSERT INTO user_profile (id, user_id, name, goals) VALUES (?, ?, ?, ?)').run(id, userId || null, 'You', '{}');
  return db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id);
}

/** The setup S2 asks for, cleaned: sectors, role chips, a city, target companies, and the optional "about you". */
export function cleanSetup(classKey, setup = {}) {
  const s = isObj(setup) ? setup : {};
  const chips = new Set((ROLE_CHIPS[classKey] || []).map((c) => c.key));
  const sectors = [...new Set((Array.isArray(s.sectors) ? s.sectors : []).filter((k) => SECTOR_KEYS.includes(k)))].slice(0, 6);
  const roles = [...new Set((Array.isArray(s.roles) ? s.roles : []).filter((k) => chips.has(k)))];
  const seen = new Set();
  const targets = [];
  for (const t of Array.isArray(s.targets) ? s.targets : []) {
    const name = companyName(t);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    targets.push(name);
    if (targets.length >= MAX_TARGETS) break;
  }
  const about = isObj(s.about) ? { role: text(s.about.role), company: text(s.about.company), school: text(s.about.school), city: text(s.about.city) } : {};
  return { sectors, roles, city: text(s.city), targets, about };
}

/** Never show me, cleaned: [{ key, strength: 'less' | 'never' }], a feature chip, an industry or a company ("co:Name"). */
export function cleanAvoid(list = []) {
  const known = new Set([...AVOID_CHIPS.map((c) => c.key), ...FEATURE_KEYS.filter((k) => k.startsWith('ind:'))]);
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(list) ? list : []) {
    if (!isObj(a) || !['less', 'never'].includes(a.strength)) continue;
    let key = String(a.key || '');
    if (key.startsWith('co:')) {
      const name = companyName(key.slice(3));
      if (!name) continue;
      key = `co:${name}`;
    } else if (!known.has(key)) continue;
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push({ key, strength: a.strength });
    if (out.length >= 40) break;
  }
  return out;
}

/** A new class's build: its preset, S2 prefilled from what's known, nothing answered. */
export function newBuild(classKey, { sectors = [], city = '', targets = [], about = {} } = {}) {
  const meta = classByKey(classKey);
  return {
    class: classKey,
    presetVersion: PRESET_VERSION,
    featureSetVersion: FEATURE_SET_VERSION,
    setup: cleanSetup(classKey, { sectors, roles: DEFAULT_ROLES[classKey] || [], city, targets, about }),
    setupDone: false,
    answers: [],
    avoid: defaultAvoid(classKey),
    avoidDone: false,
    nevers: [],
    weights: null,
    sds: null,
    u0: null,
    side: null,
    dials: { rho: meta?.rho ?? 1, gamma: meta?.gamma ?? 0.5 },
    done: false,
    skipped: false,
    session: null,
    disagreed: 0,
    updatedAt: new Date().toISOString(),
  };
}

function cleanBuild(classKey, b) {
  if (!isObj(b)) return null;
  const fresh = newBuild(classKey);
  const answers = (Array.isArray(b.answers) ? b.answers : []).filter((a) => isObj(a) && isObj(a.a) && isObj(a.b)).slice(-MAX_ANSWERS);
  const weights = isObj(b.weights) ? Object.fromEntries(FEATURE_KEYS.map((k) => [k, Number(b.weights[k]) || 0])) : null;
  const sds = isObj(b.sds) ? Object.fromEntries(FEATURE_KEYS.map((k) => [k, Number(b.sds[k]) || 0])) : null;
  return {
    ...fresh,
    presetVersion: Number(b.presetVersion) || PRESET_VERSION,
    featureSetVersion: Number(b.featureSetVersion) || FEATURE_SET_VERSION,
    setup: cleanSetup(classKey, b.setup),
    setupDone: b.setupDone === true,
    answers,
    avoid: Array.isArray(b.avoid) ? cleanAvoid(b.avoid) : fresh.avoid,
    avoidDone: b.avoidDone === true,
    nevers: (Array.isArray(b.nevers) ? b.nevers : []).map((n) => String(n).slice(0, 200)).slice(0, 2000),
    weights,
    sds,
    u0: Number.isFinite(b.u0) ? b.u0 : null,
    side: Number.isFinite(b.side) ? b.side : null,
    dials: { rho: Number.isFinite(b.dials?.rho) ? b.dials.rho : fresh.dials.rho, gamma: Number.isFinite(b.dials?.gamma) ? b.dials.gamma : fresh.dials.gamma },
    done: b.done === true,
    skipped: b.skipped === true,
    session: isObj(b.session) ? { mode: String(b.session.mode || 'standard'), start: Number(b.session.start) || 0 } : null,
    disagreed: Number(b.disagreed) || 0,
    updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : fresh.updatedAt,
  };
}

/** The goals as stored, cleaned: { v, class, offer, builds }. Anything unreadable reads as nothing chosen. */
export function parseGoals(raw) {
  let g = raw;
  if (typeof raw === 'string') { try { g = JSON.parse(raw); } catch { g = null; } }
  // The hosted era stored goals as a list of words: nothing of a class in it.
  if (!isObj(g)) g = {};
  const builds = {};
  for (const key of CLASS_KEYS) {
    const b = cleanBuild(key, g.builds?.[key]);
    if (b) builds[key] = b;
  }
  const cls = CLASS_KEYS.includes(g.class) ? g.class : null;
  const offer = isObj(g.offer) && ['picked', 'skipped'].includes(g.offer.answer) ? { answer: g.offer.answer, at: String(g.offer.at || '') } : null;
  return { v: GOALS_VERSION, class: cls, offer, builds };
}

export function readGoals(db, userId = null) {
  const row = db.prepare(`SELECT goals FROM user_profile ${userId ? 'WHERE user_id = ? ' : ''}ORDER BY created_at LIMIT 1`).get(...(userId ? [userId] : []))
    || db.prepare('SELECT goals FROM user_profile ORDER BY created_at LIMIT 1').get();
  return parseGoals(row?.goals ?? null);
}

export function writeGoals(db, goals, userId = null) {
  const row = profileRow(db, userId);
  const clean = parseGoals(goals);
  db.prepare("UPDATE user_profile SET goals = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(clean), row.id);
  return clean;
}

/** S2's "about you" also fills the profile's own columns, empty until now. */
export function saveAbout(db, about = {}, userId = null) {
  const row = profileRow(db, userId);
  const role = text(about.role);
  const company = text(about.company);
  if (!role && !company) return;
  db.prepare("UPDATE user_profile SET role = COALESCE(NULLIF(?, ''), role), company = COALESCE(NULLIF(?, ''), company), updated_at = datetime('now') WHERE id = ?")
    .run(role, company, row.id);
}

/** The active class's build, or null. */
export function activeBuild(goals) {
  return goals?.class ? goals.builds?.[goals.class] || null : null;
}

/** What a build is up to, for the pages: picked, target named, answers, done. */
export function buildStatus(build) {
  if (!build) return { saved: false, answers: 0, done: false };
  const answered = (build.answers || []).filter((a) => a.choice !== 'skip' && a.kind !== 'pair').length;
  return { saved: true, answers: answered, done: build.done, skipped: build.skipped, setupDone: build.setupDone, avoidDone: build.avoidDone };
}
