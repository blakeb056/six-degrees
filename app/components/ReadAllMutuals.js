'use client';

// Read all mutuals, the mutual web's paid step (lib/mutual-web.js): the "N other
// mutual connections" of one person read in full, one round at a time, each of
// your connections on it kept as a tie (scrape.py scan_mutual_list). Only when
// pressed, never by itself: every page is a search in the scan window, so it is
// offered on Breach's Summit and your top-tier bridges only (offersMutualList).
// Starts like every Scan button (lib/scraper-client.js startHere), greys out
// while anything runs, and says why it didn't start beside it.

import { useState } from 'react';
import useScanner from './useScanner';
import InlineNote, { useFadingNote } from './InlineNote';
import { startHere, busyReason } from '../../lib/scraper-client';
import { MUTUAL_ROUND, mutualListNote } from '../../lib/mutual-web';

/** `person` is their row (a seen copy's own row by person_id); `note` how far an earlier read got (mutualNotes). */
export default function ReadAllMutuals({ person, note = null, pages = MUTUAL_ROUND, small = false, style = null }) {
  const scan = useScanner();
  const [asking, setAsking] = useState(false);
  const [said, say] = useFadingNote(9000);
  const id = person?.person_id || person?.id;
  if (!id || !person?.profile_url) return null;
  const first = String(person.name || 'them').split(' ')[0];
  const mine = scan.running && scan.action === 'mutuals' && scan.target?.id === id;
  const busy = scan.running && !mine ? busyReason(scan) : null;
  const go = async () => {
    setAsking(true);
    // Every page read: "Read all mutuals again" is the asking (scrape.py --again, Blake, 2026-10-17).
    const why = await startHere('mutuals', { id, name: person.name, pages, ...(how === 'every page read' ? { again: true } : {}) });
    setAsking(false);
    say(why ? `Didn’t start: ${why}` : null);
  };
  const how = mutualListNote(note);
  const title = `The mutual connections you share with ${person.name || 'them'}, read in full, ${pages} pages a round: `
    + 'each page is a search in the scan window, and each of your connections on it is kept as a tie (seen together, not close). '
    + 'Only when you press it.' + (how ? ` Read before: ${how}.` : '');
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
      <button type="button" onClick={go} disabled={Boolean(mine || busy || asking)} title={busy ? `${busy}. One scan at a time.` : title}
        style={{
          fontFamily: 'inherit', fontSize: small ? 10.5 : 11.5, fontWeight: 700, whiteSpace: 'nowrap', cursor: mine || busy || asking ? 'default' : 'pointer',
          padding: small ? '3px 8px' : '5px 11px', borderRadius: 999, opacity: busy ? 0.55 : 1,
          color: 'var(--sd-fg-1, #fff)', background: 'transparent', border: '1px solid rgba(var(--sd-ink, 255, 255, 255), 0.22)',
        }}>
        {mine ? `Reading ${first}’s mutuals…` : asking ? 'Starting…' : how === 'every page read' ? 'Read all mutuals again' : 'Read all mutuals'}
      </button>
      {!small && how && !mine && <span style={{ fontSize: 10.5, color: 'var(--sd-fg-3, #999)' }}>{how}</span>}
      <InlineNote note={said} float />
    </span>
  );
}
