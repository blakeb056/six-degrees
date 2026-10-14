'use client';

// Browse and one-click Install, shared by Settings → Plugins and the guided
// setup's Allow plugins box (Blake, 2026-10-14: "will the plugins be displayed
// in the app for the viewer i dont want them have to drag and drop"). The
// plugin list's cards, each with what it does, its risk, its version and size,
// and Install, Installed or Update; the yes before anything installs; and the
// same yes for a package from a file or a link.
//
// Nothing here goes online by itself. The list is asked for by the caller,
// on someone opening the section, pressing Try again or ticking Allow
// plugins (load); a package is downloaded only when Install is pressed (get).
// The server does both (app/api/plugins/catalog and download). Every install
// shows the package's own name, version, what it does and its risk, with the
// line that a plugin runs its own code here and where it came from, and
// installs only the package that was shown (its checksum, CONFIRM_HEADER).

import { useCallback, useRef, useState } from 'react';
import { Body, Status, Btn, LINE } from '../ui';
import {
  fetchCatalog, downloadPlugin, installDownloaded, checkPackage, installPackage, catalogAction,
  PLUGIN_TRUST_LINE, LINK_CHECK_LINE, LIST_CHECK_LINE, CATALOG_UNLOADED,
} from '../../../lib/plugins-client';

const row = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' };
const FG1 = 'var(--sd-fg-1, #e8e8ee)';
const FG3 = 'var(--sd-fg-3, #8b9a9a)';
const GOLD = 'var(--sd-gold, #FFD700)';
const ACTION_LABEL = { install: 'Install', update: 'Update', reinstall: 'Reinstall' };

export function size(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * The plugin list and the installs from it, from a link and from a file.
 * `onInstalled(view)` gets GET /api/plugins's answer after each install.
 * One offer (a checked package waiting for its yes) at a time; `offer.at` and
 * `note.at` say which place shows it: 'browse', 'link' or 'file'.
 */
export function usePluginInstall({ onInstalled } = {}) {
  // idle (never asked) | loading | ready | failed
  const [catalog, setCatalog] = useState({ status: 'idle' });
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const loading = useRef(false);

  // Only ever on a person's open, press or tick: see the callers.
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setCatalog((c) => ({ ...c, status: 'loading' }));
    try {
      const got = await fetchCatalog();
      setCatalog({ status: 'ready', source: got.source, plugins: got.plugins, dropped: got.dropped });
    } catch (e) {
      setCatalog({
        status: 'failed',
        detail: e.data?.detail || (e.message !== CATALOG_UNLOADED ? e.message : null),
        source: e.data?.source || null,
      });
    } finally {
      loading.current = false;
    }
  }, []);

  async function check(at, key, work, failed = '') {
    setBusy(key);
    setOffer(null);
    setNote(null);
    try {
      setOffer({ at, ...(await work()) });
    } catch (e) {
      setNote({ at, tone: 'bad', text: `${failed}${e.message}` });
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    if (!offer) return;
    const { at } = offer;
    setBusy('install');
    setNote(null);
    try {
      const done = offer.file ? await installPackage(offer.file, offer.sha256) : await installDownloaded(offer.sha256);
      onInstalled?.({ enabled: done.enabled, plugins: done.plugins, scanner: done.scanner });
      setNote({
        at,
        tone: 'ok',
        text: `Installed ${done.installed.name} ${done.installed.version}${done.replaced?.version ? `, in place of ${done.replaced.version}` : ''}.`,
      });
      setOffer(null);
    } catch (e) {
      setNote({ at, tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return {
    catalog, offer, busy, note, setNote, load, install,
    /** A card's Install, Update or Reinstall: downloaded and checked, then the yes. */
    get: (entry) => check('browse', `get:${entry.id}`, () => downloadPlugin({ id: entry.id })),
    /** Install from a link: the same, from a pasted https link. */
    getLink: (url) => check('link', 'link', () => downloadPlugin({ url })),
    /** Install from a file: the package checked through, then the yes. */
    checkFile: (file) => check('file', 'check', async () => ({ file, ...(await checkPackage(file)) }), `${file.name} can’t be installed. `),
    cancel: () => setOffer(null),
    /** Plugins turned off: nothing waits for a yes. */
    reset: () => { setOffer(null); setNote(null); },
  };
}

/** Which list this is, when it isn't the official one, and what was left out of it. */
function SourceLines({ source, dropped }) {
  return (
    <>
      {source?.test && (
        <Body style={{ fontSize: 12.5, color: GOLD }}>
          A test’s plugin list, not the official one: {source.url} (SIX_DEGREES_PLUGIN_CATALOG).
        </Body>
      )}
      {source?.ignored && <Body style={{ fontSize: 12.5, color: GOLD }}>{source.ignored}</Body>}
      {dropped?.length > 0 && (
        <Body style={{ fontSize: 12.5 }}>
          <span data-catalog-dropped="">
            Left out of the list, since Sixgree can’t trust {dropped.length === 1 ? 'it' : 'them'}:{' '}
            {dropped.map((d) => `${d.id || 'an entry'} (${d.reason.replace(/\.$/, '')})`).join('; ')}.
          </span>
        </Body>
      )}
    </>
  );
}

/**
 * The plugin list as cards. `installed` is GET /api/plugins's `plugins`, for
 * Install, Installed or Update. `quiet` keeps the buttons plain, where
 * something else on the screen is the main way in (the guided setup's CSV).
 */
export function PluginCards({ catalog, installed, busy, onGet, onRetry, quiet = false, columns = 'repeat(auto-fill, minmax(250px, 1fr))' }) {
  if (catalog.status === 'idle') return null;
  if (catalog.status === 'loading' && !catalog.plugins) {
    return <Body style={{ fontSize: 13 }}><span data-catalog-loading="">Loading the plugin list…</span></Body>;
  }
  if (catalog.status === 'failed') {
    return (
      <Status tone="bad">
        <div data-catalog-failed="" style={{ fontWeight: 650 }}>{CATALOG_UNLOADED}</div>
        {catalog.detail && <div style={{ fontSize: 12.5, marginTop: 2 }}>{catalog.detail}</div>}
        <SourceLines source={catalog.source} />
        <div style={row}>
          <Btn onClick={onRetry} disabled={!!busy}>Try again</Btn>
        </div>
      </Status>
    );
  }
  const plugins = catalog.plugins || [];
  return (
    <div data-catalog="">
      {plugins.length === 0 && <Body>The plugin list has no plugins in it yet.</Body>}
      <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 10, marginTop: 8 }}>
        {plugins.map((p) => {
          const action = catalogAction(p, installed);
          const have = (installed || []).find((i) => i.id === p.id);
          return (
            <div key={p.id} data-plugin-card={p.id} data-action={action || 'none'} style={{
              border: LINE, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4,
              background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', minWidth: 0,
            }}>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: FG1, fontWeight: 650, fontSize: 14 }}>{p.name}</span>
                <span style={{ color: FG3, fontSize: 12 }}>{p.version} · {size(p.size)}</span>
              </div>
              <div style={{ fontSize: 13, color: FG3, lineHeight: 1.5 }}>{p.about}</div>
              {p.risk && (
                <div style={{ fontSize: 12.5, color: GOLD, lineHeight: 1.5 }}><strong>Risk:</strong> {p.risk}</div>
              )}
              {p.problem && (
                <div style={{ fontSize: 12.5, color: GOLD, lineHeight: 1.5 }}><strong>Not for this version.</strong> {p.problem}</div>
              )}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
                {action === 'installed' && (
                  <span style={{ color: 'var(--sd-green, #00ff88)', fontSize: 13, fontWeight: 650 }}>✓ Installed</span>
                )}
                {ACTION_LABEL[action] && (
                  <Btn primary={!quiet && action !== 'reinstall'} onClick={() => onGet(p)} disabled={!!busy}>
                    {busy === `get:${p.id}` ? 'Downloading…' : ACTION_LABEL[action]}
                  </Btn>
                )}
                <span style={{ color: 'var(--sd-fg-4, #667)', fontSize: 12 }}>
                  {action === 'update' && have?.version ? `${have.version} installed · ` : ''}from {p.host}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <SourceLines source={catalog.source} dropped={catalog.dropped} />
    </div>
  );
}

/**
 * The yes: the checked package's own name, version, what it does and its
 * risk, that a plugin runs its own code here, where it came from and what
 * vouches for it, and what it replaces. Nothing installs without Install here.
 */
export function PluginOffer({ offer, busy, onInstall, onCancel }) {
  const { plugin, from, replaces } = offer;
  return (
    <Status>
      <div data-plugin-offer="" style={{ color: FG1, fontWeight: 650 }}>{plugin.name} {plugin.version}</div>
      <div style={{ marginTop: 4 }}>{plugin.about}</div>
      {plugin.risk && (
        <div style={{ marginTop: 8, color: GOLD }}><strong>Risk:</strong> {plugin.risk}</div>
      )}
      <div style={{ marginTop: 8 }}>{PLUGIN_TRUST_LINE}</div>
      {from && (
        <div data-plugin-from={from.kind} style={{ marginTop: 8 }}>
          Downloaded from <strong>{from.host}</strong>. {from.kind === 'link' ? LINK_CHECK_LINE : LIST_CHECK_LINE}
        </div>
      )}
      {replaces && (
        <div style={{ marginTop: 8 }}>
          It replaces {replaces.version ? `version ${replaces.version}` : 'the copy'}, which is installed now.
        </div>
      )}
      <div style={row}>
        <Btn primary onClick={onInstall} disabled={!!busy}>{busy === 'install' ? 'Installing…' : 'Install'}</Btn>
        <Btn onClick={onCancel} disabled={busy === 'install'}>Cancel</Btn>
      </div>
    </Status>
  );
}

/** A note (an install done, or why not) or a waiting yes, where `at` is. */
export function PluginOfferAt({ at, install }) {
  const { offer, note, busy } = install;
  return (
    <>
      {offer?.at === at && <PluginOffer offer={offer} busy={busy} onInstall={install.install} onCancel={install.cancel} />}
      {note?.at === at && <Status tone={note.tone}>{note.text}</Status>}
    </>
  );
}
