'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Section, Body, Mono, Status, Btn, LINE } from '../ui';

// Settings → Your data: where the network is kept, what it takes up, its
// backups, and how to carry it to another computer. The server does the work
// (app/api/data/…, lib/backups.js, lib/data-export.js, lib/data-import.js);
// this section only asks, on a click.
//
// An import, and a restore from a backup (which is an import of it), is
// checked and staged by its click, then replaces the network the next time Six
// Degrees starts, after a copy of what was here is kept. So the last word this
// section says about either is always how to restart.

const MB = 1024 * 1024;
const DAY_MS = 24 * 3600 * 1000;

function size(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const n = bytes / MB;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} MB`;
}

const count = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${count(n)} ${Number(n) === 1 ? one : many}`;
const people = (n) => plural(n, 'person', 'people');

function when(value, withTime = true) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

/** What a backup is, in a few words (lib/backups.js describeBackups). */
function backupLabel(b) {
  if (b.kind === 'daily') return 'Daily';
  if (b.kind === 'before-update') return b.version ? `Before version ${b.version}` : 'Before a new version';
  if (b.kind === 'before-import') return 'Before an import or a restore';
  return b.byHand ? 'Put here by hand' : 'Made by you';
}

/** What is in it, when that isn't the whole network with its photos. */
function backupHolds(b) {
  if (!b.restorable) return 'not a backup Sixgree can restore';
  if (b.format === 'sixdegrees') return 'network, photos and files';
  if (b.withFiles) return 'network, with its photos and files beside it';
  if (b.kind === 'before-update') return 'network only (made before backups had photos)';
  if (b.kind === 'before-import') return 'network only (it had no photos or files to keep)';
  return 'network only';
}

/** The server's answer, or an Error carrying its message (and its data, for the caller). */
async function answer(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || fallback), { data });
  return data;
}

const row = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' };
const small = { fontSize: 12, color: 'var(--sd-fg-4, #667)', marginTop: 10 };
const subhead = { fontSize: 14, fontWeight: 650, margin: '26px 0 4px', color: 'var(--sd-fg-1, #e8e8ee)' };
const check = { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13, color: 'var(--sd-fg-2, #c8d0d0)', lineHeight: 1.5, cursor: 'pointer' };

function Fact({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', padding: '7px 0', borderTop: LINE, fontSize: 13.5 }}>
      <span style={{ color: 'var(--sd-fg-3, #8b9a9a)' }}>{label}</span>
      <span style={{ color: 'var(--sd-fg-1, #e8e8ee)', textAlign: 'right' }}>{children}</span>
    </div>
  );
}

/** The newest backup's line: when, and whether it passed the importer's checks. */
function LastBackup({ status }) {
  const last = status?.last;
  const failed = status?.failed;
  // A backup that couldn't be made after the newest one that was: that comes first (TRAPS §7).
  const failedSince = failed && (!last || Date.parse(failed.at) > Date.parse(last.at));
  return (
    <>
      {failedSince && (
        <Status tone="bad">
          The last backup didn’t work ({when(failed.at)}): {failed.message.replace(/\.$/, '')}.
          {!last && ' There’s no backup yet.'}
        </Status>
      )}
      {last ? (
        last.verified ? (
          <Status tone={failedSince ? undefined : 'ok'}>
            Last backup: {when(last.at)}, verified{last.people != null ? ` (${people(last.people)})` : ''}.
          </Status>
        ) : (
          <Status tone="bad">
            Last backup: {when(last.at)}, but it didn’t pass its check, so it can’t be restored: {last.problem}
            {' '}Click Back up now to make a new one.
          </Status>
        )
      ) : !failedSince && (
        <Status>No backup yet. One is made each day Sixgree is open with a network in it.</Status>
      )}
    </>
  );
}

/** An import or a restore that waits for the next start, and how to restart. */
function Pending({ pending, info, busy, restarting, onRestart, onCancel }) {
  const what = pending.restoredFrom
    ? <>The backup <Mono>{pending.restoredFrom}</Mono></>
    : <>The network in the copy{pending.exportedAt ? ` saved ${when(pending.exportedAt, false)}` : ''}</>;
  return (
    <Status>
      <div style={{ fontWeight: 650 }}>{pending.restoredFrom ? 'A restore is waiting to finish.' : 'An import is waiting to finish.'}</div>
      <div>
        {what}
        {' '}({people(pending.people)}{pending.photos ? `, ${plural(pending.photos, 'photo')}` : ''}
        {pending.fromVersion ? `, from Sixgree ${pending.fromVersion}` : ''})
        {pending.replacedPeople > 0
          ? ` replaces the ${people(pending.replacedPeople)} here the next time Sixgree starts. A copy of what’s here now is kept in backups first, so it can be undone.`
          : ' becomes the network here the next time Sixgree starts.'}
        {' '}Your daily search limit, the record of searches and any pause on scanning are kept.
      </div>
      {pending.error && (
        <div style={{ color: 'var(--sd-red, #ff7676)', marginTop: 6 }}>
          The last try stopped: {pending.error.replace(/\.$/, '')}. It tries again the next time Sixgree starts.
        </div>
      )}
      {restarting ? (
        <div style={{ marginTop: 8 }}>Restarting… this page comes back in a few seconds.</div>
      ) : (
        <>
          <div style={{ marginTop: 8 }}>{info.restart.how}</div>
          {info.restart.command && <div style={{ marginTop: 6 }}><Mono>{info.restart.command}</Mono></div>}
          <div style={row}>
            {info.restart.canRestart && (
              <Btn primary onClick={onRestart} disabled={!!busy}>
                {busy === 'restart' ? 'Restarting…' : 'Restart now'}
              </Btn>
            )}
            {!pending.started && (
              <Btn onClick={onCancel} disabled={!!busy}>
                {busy === 'cancel' ? 'Cancelling…' : pending.restoredFrom ? 'Cancel the restore' : 'Cancel the import'}
              </Btn>
            )}
          </div>
        </>
      )}
    </Status>
  );
}

export default function DataSection() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [folderNote, setFolderNote] = useState(null);
  const [backupNote, setBackupNote] = useState(null);
  const [rowNote, setRowNote] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [exportNote, setExportNote] = useState(null);
  const [importNote, setImportNote] = useState(null);
  const [photos, setPhotos] = useState(true);
  const [social, setSocial] = useState(true);
  const [file, setFile] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const picker = useRef(null);
  const scrolled = useRef(false);

  // Read on arrival, and again after each action that changes what is shown.
  const load = useCallback(() => fetch('/api/data', { cache: 'no-store' })
    .then((r) => answer(r, 'The data folder could not be read.'))
    .then((d) => {
      const at = Date.parse(d.lastImport?.appliedAt || '');
      setInfo({ ...d, importIsRecent: Number.isFinite(at) && Date.now() - at < DAY_MS });
      setLoadError(null);
    })
    .catch((e) => setLoadError(e.message)), []);

  useEffect(() => {
    load();
  }, [load]);

  // /settings#data (the Mac app comes back here after a restart): the section
  // is drawn only once its facts arrive, after the browser's own jump.
  useEffect(() => {
    if (!info || scrolled.current) return;
    scrolled.current = true;
    if (window.location.hash === '#data') document.getElementById('data')?.scrollIntoView({ block: 'start' });
  }, [info]);

  async function copyPath() {
    setFolderNote(null);
    try {
      await navigator.clipboard.writeText(info.dataDir);
      setFolderNote({ tone: 'ok', text: 'Copied the folder’s path.' });
    } catch {
      setFolderNote({ tone: 'bad', text: 'This window can’t copy. Select the path above and copy it instead.' });
    }
  }

  async function reveal() {
    setBusy('reveal');
    setFolderNote(null);
    try {
      await answer(await fetch('/api/data/reveal', { method: 'POST' }), 'The folder could not be opened.');
      setFolderNote({ tone: 'ok', text: info.platform === 'darwin' ? 'Opened in Finder.' : 'Opened in your file browser.' });
    } catch (e) {
      setFolderNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function backUpNow() {
    setBusy('backup');
    setBackupNote(null);
    setRowNote(null);
    try {
      const d = await answer(await fetch('/api/data/backup', { method: 'POST' }), 'The backup could not be made.');
      await load();
      const b = d.backup;
      setBackupNote({
        tone: 'ok',
        text: `Backed up ${people(b.people)}${b.photos ? ` and ${plural(b.photos, 'photo')}` : ''} (${size(b.bytes)}), and checked it. This one stays until you delete it.`,
      });
    } catch (e) {
      await load();
      setBackupNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  // The server opens it (the page has no way to reach Finder itself). Where it
  // can't (no file browser on this computer), the answer names the file.
  async function revealBackup(name) {
    setBusy(`reveal:${name}`);
    setRowNote(null);
    try {
      await answer(await fetch('/api/data/reveal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup: name }),
      }), 'The backup could not be shown.');
    } catch (e) {
      setRowNote({ name, tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackup(name) {
    setBusy(`restore:${name}`);
    setRowNote(null);
    setBackupNote(null);
    try {
      await answer(await fetch('/api/data/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, replace: info.people }),
      }), 'The backup could not be restored.');
      setConfirming(null);
      await load();
    } catch (e) {
      // The network changed since this page asked: show the new count to agree to.
      if (e.data?.needsConfirm) await load();
      setRowNote({ name, tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function exportNow() {
    setBusy('export');
    setExportNote(null);
    try {
      const res = await fetch('/api/data/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos, social }),
      });
      if (!res.ok) await answer(res, 'The backup file could not be made.');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'Sixgree backup.sixdegrees';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      // Anything appended to <body> is position: fixed (TRAPS §29). Gone at once.
      a.style.position = 'fixed';
      a.style.left = '-9999px';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const inside = [people(Number(res.headers.get('x-six-degrees-people')))];
      inside.push(photos ? plural(Number(res.headers.get('x-six-degrees-photos')), 'photo') : 'no photos');
      // The page can't see where the file went: a browser puts it in its
      // downloads folder, the Mac app asks where to save it.
      setExportNote({
        tone: 'ok',
        text: `Made “${name}” (${size(blob.size)}: ${inside.join(', ')}). Look for it in your Downloads folder, or wherever you chose to save it.`,
      });
    } catch (e) {
      setExportNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  function choose(event) {
    setImportNote(null);
    setConfirmed(false);
    setFile(event.target.files?.[0] || null);
  }

  async function importNow() {
    if (!file) return;
    setBusy('import');
    setImportNote(null);
    try {
      const headers = { 'Content-Type': 'application/octet-stream', 'X-Six-Degrees-Size': String(file.size) };
      if (info.people > 0) headers['X-Six-Degrees-Replace'] = String(info.people);
      await answer(await fetch('/api/data/import', { method: 'POST', headers, body: file }), 'The file could not be restored.');
      setFile(null);
      setConfirmed(false);
      if (picker.current) picker.current.value = '';
      await load();
    } catch (e) {
      // The network changed since this page asked: show the new count to agree to.
      if (e.data?.needsConfirm) {
        setConfirmed(false);
        await load();
      }
      setImportNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function cancelImport() {
    setBusy('cancel');
    setImportNote(null);
    setBackupNote(null);
    // A restore's answer goes where it was asked for, under Backups.
    const say = info.pending?.restoredFrom ? setBackupNote : setImportNote;
    try {
      await answer(await fetch('/api/data/import', { method: 'DELETE' }), 'It could not be cancelled.');
      // Read the folder again first, so "Cancelled" never shows beside a
      // waiting import that is already gone.
      await load();
      say({ tone: 'ok', text: 'Cancelled. The network here stays as it is.' });
    } catch (e) {
      say({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function restartNow() {
    setBusy('restart');
    setImportNote(null);
    try {
      await answer(await fetch('/api/data/restart', { method: 'POST' }), 'Sixgree could not restart.');
      setRestarting(true);
      // The Mac app brings this window back by itself once its server is up.
      // In case it doesn't, keep asking, and reload once the server answers.
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const until = Date.now() + 90000;
      await wait(2500);
      while (Date.now() < until) {
        try {
          if ((await fetch('/api/data', { cache: 'no-store' })).ok) {
            window.location.reload();
            return;
          }
        } catch { /* not back yet */ }
        await wait(1000);
      }
      setRestarting(false);
      setImportNote({ tone: 'bad', text: 'Sixgree didn’t come back. Quit it and open it again: it finishes as it starts.' });
    } catch (e) {
      setImportNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  if (!info) {
    return (
      <Section id="data" title="Your data">
        {loadError ? <Status tone="bad">{loadError}</Status> : <Body>Loading…</Body>}
      </Section>
    );
  }

  const pending = info.pending;
  // The photos a copy would carry: only those of people still in the network.
  const inCopy = info.photosInCopy || info.photos;
  const backups = info.backups || [];
  const backupBytes = backups.reduce((n, b) => n + (b.bytes || 0), 0);
  const status = info.backupStatus || {};
  const keep = status.keep || {};
  const tooBig = Boolean(file && file.size > info.maxImportBytes);
  const replaces = info.people > 0;
  const last = info.lastImport;
  const finder = info.platform === 'darwin' ? 'Show in Finder' : 'Show in folder';
  const pendingBox = pending && (
    <Pending pending={pending} info={info} busy={busy} restarting={restarting} onRestart={restartNow} onCancel={cancelImport} />
  );

  return (
    <Section
      id="data"
      title="Your data"
      intro="Everything Sixgree knows about your network is in one folder on this computer."
    >
      <Body><Mono>{info.dataDir}</Mono></Body>
      <div style={row}>
        <Btn onClick={copyPath}>Copy the path</Btn>
        <Btn onClick={reveal} disabled={busy === 'reveal'}>
          {busy === 'reveal' ? 'Opening…' : info.platform === 'darwin' ? 'Show in Finder' : 'Open the folder'}
        </Btn>
      </div>
      {folderNote && <Status tone={folderNote.tone}>{folderNote.text}</Status>}

      <div style={{ marginTop: 16, borderBottom: LINE }}>
        <Fact label="Your network">{people(info.people)} · {size(info.databaseBytes)}</Fact>
        <Fact label="Profile photos">{info.photos.count ? `${count(info.photos.count)} · ${size(info.photos.bytes)}` : 'none saved yet'}</Fact>
        <Fact label="Backups">{backups.length ? `${plural(backups.length, 'copy', 'copies')} · ${size(backupBytes)}` : 'none yet'}</Fact>
        <Fact label="LinkedIn sign-in for scanning">
          {info.linkedinSignIn ? 'kept here, never put in a copy' : 'not signed in on this computer'}
        </Fact>
      </div>

      <h3 style={subhead}>Backups</h3>
      <LastBackup status={status} />
      <div style={row}>
        <Btn onClick={backUpNow} disabled={!!busy || restarting || info.people === 0}>
          {busy === 'backup' ? 'Backing up…' : 'Back up now'}
        </Btn>
        {info.people === 0 && <span style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>There’s no network here to back up yet.</span>}
      </div>
      {backupNote && <Status tone={backupNote.tone}>{backupNote.text}</Status>}
      {pending?.restoredFrom && pendingBox}
      <Body style={small}>
        Each backup is your whole network with its photos, your settings and the scanner’s notes, checked as it’s
        made. Sixgree makes one each day it’s open and before a new version first opens your data. It keeps the
        last {keep.daily ?? 7} daily backups, {keep['before-update'] ?? 3} from before new versions, and
        {' '}{keep['before-import'] ?? 3} from before an import or a restore (those for at least {status.floorDays ?? 30} days).
        Backups you make with Back up now stay until you delete them. The Social tab’s messages and notes are never
        in them, so deleting those there deletes them everywhere. Backups are on this computer only, so to keep one safe
        if the computer is lost, copy it somewhere else.
      </Body>

      {backups.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>
          <summary style={{ cursor: 'pointer' }}>The backups ({count(backups.length)})</summary>
          <div style={{ marginTop: 6 }}>
            {backups.map((b) => {
              const asking = confirming === b.name;
              const note = rowNote?.name === b.name ? rowNote : null;
              return (
                <div key={b.name} style={{ padding: '10px 0', borderTop: LINE }}>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--sd-fg-1, #e8e8ee)', fontWeight: 600 }}>
                      {backupLabel(b)} <span style={{ fontWeight: 400, color: 'var(--sd-fg-3, #8b9a9a)' }}>· {when(b.at)}</span>
                    </span>
                    <span>{size(b.bytes)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sd-fg-4, #667)', marginTop: 2 }}>
                    {/* Only the file name may break anywhere: it has no spaces, and a phone is narrower than it. */}
                    <span style={{ wordBreak: 'break-all' }}>{b.name}{b.folder ? '/' : ''}</span> · {backupHolds(b)}
                  </div>
                  {asking ? (
                    <Status>
                      {replaces
                        ? `Replace the ${people(info.people)} here with the network in this backup?`
                        : 'Restore the network in this backup?'}
                      {' '}It’s checked first, and finishes when Sixgree restarts. What’s here now is kept in backups
                      first, so this can be undone. Your daily search limit, the record of searches and any pause on scanning are kept.
                      {b.format === 'database' && !b.withFiles && ' This backup holds the network only, so the photos and the scanner’s notes here now stay with it.'}
                      <div style={row}>
                        <Btn primary onClick={() => restoreBackup(b.name)} disabled={!!busy}>
                          {busy === `restore:${b.name}` ? 'Checking the backup…' : 'Restore it'}
                        </Btn>
                        <Btn onClick={() => { setConfirming(null); setRowNote(null); }} disabled={busy === `restore:${b.name}`}>Cancel</Btn>
                      </div>
                    </Status>
                  ) : (
                    <div style={{ ...row, marginTop: 8 }}>
                      {b.restorable && (
                        <Btn onClick={() => { setConfirming(b.name); setRowNote(null); }} disabled={!!busy || restarting || Boolean(pending)}>
                          Restore
                        </Btn>
                      )}
                      <Btn onClick={() => revealBackup(b.name)} disabled={busy === `reveal:${b.name}`}>
                        {busy === `reveal:${b.name}` ? 'Opening…' : finder}
                      </Btn>
                    </div>
                  )}
                  {note && <Status tone={note.tone}>{note.text}</Status>}
                </div>
              );
            })}
          </div>
        </details>
      )}
      <Body style={small}>
        The folder can’t be moved from here. A database that a sync service (iCloud Drive, Dropbox) copies while
        it’s open can be damaged, and this folder also holds your LinkedIn sign-in, which should never be synced.
        To use your network on another computer, export a backup file below and restore it there.
      </Body>

      <h3 style={subhead}>Move your network to another computer</h3>
      <Body>
        Export a backup file here, then on the new computer install Sixgree, open Settings → Your data and
        restore from it. Sign in to LinkedIn again there before you scan: your sign-in never goes into a backup.
      </Body>
      <label style={check}>
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          Include profile photos
          {inCopy.count ? ` (${count(inCopy.count)}, ${size(inCopy.bytes)})` : ''}.
          They can’t be downloaded again without a new scan.
        </span>
      </label>
      <label style={check}>
        <input type="checkbox" checked={social} onChange={(e) => setSocial(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          Include the Social tab: its findings, your CRM notes, stages and follow-ups, and any messages you keep
          there.
        </span>
      </label>
      <div style={row}>
        <Btn primary onClick={exportNow} disabled={!!busy || restarting || info.people === 0}>
          {busy === 'export' ? 'Saving…' : 'Export backup file…'}
        </Btn>
        {info.people === 0 && <span style={{ fontSize: 13, color: 'var(--sd-fg-3, #8b9a9a)' }}>There’s no network here to save yet.</span>}
      </div>
      {exportNote && <Status tone={exportNote.tone}>{exportNote.text}</Status>}
      <Body style={small}>
        The file holds the names, headlines and photos of the people in your network. Keep it private: don’t
        post it or share it, and delete it once it has been restored. A connections CSV import kept on this computer
        goes into the file too, and opens on the new one. With the
        Social tab included, the file also holds your CRM notes and any messages you keep, so it&rsquo;s as private
        as your inbox.
      </Body>

      <h3 style={subhead}>Bring in a network from another computer</h3>
      {pending && !pending.restoredFrom ? pendingBox : pending ? (
        <Body>A restore is waiting to finish (under Backups, above). Restart, or cancel it, before restoring anything else.</Body>
      ) : (
        <>
          <Body>
            Pick the backup file you exported on the other computer (a .sixdegrees file). It replaces the network
            here; the two networks are never merged. Your daily search limit, the record of searches and any pause on scanning are kept,
            with the other computer’s searches added.
          </Body>
          <input ref={picker} type="file" accept=".sixdegrees" onChange={choose} style={{ display: 'none' }} />
          <div style={row}>
            <Btn onClick={() => picker.current?.click()} disabled={!!busy}>Restore from a file…</Btn>
            {file && <span style={{ fontSize: 13, color: 'var(--sd-fg-2, #c8d0d0)', wordBreak: 'break-all' }}>{file.name} · {size(file.size)}</span>}
          </div>
          {tooBig && (
            <Status tone="bad">
              That file is {size(file.size)}. This copy can restore files up to {size(info.maxImportBytes)}.
            </Status>
          )}
          {file && replaces && !tooBig && (
            <label style={check}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Replace the {people(info.people)} in this copy’s network with the network in this file. A copy of
                what’s here is kept in backups first. Your daily search limit and any pause on scanning are kept too.
              </span>
            </label>
          )}
          {file && (
            <div style={row}>
              <Btn primary onClick={importNow} disabled={tooBig || (replaces && !confirmed) || !!busy}>
                {busy === 'import' ? 'Checking the file…' : 'Restore'}
              </Btn>
            </div>
          )}
        </>
      )}
      {importNote && <Status tone={importNote.tone}>{importNote.text}</Status>}

      {last && !pending && (
        info.importIsRecent ? (
          <Status tone="ok">
            {last.restoredFrom ? 'Restored' : 'Imported'} {when(last.appliedAt)}: {people(last.people)}
            {last.restoredFrom
              ? <> from the backup <Mono>{last.restoredFrom}</Mono></>
              : last.exportedAt ? ` from the copy saved ${when(last.exportedAt, false)}` : ''}.
            {last.keptDatabase && (
              <>
                {' '}What was here before is kept in <Mono>{last.keptDatabase}</Mono>
                {last.keptFiles ? ', with its photos and files beside it' : ''}.
                {last.keptAsIs && ' It couldn’t be read, so it was kept exactly as it was.'}
                {' '}To go back to it, restore it from the backups above.
              </>
            )}
          </Status>
        ) : (
          <Body style={small}>
            Last {last.restoredFrom ? 'restore' : 'import'}: {when(last.appliedAt)} ({people(last.people)}).
            {last.keptDatabase && <> What was here before is kept in <Mono>{last.keptDatabase}</Mono>, under Backups above.</>}
          </Body>
        )
      )}
    </Section>
  );
}
