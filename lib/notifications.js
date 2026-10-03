// Notifications worth opening (Blake, 2026-10-03: "the notifications should be
// able to be clicked and … take over the right panel and show a more detailed
// version … what person added back from who and that they are a value person
// if the score is S … a new person added back, or we got a person from a
// high-ranking company, or that our scan is done").
//
// Each notification carries `data` naming who it is about, so the right panel
// can show them: { personId?, profileUrl?, viaId?, personIds?, action? }.
// Older notifications have no data; noteSubject finds their person by the name
// in the title. Plain functions, no React; tests/notifications.test.mjs.

const HIGH = new Set(['S', 'A']);
// A company's own score (company_prestige_score, lib/scoring.js) from here up is "a top company".
export const TOP_COMPANY = 8;

const score1 = (row) => {
  const n = parseFloat(row?.power_score);
  return Number.isFinite(n) ? n.toFixed(1) : null;
};

/** Someone you met through a bridge who is now one of your connections. */
export function addedBackNotification({ person, via, userId = null }) {
  if (!person) return null;
  const tier = person.tier || null;
  const valued = HIGH.has(tier);
  return {
    user_id: userId || null,
    type: 'added_back',
    title: `${person.name || 'Someone'} added you back${via?.name ? `, through ${via.name}` : ''}`,
    message: [tier ? `${tier}-tier${score1(person) ? ` · ${score1(person)}` : ''}` : null, valued ? 'a valuable person to know' : null, person.headline || null]
      .filter(Boolean).join(' · ').slice(0, 140),
    icon: valued ? '👑' : '🤝',
    data: { personId: person.id, viaId: via?.id ?? null, tier },
  };
}

/** People a circle scan found at top companies, as one notification. */
export function topCompanyNotification({ people = [], via = null, userId = null, threshold = TOP_COMPANY }) {
  const top = people.filter((p) => Number(p?.company_prestige_score) >= threshold)
    .sort((a, b) => Number(b.company_prestige_score) - Number(a.company_prestige_score) || (parseFloat(b.power_score) || 0) - (parseFloat(a.power_score) || 0));
  if (!top.length) return null;
  const companies = [...new Set(top.map((p) => p.company).filter(Boolean))];
  return {
    user_id: userId || null,
    type: 'top_company',
    title: `${top.length} ${top.length === 1 ? 'person' : 'people'} at top companies${via?.name ? ` in ${via.name}’s circle` : ''}`,
    message: companies.slice(0, 3).join(', ') + (companies.length > 3 ? ` +${companies.length - 3} more` : ''),
    icon: '🏢',
    data: { personIds: top.slice(0, 25).map((p) => p.id), personId: top[0].id, viaId: via?.id ?? null },
  };
}

// What each scanner job is called when it's done. Setting up, signing in and
// saving settings aren't scans, so they leave nothing.
const SCAN_DONE = {
  bridge: (t) => `Scan done: ${t?.name ? `${t.name}’s circle` : 'their circle'}`,
  resume: (t) => `Scan done: ${t?.name ? `${t.name}’s circle` : 'their circle'}`,
  rescrape: (t) => `Scan done: ${t?.name ? `${t.name}’s circle` : 'their circle'}`,
  'auto-bridge': () => 'Mapping the 2nd degree: done for now',
  'auto-bridge-retry': () => 'Retrying hidden lists: done',
  'resume-all': () => 'Every paused circle: done for now',
  full: () => 'Your whole network is scanned',
  refresh: () => 'Check for new: done',
  company: (t) => `Company scan done${t?.name ? `: ${t.name}` : ''}`,
  messages: () => 'Messages synced',
};

/** The notification a finished scan leaves, or null (not a scan, stopped, or it failed). */
export function scanDoneNotification({ action, target = null, exitCode, stopped = false, log = [], userId = null }) {
  const name = SCAN_DONE[action];
  if (!name || stopped || exitCode !== 0) return null;
  // The last thing the scanner said that sums it up ("Done. 5/5 bridges mapped.").
  const last = [...log].reverse().map((l) => String(l).trim()).find((l) => l && l !== 'Finished.' && !/^Speed:/.test(l)) || '';
  return {
    user_id: userId || null,
    type: 'scan_done',
    title: name(target),
    message: last.slice(0, 140),
    icon: '📡',
    data: { action, personId: target?.id ?? null },
  };
}

// Older notifications name their person only in the title.
const NAME_IN_TITLE = [
  [/^(.+?) accepted!/, 1],
  [/^High-value connection: (.+)$/, 1],
  [/^Catalyst discovered: (.+)$/, 1],
  [/^(.+?) added you back/, 1],
];

/**
 * Who a notification is about, from the rows on screen: { person, via, people }.
 * `via` is who you met them through: the notification's own, else the person's
 * recorded introducer. `people` are everyone it names (a top-company list).
 */
export function noteSubject(note, connections = [], degree2 = []) {
  const all = [...(connections || []), ...(degree2 || [])];
  const byId = new Map(all.map((r) => [r.id, r]));
  const data = typeof note?.data === 'string' ? safeJson(note.data) : note?.data || {};
  let person = data.personId != null ? byId.get(data.personId) : null;
  if (!person && data.profileUrl) person = all.find((r) => r.profile_url === data.profileUrl) || null;
  if (!person) {
    for (const [re, i] of NAME_IN_TITLE) {
      const m = String(note?.title || '').match(re);
      if (!m) continue;
      const name = m[i].trim().toLowerCase();
      person = (connections || []).find((r) => String(r.name || '').toLowerCase() === name)
        || (degree2 || []).find((r) => String(r.name || '').toLowerCase() === name) || null;
      if (person) break;
    }
  }
  const viaId = data.viaId ?? person?.unlocked_from_bridge_id ?? (person?.degree === 2 ? person.source_connection_id : null);
  const via = viaId != null ? byId.get(viaId) || null : null;
  const people = (data.personIds || []).map((id) => byId.get(id)).filter(Boolean);
  return { person: person || null, via, people, data };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
