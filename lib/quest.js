// Outlink as a game: every mapped connection's circle is a cluster to work
// through, a few people at a time.
//
// A long ranked list of strangers is daunting, and nothing in it says you're
// getting anywhere. Here each cluster offers its best few people (a "stage");
// send invites to them and the ring fills, the stage clears, and the next few
// appear. Someone who accepts becomes your connection — and their circle is the
// next degree to map. Points come only from real events (invites you marked
// sent, people who actually joined your network), never from browsing.
// Plain functions; tests/quest.test.mjs.

export const STAGE_SIZE = 5;
export const XP_SEND = { S: 25, A: 15, B: 10, C: 5, D: 2 };
export const XP_ADDED = { S: 100, A: 60, B: 35, C: 15, D: 5 };

/** Level from points: each level needs a little more than the last. */
export function levelFor(points) {
  const level = Math.floor(Math.sqrt(Math.max(0, points) / 40)) + 1;
  const floor = (level - 1) ** 2 * 40;
  const next = level ** 2 * 40;
  return { level, floor, next, progress: (points - floor) / (next - floor) };
}

/**
 * @param recs    2nd-degree people worth adding: { id, profile_url, tier, priority, bridge }
 * @param sentIds ids marked "invite sent"
 * @param added   1st-degree people who came through a cluster (unlocked_from_bridge_id set)
 * @param mappedIds ids of 1st-degree people whose own circle is mapped
 */
export function buildQuest({ recs = [], sentIds = new Set(), added = [], mappedIds = new Set() }) {
  const byBridge = new Map();
  const seen = new Set();
  for (const r of [...recs].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
    if (!r.bridge) continue;
    const k = `${r.bridge.id}|${r.profile_url || r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let c = byBridge.get(r.bridge.id);
    if (!c) { c = { bridge: r.bridge, people: [] }; byBridge.set(r.bridge.id, c); }
    c.people.push(r);
  }
  const addedBy = new Map();
  for (const a of added) {
    const id = a.unlocked_from_bridge_id;
    if (!id) continue;
    addedBy.set(id, [...(addedBy.get(id) || []), a]);
  }

  const clusters = [];
  let points = 0;
  let sentTotal = 0;
  for (const { bridge, people } of byBridge.values()) {
    const sent = people.filter((p) => sentIds.has(p.id));
    const addedHere = addedBy.get(bridge.id) || [];
    sentTotal += sent.length;
    points += sent.reduce((s, p) => s + (XP_SEND[p.tier] || 2), 0);
    points += addedHere.reduce((s, p) => s + (XP_ADDED[p.tier] || 5), 0);

    // Stages are the cluster's people in priority order, STAGE_SIZE at a time.
    // The current stage is the first one not fully sent.
    const stages = Math.ceil(people.length / STAGE_SIZE) || 1;
    let stage = 0;
    while (stage < stages - 1 && people.slice(stage * STAGE_SIZE, (stage + 1) * STAGE_SIZE).every((p) => sentIds.has(p.id))) stage++;
    const targets = people.slice(stage * STAGE_SIZE, (stage + 1) * STAGE_SIZE);
    const done = targets.filter((p) => sentIds.has(p.id)).length;
    const complete = done === targets.length && stage === stages - 1;
    clusters.push({
      bridge,
      people,
      stage: stage + 1,
      stages,
      targets,
      done,
      progress: targets.length ? done / targets.length : 1,
      complete,
      sent: sent.length,
      added: addedHere,
      value: targets.filter((p) => !sentIds.has(p.id)).reduce((s, p) => s + (p.priority || 0), 0),
      open: { S: targets.filter((p) => p.tier === 'S' && !sentIds.has(p.id)).length, A: targets.filter((p) => p.tier === 'A' && !sentIds.has(p.id)).length },
    });
  }

  // In progress first (closest to clearing), then untouched by value; finished last.
  clusters.sort((a, b) =>
    (a.complete - b.complete)
    || ((b.progress > 0 && b.progress < 1) - (a.progress > 0 && a.progress < 1))
    || (b.progress - a.progress)
    || (b.value - a.value));

  // The next best moves: the most valuable open people, nudged towards clusters
  // you've started, so finishing a stage is always within reach.
  const moves = clusters.filter((c) => !c.complete).flatMap((c) =>
    c.targets.filter((p) => !sentIds.has(p.id)).map((p) => ({
      person: p, cluster: c, score: (p.priority || 0) * (1 + 0.6 * c.progress),
    })))
    .sort((a, b) => b.score - a.score);
  const seenPeople = new Set();
  const nextMoves = [];
  for (const m of moves) {
    const k = m.person.profile_url || m.person.id;
    if (seenPeople.has(k)) continue;
    seenPeople.add(k);
    nextMoves.push(m);
    if (nextMoves.length === 3) break;
  }

  const addedTotal = added.filter((a) => a.unlocked_from_bridge_id).length;
  return {
    clusters,
    nextMoves,
    points,
    level: levelFor(points),
    sentTotal,
    addedTotal,
    // People you've added whose own circle isn't mapped yet: the next degree.
    newDoors: added.filter((a) => a.unlocked_from_bridge_id && !mappedIds.has(a.id)),
    clearedStages: clusters.reduce((s, c) => s + (c.stage - 1) + (c.complete ? 1 : 0), 0),
  };
}
