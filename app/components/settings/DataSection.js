'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Section, Body, Mono, Status, Btn, LINE } from '../ui';

// Settings → Your data: where the network is kept, what it takes up, and how to
// carry it to another computer. The server does the work (app/api/data/…,
// lib/data-export.js, lib/data-import.js); this section only asks, on a click.
//
// An import is checked and staged by its click, then replaces the network the
// next time Six Degrees starts, after a copy of what was here is kept. So the
// last word this section says about an import is always how to restart.

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

const BACKUP_KIND = {
  auto: 'before a new version',
  import: 'before an import',
  manual: 'made by hand',
};

/** The server's answer, or an Error carrying its message (and its data, for the caller). */
async function answer(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || fallback), { data });
  return data;
}

const row = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' };
const small = { fontSize: 12, color: '#667', marginTop: 10 };
const subhead = { fontSize: 14, fontWeight: 650, margin: '26px 0 4px', color: '#e8e8ee' };
const check = { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13, color: '#c8d0d0', lineHeight: 1.5, cursor: 'pointer' };

function Fact({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', padding: '7px 0', borderTop: LINE, fontSize: 13.5 }}>
      <span style={{ color: '#8b9a9a' }}>{label}</span>
      <span style={{ color: '#e8e8ee', textAlign: 'right' }}>{children}</span>
    </div>
  );
}

export default function DataSection() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [folderNote, setFolderNote] = useState(null);
  const [exportNote, setExportNote] = useState(null);
  const [importNote, setImportNote] = useState(null);
  const [photos, setPhotos] = useState(true);
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

  async function exportNow() {
    setBusy('export');
    setExportNote(null);
    try {
      const res = await fetch('/api/data/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos }),
      });
      if (!res.ok) await answer(res, 'The copy could not be made.');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'Six Degrees backup.sixdegrees';
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
      await answer(await fetch('/api/data/import', { method: 'POST', headers, body: file }), 'The file could not be imported.');
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
    try {
      await answer(await fetch('/api/data/import', { method: 'DELETE' }), 'The import could not be cancelled.');
      // Read the folder again first, so "Cancelled" never shows beside a
      // waiting import that is already gone.
      await load();
      setImportNote({ tone: 'ok', text: 'Cancelled. The network here stays as it is.' });
    } catch (e) {
      setImportNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function restartNow() {
    setBusy('restart');
    setImportNote(null);
    try {
      await answer(await fetch('/api/data/restart', { method: 'POST' }), 'Six Degrees could not restart.');
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
      setImportNote({ tone: 'bad', text: 'Six Degrees didn’t come back. Quit it and open it again: the import finishes as it starts.' });
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
  const backups = info.backups || [];
  const backupBytes = backups.reduce((n, b) => n + (b.bytes || 0), 0);
  const tooBig = Boolean(file && file.size > info.maxImportBytes);
  const replaces = info.people > 0;
  const last = info.lastImport;

  return (
    <Section
      id="data"
      title="Your data"
      intro="Everything Six Degrees knows about your network is in one folder on this computer."
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

      {backups.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 13, color: '#8b9a9a' }}>
          <summary style={{ cursor: 'pointer' }}>The backups</summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: '6px 14px', marginTop: 8 }}>
            {backups.map((b) => (
              <div key={b.name} style={{ display: 'contents' }}>
                <span style={{ wordBreak: 'break-all', color: '#c8d0d0' }}>
                  {b.name}{b.folder ? '/' : ''}
                  <span style={{ color: '#667' }}> · {b.folder ? 'its photos and files' : BACKUP_KIND[b.kind] || b.kind}</span>
                </span>
                <span>{when(b.modifiedAt)}</span>
                <span style={{ textAlign: 'right' }}>{size(b.bytes)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <Body style={small}>
        Backups are copies of your network from before a new version or an import. The newest five from new
        versions are kept; copies from before an import stay until you delete them.
      </Body>
      <Body style={small}>
        The folder can’t be moved from here. A database that a sync service (iCloud Drive, Dropbox) copies while
        it’s open can be damaged, and this folder also holds your LinkedIn sign-in, which should never be synced.
        To use your network on another computer, save a copy below and import it there.
      </Body>

      <h3 style={subhead}>Move your network to another computer</h3>
      <Body>
        Save a copy here, then on the new computer install Six Degrees, open Settings → Your data and import the
        copy. Sign in to LinkedIn again there before you scan: your sign-in never goes into a copy.
      </Body>
      <label style={check}>
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          Include profile photos
          {info.photos.count ? ` (${count(info.photos.count)}, ${size(info.photos.bytes)})` : ''}.
          They can’t be downloaded again without a new scan.
        </span>
      </label>
      <div style={row}>
        <Btn primary onClick={exportNow} disabled={!!busy || restarting || info.people === 0}>
          {busy === 'export' ? 'Saving…' : 'Save a copy of my network'}
        </Btn>
        {info.people === 0 && <span style={{ fontSize: 13, color: '#8b9a9a' }}>There’s no network here to save yet.</span>}
      </div>
      {exportNote && <Status tone={exportNote.tone}>{exportNote.text}</Status>}
      <Body style={small}>
        The copy holds the names, headlines and photos of the people in your network. Keep it private: don’t
        post it or share it, and delete it once it has been imported. A network opened from a LinkedIn CSV lives
        only in its browser tab, so it isn’t in the copy; import the CSV again on the new computer.
      </Body>

      <h3 style={subhead}>Bring in a network from another computer</h3>
      {pending ? (
        <Status>
          <div style={{ fontWeight: 650 }}>An import is waiting to finish.</div>
          <div>
            The network in the copy{pending.exportedAt ? ` saved ${when(pending.exportedAt, false)}` : ''}
            {' '}({people(pending.people)}{pending.photos ? `, ${plural(pending.photos, 'photo')}` : ''}
            {pending.fromVersion ? `, from Six Degrees ${pending.fromVersion}` : ''})
            {pending.replacedPeople > 0
              ? ` replaces the ${people(pending.replacedPeople)} here the next time Six Degrees starts. A copy of what’s here now is kept in backups first.`
              : ' becomes the network here the next time Six Degrees starts.'}
          </div>
          {pending.error && (
            <div style={{ color: '#ff7676', marginTop: 6 }}>
              The last try stopped: {pending.error}. It tries again the next time Six Degrees starts.
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
                  <Btn primary onClick={restartNow} disabled={!!busy}>
                    {busy === 'restart' ? 'Restarting…' : 'Restart now'}
                  </Btn>
                )}
                {!pending.started && (
                  <Btn onClick={cancelImport} disabled={!!busy}>
                    {busy === 'cancel' ? 'Cancelling…' : 'Cancel the import'}
                  </Btn>
                )}
              </div>
            </>
          )}
        </Status>
      ) : (
        <>
          <Body>
            Pick the copy you saved on the other computer (a .sixdegrees file). It replaces the network here;
            nothing is merged.
          </Body>
          <input ref={picker} type="file" accept=".sixdegrees" onChange={choose} style={{ display: 'none' }} />
          <div style={row}>
            <Btn onClick={() => picker.current?.click()} disabled={!!busy}>Choose a file…</Btn>
            {file && <span style={{ fontSize: 13, color: '#c8d0d0', wordBreak: 'break-all' }}>{file.name} · {size(file.size)}</span>}
          </div>
          {tooBig && (
            <Status tone="bad">
              That file is {size(file.size)}. This copy can import files up to {size(info.maxImportBytes)}.
            </Status>
          )}
          {file && replaces && !tooBig && (
            <label style={check}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Replace the {people(info.people)} in this copy’s network with the network in this file. A copy of
                what’s here is kept in backups first.
              </span>
            </label>
          )}
          <div style={row}>
            <Btn primary onClick={importNow} disabled={!file || tooBig || (replaces && !confirmed) || !!busy}>
              {busy === 'import' ? 'Checking the file…' : 'Import'}
            </Btn>
          </div>
        </>
      )}
      {importNote && <Status tone={importNote.tone}>{importNote.text}</Status>}

      {last && !pending && (
        info.importIsRecent ? (
          <Status tone="ok">
            Imported {when(last.appliedAt)}: {people(last.people)}
            {last.exportedAt ? ` from the copy saved ${when(last.exportedAt, false)}` : ''}.
            {last.keptDatabase && (
              <>
                {' '}What was here before is kept in <Mono>{last.keptDatabase}</Mono>
                {last.keptFiles ? ', with its photos and files beside it' : ''}.
                {last.keptAsIs && ' It couldn’t be read, so it was kept exactly as it was.'}
              </>
            )}
          </Status>
        ) : (
          <Body style={small}>
            Last import: {when(last.appliedAt)} ({people(last.people)}).
            {last.keptDatabase && <> What was here before is kept in <Mono>{last.keptDatabase}</Mono>.</>}
          </Body>
        )
      )}
    </Section>
  );
}
