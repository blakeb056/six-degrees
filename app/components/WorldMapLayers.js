'use client';

// The Map tab's views and their legends (app/components/WorldMap.js draws the
// map; lib/map-visuals.js does the sums). One control card, one question at a
// time (Blake, 2026-10-16: "more cool UI function and visuals for the locations
// like heat maps, line visuals ... and make it more clean"):
//   Places   where are my people?                   the dots, as the mix of tiers or degrees
//   Heat     where do my S tier, or my 2nd degree, cluster?   a density surface, its densest place a click away
//   Flows    where do my connections' circles live, place to place?   the busiest routes; a route lists who carries it
//   Hubs     which places reach furthest?             places ranked by the people there plus who they can introduce
// and, whenever someone's card is open, the path to them across the map.

import { HEAT_OF } from '../../lib/map-visuals';
import {
  TIERS, DEGREE_NAMES, LINE, fmt, plural, tierFill, degreeFill, firstName, card, smallButton, byStrength, outlinkFor,
  PersonRow, SidePanel,
} from './WorldMapParts';

export const MAP_VIEWS = Object.freeze([
  { key: 'places', label: 'Places', question: 'Where your people are. Pick a place for who gets you there.' },
  { key: 'heat', label: 'Heat', question: 'Where a group of them clusters, as a smooth surface.' },
  { key: 'flows', label: 'Flows', question: 'Where your connections’ circles live: the busiest routes, from them to their people.' },
  { key: 'hubs', label: 'Hubs', question: 'Places by reach: your people there, plus everyone they can introduce you to.' },
]);

const FLOW_STEPS = [20, 40, 80];


// Remembered in this browser, a convenience only: which view and which heat.
const LOOK_KEY = 'six-degrees-map-look';
export function readLook() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) || '{}');
    return {
      view: MAP_VIEWS.some((v) => v.key === raw?.view) ? raw.view : 'places',
      heatOf: HEAT_OF.some((h) => h.key === raw?.heatOf) ? raw.heatOf : 'all',
      flowMax: FLOW_STEPS.includes(raw?.flowMax) ? raw.flowMax : 40,
    };
  } catch {
    return { view: 'places', heatOf: 'all', flowMax: 40 };
  }
}
export function writeLook(look) {
  try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* storage off: this visit only */ }
}

const sub = { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--sd-fg-5, #667)' };
const note = { fontSize: 10.5, color: 'var(--sd-fg-4, #778)', lineHeight: 1.45 };

/** A row of buttons, one pressed: the theme's accent, never a fixed blue. */
export function MapSeg({ value, onChange, options, label, wide = false, small = false }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: LINE, width: wide ? '100%' : undefined }}>
      {options.map(([v, text, title]) => {
        const on = value === v;
        return (
          <button key={v} type="button" aria-pressed={on} title={title} onClick={() => onChange(v)} className="sd-map-seg" style={{
            flex: wide ? 1 : undefined, padding: small ? '3px 7px' : '5px 10px', fontSize: small ? 10.5 : 11.5, fontWeight: 650,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            background: on ? 'color-mix(in srgb, var(--sd-accent, #3498db) 24%, transparent)' : 'transparent',
            color: on ? 'var(--sd-fg-1, #fff)' : 'var(--sd-fg-3, #889)',
          }}>{text}</button>
        );
      })}
    </div>
  );
}

/** Places: Tier or Degree, and what each colour is. */
export function DotLegend({ colourBy, setColourBy, phone }) {
  const keys = colourBy === 'tier' ? TIERS.map((t) => [t, tierFill(t)]) : [1, 2, 3].map((d) => [DEGREE_NAMES[d], degreeFill(d)]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <MapSeg value={colourBy} onChange={setColourBy} label="Colour the dots by" small options={[['tier', 'Tier'], ['degree', 'Degree']]} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: phone ? 6 : 8, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--sd-fg-3, #889)' }}>
        {keys.map(([name, colour]) => (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="sd-dot-html" style={{ width: 8, height: 8, borderRadius: '50%', background: colour, display: 'inline-block' }} />{name}
          </span>
        ))}
      </span>
    </div>
  );
}

/** The two colours a heat map runs between: its group's own, warming to the top tier's at the core. */
export function heatColours(of) {
  switch (of) {
    case 'S': return [tierFill('S'), tierFill('S')];
    case 'SA': return [tierFill('A'), tierFill('S')];
    case 'd1': return [degreeFill(1), degreeFill(1)];
    case 'd2': return [degreeFill(2), degreeFill(2)];
    case 'd3': return [degreeFill(3), degreeFill(3)];
    default: return ['var(--sd-accent, #3498db)', tierFill('S')];
  }
}
/** One contour level's fill: `level` 0 (the faint edge) to 1 (the core). */
export const heatFill = (of, level) => {
  const [base, hot] = heatColours(of);
  return base === hot ? base : `color-mix(in srgb, ${hot} ${Math.round(Math.pow(level, 1.3) * 100)}%, ${base})`;
};

/** Heat: whose heat, the scale, and the densest place, one click from its list. */
export function HeatLegend({ heatOf, setHeatOf, heat, onDensest }) {
  const [base, hot] = heatColours(heatOf);
  const group = HEAT_OF.find((h) => h.key === heatOf) || HEAT_OF[0];
  const top = heat?.densest;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <MapSeg value={heatOf} onChange={setHeatOf} label="Heat of" wide small
        options={HEAT_OF.map((h) => [h.key, h.short, `Where your ${h.label === 'Everyone' ? 'network' : h.label} is densest`])} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, color: 'var(--sd-fg-4, #778)' }}>
        <span>Fewer</span>
        <span aria-hidden="true" style={{
          flex: 1, height: 7, borderRadius: 4, border: LINE,
          background: `linear-gradient(90deg, color-mix(in srgb, ${base} 12%, transparent), color-mix(in srgb, ${base} 55%, transparent) 45%, ${hot})`,
        }} />
        <span>More</span>
      </div>
      {heat && !heat.people ? (
        <div style={note}>No {group.label === 'Everyone' ? 'one' : group.label} on the map with these filters.</div>
      ) : top ? (
        <button type="button" onClick={() => onDensest(top.place)} className="sd-map-row" style={{
          ...smallButton, border: 'none', padding: '2px 0', textAlign: 'left', whiteSpace: 'normal', color: 'var(--sd-fg-3, #889)', fontWeight: 600,
        }} title="Go there and see who gets you there">
          Densest: <span style={{ color: 'var(--sd-fg-1, #fff)' }}>{top.place.name}</span>, {plural(top.weight, 'person', 'people')}
          {heat.people ? ` of ${fmt(heat.people)}` : ''} &rarr;
        </button>
      ) : null}
    </div>
  );
}

/** Flows: how many routes, how thick is how many, and the colours. */
export function FlowLegend({ flows, drawn, max, setMax, steps, from, widthOf }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <MapSeg value={max} onChange={setMax} label="How many routes" small options={FLOW_STEPS.map((n) => [n, `Top ${n}`])} />
        {steps.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--sd-fg-4, #778)' }}>
            {steps.map((n) => (
              <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <svg width="20" height="10" aria-hidden="true"><line x1="2" y1="5" x2="18" y2="5" strokeLinecap="round" style={{ stroke: 'var(--sd-accent, #3498db)' }} strokeWidth={widthOf(n)} /></svg>
                {fmt(n)}
              </span>
            ))}
          </span>
        )}
      </div>
      <div style={note}>
        {!flows ? 'Working out the routes…'
          : !flows.flows.length ? 'No routes yet: scan a connection’s circle and the places their people live show here.'
            : from ? `${plural(drawn, 'route')} from ${from.name}: where the circles of your connections there live.`
              : `The busiest ${fmt(drawn)} of ${plural(flows.flows.length, 'route')}, as thick as how many people. A route lists who carries it.`}
      </div>
    </div>
  );
}

/** Hubs, in the card: what the rings and numbers mean. */
export function HubLegend({ hubs, phone }) {
  if (!hubs) return null;
  if (!hubs.length) return <div style={note}>No places on the map yet.</div>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10.5, color: 'var(--sd-fg-3, #889)', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" strokeWidth="1.2" strokeDasharray="3 2" style={{ fill: 'var(--sd-accent, #3498db)', fillOpacity: 0.1, stroke: 'var(--sd-accent, #3498db)' }} /></svg>
        reach
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span aria-hidden="true" style={{ width: 15, height: 15, borderRadius: '50%', background: 'var(--sd-accent, #3498db)', color: 'var(--sd-bg, #0a0a1a)', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
        rank
      </span>
      <span style={{ color: 'var(--sd-fg-4, #778)' }}>The top {fmt(hubs.length)} are listed {phone ? 'below' : 'at the right'}.</span>
    </div>
  );
}

/** Hubs: the top places by reach, a panel at the right; each a click from the map flying there. */
export function HubPanel({ hubs, pickedKey, onPick, phone, below, sheet, onClose }) {
  if (!hubs?.length) return null;
  const most = hubs[0].reach || 1;
  return (
    <SidePanel label="Top places by reach" title="Top places" phone={phone} below={below} sheet={sheet} onClose={onClose}
      subtitle="Ranked by reach: the people there, plus everyone your connections there can introduce you to. A place opens who gets you there.">
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {hubs.map((hub, i) => {
          const on = hub.place.key === pickedKey;
          return (
            <li key={hub.place.key}>
              <button type="button" onClick={() => onPick(hub.place)} aria-current={on ? 'true' : undefined} className="sd-map-row"
                style={{
                  display: 'grid', gridTemplateColumns: '20px 1fr auto', alignItems: 'center', columnGap: 8, width: '100%', padding: '7px 8px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                  background: on ? 'color-mix(in srgb, var(--sd-accent, #3498db) 16%, transparent)' : 'transparent',
                }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--sd-accent, #3498db)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--sd-fg-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hub.place.label}</span>
                  <span aria-hidden="true" style={{ display: 'flex', height: 4, borderRadius: 2, margin: '4px 0 3px', overflow: 'hidden', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.08)' }}>
                    <span style={{ width: `${(hub.here / most) * 100}%`, background: 'var(--sd-fg-3, #889)' }} />
                    <span style={{ width: `${(hub.through / most) * 100}%`, background: 'var(--sd-accent, #3498db)' }} />
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--sd-fg-4, #778)' }}>
                    {fmt(hub.here)} here{hub.through ? `, ${fmt(hub.through)} more through ${plural(hub.bridges, 'connection')}` : ''}{hub.strong ? ` · ${fmt(hub.strong)} S or A` : ''}
                  </span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--sd-fg-2, #cfd8d8)', fontVariantNumeric: 'tabular-nums' }}>{fmt(hub.reach)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div style={{ ...note, display: 'flex', gap: 12, padding: '6px 8px 8px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 4, borderRadius: 2, background: 'var(--sd-fg-3, #889)' }} />here</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 4, borderRadius: 2, background: 'var(--sd-accent, #3498db)' }} />through them</span>
      </div>
    </SidePanel>
  );
}

/**
 * The path to someone whose card is open: you, then each person along their
 * chain, each at their place. A step flies the map there; the last of your
 * connections on it, whose circle they're in, is who to ask for the intro (Outlink).
 */
export function PathCard({ person, path, phone, below, canOutlink, onStep, onFit, onReach = null, onClose, homeGuessed }) {
  if (!person || !path) return null;
  const name = person.name || 'Them';
  // Who to ask: the last of your connections on the way, the one whose circle they're in.
  const ask = [...path.steps].reverse().find((s) => s.person && s.person.id !== person.id && (Number(s.person.degree) || 1) === 1)?.person;
  const far = path.known && (Number(person.degree) || 1) > 1;
  const unplaced = path.steps.filter((s) => s.person && !s.place).length;
  const words = !path.known
    ? `Who ${firstName(name)} came through isn’t on file, so there’s no path from you.`
    : !path.legs.length
      ? (path.steps.every((s) => !s.place) ? 'No one on this path has a location yet.' : 'Everyone on this path is in one place.')
      : `${plural(path.legs.length, 'leg')} across the map${unplaced ? `; ${fmt(unplaced)} on it with no location yet` : ''}.`;
  return (
    <section aria-label={`How you reach ${name}`} data-map-path="" style={{
      ...card, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
      ...(phone ? { position: 'absolute', left: 8, right: 8, bottom: below + 8, zIndex: 2 } : {}),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...sub, color: 'var(--sd-accent, #3498db)' }}>Chain</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, color: 'var(--sd-fg-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>You to {name}, on the map</span>
        {path.legs.length > 0 && <button type="button" onClick={onFit} style={smallButton} title="Fit the whole path on screen">Fit</button>}
        <button type="button" aria-label="Hide the path" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1, color: 'var(--sd-fg-3, #889)', padding: 2 }}>&times;</button>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {path.steps.map((s, i) => (
          <li key={s.person ? `p${s.person.id}` : 'you'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span aria-hidden="true" style={{ color: 'var(--sd-fg-4, #778)', fontSize: 11 }}>&rarr;</span>}
            <button type="button" disabled={!s.place} onClick={() => onStep(s)} className="sd-map-row" title={s.place ? `${s.place.label}${!s.person && homeGuessed ? ' (home, guessed: where most of your connections are)' : ''}` : 'No location yet'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', borderRadius: 999, fontFamily: 'inherit', cursor: s.place ? 'pointer' : 'default',
                border: s.person?.id === person.id ? '1px solid color-mix(in srgb, var(--sd-accent, #3498db) 60%, transparent)' : LINE, background: 'transparent',
              }}>
              <span aria-hidden="true" style={{
                width: 16, height: 16, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800,
                background: s.person ? tierFill(TIERS.includes(s.person.tier) ? s.person.tier : 'D') : 'var(--sd-fg-1, #fff)', color: 'var(--sd-bg, #0a0a1a)',
              }}>{s.step == null ? '?' : s.step === 0 ? '' : s.step}</span>
              <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--sd-fg-1, #fff)' }}>{s.person ? firstName(s.person.name) : 'You'}</span>
              <span style={{ fontSize: 10.5, color: 'var(--sd-fg-4, #778)' }}>{s.place ? s.place.name : 'no location'}</span>
            </button>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...note, flex: 1, minWidth: 160 }}>{words}</span>
        {onReach && <button type="button" onClick={onReach} style={smallButton} title={`Lines from ${name} to everywhere their circle lives`}>Where {firstName(name)}&rsquo;s circle lives</button>}
        {far && ask && canOutlink && (
          <a href={outlinkFor(ask.id)} style={{ ...smallButton, textDecoration: 'none', color: 'var(--sd-orange, #FF6B35)' }} title="Outlink, filtered to who they can introduce you to">
            Ask {firstName(ask.name)} for an intro
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * One route: from where some of your connections are to where people in their
 * circles are. Who carries it (each with their reach and the intro), then who's at the end.
 */
export function FlowPanel({ flow, canOutlink, phone, below, sheet, selectedId, onSelect, onLines, onClose }) {
  const people = [...flow.people].sort(byStrength).slice(0, 100);
  return (
    <SidePanel label={`Route from ${flow.from.label} to ${flow.to.label}`} title={`${flow.from.name} → ${flow.to.name}`} phone={phone} below={below} sheet={sheet} onClose={onClose}
      subtitle={`${plural(flow.count, 'person', 'people')} in ${flow.to.name}${flow.strong ? ` (${fmt(flow.strong)} S or A)` : ''}, through ${plural(flow.bridges.length, 'connection')} in ${flow.from.name}.`}>
      <div style={{ padding: '6px 8px 8px', borderBottom: LINE }}>
        <div style={sub}>Who carries it</div>
        {flow.bridges.slice(0, 40).map(({ bridge, count }) => (
          <div key={bridge.id}>
            <PersonRow p={bridge} selectedId={selectedId} onSelect={onSelect} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 6px 42px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #889)' }}>knows {fmt(count)} in {flow.to.name}</span>
              <button type="button" onClick={() => onLines(bridge.id)} style={smallButton} title={`Lines from ${bridge.name} to everywhere their circle lives`}>Their reach</button>
              {canOutlink && <a href={outlinkFor(bridge.id)} style={{ ...smallButton, textDecoration: 'none', color: 'var(--sd-orange, #FF6B35)' }} title="Outlink, filtered to who they can introduce you to">Ask for an intro</a>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...sub, padding: '8px 8px 2px' }}>In {flow.to.name}</div>
      {people.map((p) => <PersonRow key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} />)}
      {flow.people.length > people.length && <div style={{ ...note, padding: '4px 8px' }}>and {plural(flow.people.length - people.length, 'other')}</div>}
    </SidePanel>
  );
}
