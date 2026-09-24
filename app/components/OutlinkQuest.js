'use client';

// Outlink, as a game (lib/quest.js has the rules). Three things on screen:
//   1. Where you are: level, points to the next, invites sent, people added.
//   2. Next best moves: the three people most worth an invite right now.
//   3. Clusters: each mapped connection's circle, with a ring that fills as you
//      reach its best people, five at a time. Clear a stage and the next five
//      appear; anyone who accepts becomes a new door — a circle to map next.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { buildQuest, XP_SEND, STAGE_SIZE } from '../../lib/quest';
import { initialsFor } from '../../lib/tiers';

const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const LINE = '1px solid rgba(255,255,255,0.1)';

function Face({ person, size = 36, ring }) {
  const color = TIER[person?.tier] || '#667';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%', background: color, color: person?.tier === 'S' ? '#000' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.34, fontWeight: 800,
        border: `2px solid ${ring || color}`,
      }}>{initialsFor(person?.name || '?')}</div>
      {person?.profile_image_url && (
        <img src={person.profile_image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ position: 'absolute', inset: 0, width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${ring || color}` }} />
      )}
    </div>
  );
}

function Ring({ progress, size = 86, color = '#FF6B35', children }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
          strokeDasharray={`${c * Math.min(1, progress)} ${c}`} style={{ transition: 'stroke-dasharray 0.5s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
    </div>
  );
}

export default function OutlinkQuest({ recs, sentIds, added, mappedIds, onSend, onUndo }) {
  const quest = useMemo(() => buildQuest({ recs, sentIds, added, mappedIds }), [recs, sentIds, added, mappedIds]);
  const [open, setOpen] = useState(null);         // bridge id of the expanded cluster
  const [toast, setToast] = useState(null);
  const { level } = quest;

  async function send(person, cluster) {
    await onSend(person);
    const done = cluster.done + 1;
    const first = String(cluster.bridge.name || '').split(/[\s,]+/)[0];
    setToast(done >= cluster.targets.length
      ? `+${XP_SEND[person.tier] || 2} · Stage ${cluster.stage} of ${first}'s circle cleared — the next ${STAGE_SIZE} are up`
      : `+${XP_SEND[person.tier] || 2} · ${first}'s circle ${done}/${cluster.targets.length}`);
    setTimeout(() => setToast(null), 3500);
  }

  const expanded = quest.clusters.find((c) => c.bridge.id === open);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 20px 60px' }}>
      {/* 1. where you are */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', padding: 16, borderRadius: 12, border: LINE, background: 'linear-gradient(135deg, rgba(255,107,53,0.10), rgba(155,89,182,0.08))' }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #FFD700, #FF6B35)', color: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 800 }}>LEVEL</div>
          <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{level.level}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, color: '#dfe6e9' }}>
            <b>{quest.points}</b> points · <b>{level.next - quest.points}</b> to level {level.level + 1}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(level.progress * 100)}%`, background: 'linear-gradient(90deg, #FFD700, #FF6B35)', transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 11.5, color: '#8b9a9a', marginTop: 6 }}>
            Points come from invites you send and people who accept — not from browsing.
          </div>
        </div>
        {[[quest.sentTotal, 'invites sent'], [quest.addedTotal, 'people added'], [quest.clearedStages, 'stages cleared']].map(([n, l]) => (
          <div key={l} style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{n}</div>
            <div style={{ fontSize: 11, color: '#8b9a9a' }}>{l}</div>
          </div>
        ))}
      </div>

      {quest.newDoors.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(0,255,136,0.3)', background: 'rgba(0,255,136,0.06)', fontSize: 13 }}>
          🚪 <b>{quest.newDoors.length} new {quest.newDoors.length === 1 ? 'door' : 'doors'}:</b> people you added through a circle, whose own circle isn&rsquo;t mapped yet.
          That&rsquo;s the next degree. <Link href="/setup" style={{ color: '#00ff88' }}>Map them on the Scan page →</Link>
        </div>
      )}

      {/* 2. next best moves */}
      {quest.nextMoves.length > 0 && (
        <>
          <h3 style={{ margin: '22px 0 10px', fontSize: 15 }}>Next best moves</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {quest.nextMoves.map(({ person, cluster }, i) => (
              <div key={person.id} style={{ padding: 14, borderRadius: 12, border: `1px solid ${TIER[person.tier]}55`, background: 'rgba(255,255,255,0.03)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 11, fontWeight: 800, color: '#FF6B35' }}>#{i + 1}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Face person={person} size={44} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{person.name}</div>
                    <div style={{ fontSize: 11.5, color: '#8b9a9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{person.headline}</div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: '#aab7b7', margin: '10px 0' }}>
                  via <b style={{ color: TIER[cluster.bridge.tier] }}>{cluster.bridge.name}</b> · their circle {cluster.done}/{cluster.targets.length} this stage
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {person.profile_url && (
                    <a href={person.profile_url} target="_blank" rel="noopener noreferrer" style={btnGhost}>Open on LinkedIn</a>
                  )}
                  <button onClick={() => send(person, cluster)} style={btnHot}>I sent an invite · +{XP_SEND[person.tier] || 2}</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 3. clusters */}
      <h3 style={{ margin: '26px 0 4px', fontSize: 15 }}>Circles to work through</h3>
      <div style={{ fontSize: 12, color: '#8b9a9a', marginBottom: 12 }}>
        Each is one of your connections and the best people they know, {STAGE_SIZE} at a time. Fill the ring to clear a stage.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
        {quest.clusters.map((c) => {
          const isOpen = open === c.bridge.id;
          return (
            <button key={c.bridge.id} onClick={() => setOpen(isOpen ? null : c.bridge.id)} style={{
              padding: 12, borderRadius: 12, cursor: 'pointer', textAlign: 'center', color: '#fff',
              border: isOpen ? '1px solid #FF6B35' : LINE, background: c.complete ? 'rgba(0,255,136,0.06)' : 'rgba(255,255,255,0.03)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            }}>
              <Ring progress={c.progress} color={c.complete ? '#00ff88' : '#FF6B35'}>
                <Face person={c.bridge} size={60} />
              </Ring>
              <div style={{ fontWeight: 700, fontSize: 13, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.bridge.name}</div>
              <div style={{ fontSize: 11, color: c.complete ? '#00ff88' : '#aab7b7' }}>
                {c.complete ? 'Circle cleared' : `Stage ${c.stage} of ${c.stages} · ${c.done}/${c.targets.length}`}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {c.targets.map((p) => (
                  <span key={p.id} title={p.name} style={{
                    width: 12, height: 12, borderRadius: '50%', border: `2px solid ${TIER[p.tier] || '#667'}`,
                    background: sentIds.has(p.id) ? TIER[p.tier] || '#667' : 'transparent',
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: '#778' }}>
                {c.open.S ? `${c.open.S} S · ` : ''}{c.open.A ? `${c.open.A} A · ` : ''}{c.people.length} worth adding{c.added.length ? ` · ★ ${c.added.length} added` : ''}
              </div>
            </button>
          );
        })}
      </div>

      {expanded && (
        <div style={{ marginTop: 14, padding: 16, borderRadius: 12, border: '1px solid rgba(255,107,53,0.4)', background: 'rgba(255,107,53,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Face person={expanded.bridge} size={40} />
            <div>
              <div style={{ fontWeight: 800 }}>{expanded.bridge.name}&rsquo;s circle · stage {expanded.stage} of {expanded.stages}</div>
              <div style={{ fontSize: 12, color: '#aab7b7' }}>Ask {expanded.bridge.name?.split(' ')[0]} for an intro, or invite them directly. Mark each one when it&rsquo;s sent.</div>
            </div>
          </div>
          {expanded.targets.map((p) => {
            const sent = sentIds.has(p.id);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <Face person={p} size={34} ring={sent ? '#00ff88' : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name} <span style={{ color: TIER[p.tier], fontSize: 11 }}>{p.tier}</span></div>
                  <div style={{ fontSize: 11.5, color: '#8b9a9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.headline}</div>
                </div>
                {p.profile_url && <a href={p.profile_url} target="_blank" rel="noopener noreferrer" style={btnGhost}>LinkedIn</a>}
                {sent
                  ? <button onClick={() => onUndo(p)} style={{ ...btnGhost, color: '#00ff88' }}>Sent ✓ (undo)</button>
                  : <button onClick={() => send(p, expanded)} style={btnHot}>Sent · +{XP_SEND[p.tier] || 2}</button>}
              </div>
            );
          })}
          {expanded.added.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#00ff88' }}>
              ★ Added from this circle: {expanded.added.map((a) => a.name).join(', ')}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', borderRadius: 24, background: 'linear-gradient(135deg, #FFD700, #FF6B35)', color: '#000', fontWeight: 800, fontSize: 13, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const btnHot = { padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 12, background: 'linear-gradient(135deg, #FF6B35, #FFD700)', color: '#000' };
const btnGhost = { padding: '7px 12px', borderRadius: 8, border: LINE, cursor: 'pointer', fontWeight: 600, fontSize: 12, background: 'rgba(255,255,255,0.05)', color: '#dfe6e9', textDecoration: 'none' };
