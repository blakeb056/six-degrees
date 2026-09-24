// What the Scan page shows about LinkedIn: how much has been searched, the
// budget, and whether a cooldown is on. The scanner writes these files
// (scripts/scrape.py, "How much this machine has asked of LinkedIn"); this
// reads them with the same rules, and writes only the two things a person
// changes here — the budget, and lifting a cooldown.
//
// They belong to the LinkedIn account, not to a profile in the app. TRAPS §35.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_LIMITS = { daily: 50, monthly: 250 };
export const DAILY_CHOICES = [25, 50, 100, 200, 500];
export const MONTHLY_CHOICES = [100, 250, 500, 1000, 0];   // 0 = no monthly cap (Premium)
const DAY = 24 * 3600;
const PACIFIC = 'America/Los_Angeles';

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

/** Pacific offset from UTC in hours on a given instant, e.g. -7 or -8. */
function pacificOffsetHours(ms) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT-8';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) : -8;
}

/** Midnight Pacific on the 1st of the month containing `ms` (LinkedIn's reset), in ms. */
export function monthStartPacific(ms = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, year: 'numeric', month: 'numeric',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const y = Number(parts.year), mo = Number(parts.month);
  // The offset that applies AT midnight, not later that day: daylight saving
  // can end on the 1st (Nov 1, 2026), and noon's offset put midnight an hour late.
  let at = Date.UTC(y, mo - 1, 1, 8);
  for (let i = 0; i < 2; i++) at = Date.UTC(y, mo - 1, 1, -pacificOffsetHours(at));
  return at;
}

/** Midnight Pacific on the 1st of next month, in ms. */
export function nextMonthStartPacific(ms = Date.now()) {
  const start = monthStartPacific(ms);
  return monthStartPacific(start + 40 * DAY * 1000);
}

export function readLimits(dir) {
  const raw = readJson(path.join(dir, 'scan-limits.json')) || {};
  const num = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
  return { daily: num(raw.daily, DEFAULT_LIMITS.daily), monthly: num(raw.monthly, DEFAULT_LIMITS.monthly) };
}

/** Only the offered choices are accepted, like everything else that reaches the scanner. */
export function writeLimits(dir, { daily, monthly }) {
  const cur = readLimits(dir);
  const next = {
    daily: DAILY_CHOICES.includes(daily) ? daily : cur.daily,
    monthly: MONTHLY_CHOICES.includes(monthly) ? monthly : cur.monthly,
  };
  writeJsonAtomic(path.join(dir, 'scan-limits.json'), next);
  return next;
}

/**
 * Searches in the last 24 hours and since LinkedIn's month began, and profile
 * views today. An unreadable record reads as the day used up, as the scanner
 * treats it — failing open would say nothing had been searched.
 */
export function usage(dir, now = Date.now()) {
  const file = path.join(dir, 'linkedin-activity.json');
  const data = existsSync(file) ? readJson(file) : { searches: [], profiles: [] };
  if (!data || typeof data !== 'object') return { searchesToday: Infinity, searchesMonth: 0, profilesToday: 0, unreadable: true };
  const s = (Array.isArray(data.searches) ? data.searches : []).map(Number);
  const p = (Array.isArray(data.profiles) ? data.profiles : []).map(Number);
  const dayAgo = now / 1000 - DAY;
  const month0 = monthStartPacific(now) / 1000;
  return {
    searchesToday: s.filter((t) => t > dayAgo).length,
    searchesMonth: s.filter((t) => t >= month0).length,
    profilesToday: p.filter((t) => t > dayAgo).length,
  };
}

/** The active cooldown { until (ms), reason, setAt }, or null. */
export function readCooldown(dir, now = Date.now()) {
  const raw = readJson(path.join(dir, 'linkedin-cooldown.json'));
  const until = Number(raw?.until) * 1000;
  if (!raw || !Number.isFinite(until) || until <= now) return null;
  return { until, reason: String(raw.reason || 'LinkedIn pushed back'), setAt: Number(raw.set_at) * 1000 || null };
}

/** Lift it: the person says LinkedIn works for them again. */
export function liftCooldown(dir) {
  try { unlinkSync(path.join(dir, 'linkedin-cooldown.json')); } catch { /* none to lift */ }
}

/** Everything the Scan page shows, in one object. */
export function linkedinState(dir, now = Date.now()) {
  const limits = readLimits(dir);
  const use = usage(dir, now);
  const left = (limit, used) => (limit ? Math.max(0, limit - used) : null);
  return {
    ...use,
    limits,
    leftToday: left(limits.daily, use.searchesToday),
    leftMonth: left(limits.monthly, use.searchesMonth),
    monthResets: nextMonthStartPacific(now),
    cooldown: readCooldown(dir, now),
  };
}
