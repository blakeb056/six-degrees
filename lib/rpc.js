import { getDb, nowIso } from './db-client.js';

// Replacements for the three stored procedures the hosted database used to
// provide. scripts/score_new_connections.sql remains the reference model —
// the CASE ladders below are a direct transcription of it and any change must
// be made in both places.

const SENIORITY = [
  [/CEO|Chief|Founder|President|Owner/i, 10],
  [/VP|Vice President|SVP|EVP|Managing Director|Global Head|Country Director/i, 9],
  [/Senior Director|Director|Head of|Country Lead/i, 8],
  [/Senior Manager|Manager,|Engineering Manager|Group Product/i, 7],
  [/Lead|Principal|Staff|Senior.*Engineer|Senior.*Designer|Senior.*Manager/i, 6],
  [/Partner|Client Partner|Account Manager|Strategist/i, 5],
  [/Engineer|Developer|Designer|Analyst|Coordinator/i, 4],
  [/Intern|Student|Undergraduate|Junior|Entry/i, 2],
];

const PRESTIGE = [
  [/^Google|^Meta |^Apple$|^Microsoft|^Amazon|^NVIDIA|^Tesla$/i, 10],
  [/Snap|Snapchat/i, 9],
  [/Goldman Sachs|BlackRock|Merrill Lynch|McKinsey|BCG|^Deloitte|Heidrick|Boies Schiller/i, 9],
  [/Polymarket|Anduril|CoreWeave|^Stripe$|Palantir/i, 9],
  [/Coca-Cola|The Coca-Cola/i, 9],
  [/Pinterest|TikTok|Roku|Netflix|Uber|Spotify|Databricks|Datadog|OpenAI|Anthropic/i, 8],
  [/SpaceX|Lockheed Martin|Northrop|Siemens|Boeing|Raytheon|Disney/i, 8],
  [/Nike|LVMH|Unilever|Danone|Beiersdorf|Starbucks|PepsiCo|Pepsico/i, 8],
  [/Whatnot|BNY|Bank of New York|ServiceNow|Salesforce|Visa|Oracle|IBM/i, 8],
  [/World Bank|Goodyear|Kellanova|Kellogg|Campbell/i, 8],
  [/U\.S\. Space Force|Space Force/i, 8],
  [/Mercury|Credit Karma|Capital One|PayPal|Plaid|Coinbase|Scale AI|Chick-fil-A/i, 7],
  [/WPP|Intel|AMD|Figma|Notion|Vercel/i, 7],
  [/Hard Rock Digital|Beam|Later|Vanta|Kaseya/i, 6],
];

export function seniorityOf(role = '', headline = '') {
  for (const [re, score] of SENIORITY) if (re.test(role)) return score;
  if (/Student|UCF|University/i.test(headline) && !/Manager|Lead|Director|VP|CEO/i.test(role)) return 1;
  return 3;
}

export function prestigeOf(company = '') {
  if (!company) return 2;
  for (const [re, score] of PRESTIGE) if (re.test(company)) return score;
  return 4;
}

export function influenceBonus(headline = '') {
  if (/billion|million|M\+|B\+|Forbes|YC|a16z|venture|investor|Wharton|MIT|Stanford/i.test(headline)) return 2;
  if (/award|patent|speaker|author|TEDx|Board Member|Board Director/i.test(headline)) return 1.5;
  return 0;
}

export function recencyBonus(degree, connectedDate) {
  if (degree !== 1 || !connectedDate) return 0;
  const then = new Date(connectedDate);
  if (isNaN(then.getTime())) return 0;
  const days = (Date.now() - then.getTime()) / 86_400_000;
  return days <= 30 ? 0.5 : 0;
}

export function tierFor(power) {
  if (power >= 7) return 'S';
  if (power >= 5.5) return 'A';
  if (power >= 4) return 'B';
  if (power >= 2.5) return 'C';
  return 'D';
}

// Scores only rows whose tier is still NULL, exactly like the SQL original,
// so it is safe to call after every ingest.
function scoreNewConnections() {
  const db = getDb();
  const rows = db.prepare('SELECT id, role, headline, company, degree, connected_date FROM linkedin_connections WHERE tier IS NULL').all();
  const update = db.prepare(
    'UPDATE linkedin_connections SET seniority_score = ?, company_prestige_score = ?, power_score = ?, tier = ?, updated_at = ? WHERE id = ?'
  );
  for (const r of rows) {
    const seniority = seniorityOf(r.role || '', r.headline || '');
    const prestige = prestigeOf(r.company || '');
    const power = seniority * 0.5 + prestige * 0.3 + influenceBonus(r.headline || '') + recencyBonus(r.degree, r.connected_date);
    update.run(seniority, prestige, power, tierFor(power), nowIso(), r.id);
  }
  return { scored: rows.length };
}

function incrementXp({ amount = 0 } = {}) {
  const db = getDb();
  const stats = db.prepare('SELECT id, xp FROM user_stats LIMIT 1').get();
  if (!stats) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO user_stats (id, xp) VALUES (?, ?)').run(id, amount);
    return { xp: amount };
  }
  const xp = (stats.xp || 0) + amount;
  db.prepare('UPDATE user_stats SET xp = ?, last_active_at = ? WHERE id = ?').run(xp, nowIso(), stats.id);
  return { xp };
}

export async function runRpc(name, args = {}) {
  try {
    if (name === 'score_new_connections') return { data: scoreNewConnections(), error: null };
    if (name === 'increment_xp') return { data: incrementXp(args), error: null };
    if (name === 'exec_sql') {
      // Intentionally unsupported. The hosted build exposed arbitrary DDL over
      // an unauthenticated HTTP route; there is no local equivalent worth having.
      return { data: null, error: { message: 'exec_sql is not supported in the local build' } };
    }
    return { data: null, error: { message: `Unknown function: ${name}` } };
  } catch (err) {
    return { data: null, error: { message: err.message } };
  }
}
