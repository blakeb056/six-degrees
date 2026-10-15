'use client';

// Browse and one-click Install, shared by Settings → Plugins and the guided
// setup's "Other ways to bring in your network" (Blake, 2026-10-14: "will the
// plugins be displayed in the app for the viewer i dont want them have to drag
// and drop"). The plugin list's cards, each with what it does, its risk, its
// version, and Install, Installed or Update.
//
// The cards are there at once, plugins on or off, from the copy of the
// official list that ships with the app (lib/plugins-shipped.js); nothing goes
// online for them, until Settings → Plugins, with plugins on, reads the live
// list when Browse comes into view, or on Check for plugin updates
// (PluginsSection.js); then the live list is merged over the shipped copy and
// wins, so a newer version shows as Update. Pressing a card's Install is the
// click that always goes online: with
// plugins off it turns them on first (Install is the yes, and the card says
// so), fetches the real list, which wins over the shipped copy, checks the
// entry, then downloads and checks the package (app/api/plugins/catalog and
// download). Cancel, or a failure, puts plugins back as they were.
//
// Everything happens inside the card that was pressed (Blake, 2026-10-14:
// "when they install it i want the actual box they click on to show the bar
// and etc not pop a box at the bottom"): Install, a bar while it downloads,
// the yes (the package's own name, version, what it does and its risk, the
// line that a plugin runs its own code here, where it came from), a bar while
// it installs, then Installed, or what went wrong. Only the package that was
// shown installs (its checksum, CONFIRM_HEADER). A package from a file or a
// link (Settings → Plugins → Advanced) keeps its own small yes (PluginOffer).

import { useCallback, useRef, useState } from 'react';
import { Body, Status, Btn, LINE } from '../ui';
import {
  fetchCatalog, downloadPlugin, installDownloaded, checkPackage, installPackage, catalogAction, savePluginsEnabled, cardInstall, cardState,
  updatedTo, PLUGIN_TRUST_LINE, LINK_CHECK_LINE, LIST_CHECK_LINE, CATALOG_UNLOADED,
} from '../../../lib/plugins-client';
import { compareVersions } from '../../../lib/release';
import { cardsFrom } from '../../../lib/plugins-shipped';

const row = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' };
const FG1 = 'var(--sd-fg-1, #e8e8ee)';
const FG3 = 'var(--sd-fg-3, #8b9a9a)';
const GOLD = 'var(--sd-gold, #FFD700)';
const GREEN = 'var(--sd-green, #00ff88)';
const RED = 'var(--sd-red, #ff7676)';
const ACTION_LABEL = { install: 'Install', update: 'Update', reinstall: 'Reinstall' };

/** Said in the card's yes when plugins were off: Install is what turns them on. */
export const TURNS_ON_LINE = 'Installing it turns plugins on (Settings → Plugins → Enable plugins). Cancel leaves them off.';

export function size(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * The plugin list and the installs from it, from a link and from a file.
 * `onView(view)` gets GET /api/plugins's answer after each change made here:
 * an install, or plugins turned on for one (or back off). `enabled` is whether
 * plugins are on now: a card's Install turns them on first when they're off.
 * One offer (a checked package waiting for its yes) at a time; `offer.at` and
 * `note.at` say which place shows it: 'browse' (with the card's `id`), 'link'
 * or 'file'.
 */
export function usePluginInstall({ onView, enabled = true } = {}) {
  // idle (never asked) | loading | ready | failed. `plugins` is the last live
  // list had, kept while it is asked again and if that fails; `at` is when it came.
  const [catalog, setCatalog] = useState({ status: 'idle' });
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const loading = useRef(false);
  // Plugins were off when a card's Install was pressed, and were turned on for
  // it: turned off again if it's cancelled or fails, left on once it installs.
  const turnedOn = useRef(false);

  // Only ever on a person's open, press or Install: see the callers.
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setCatalog((c) => ({ ...c, status: 'loading' }));
    try {
      const got = await fetchCatalog();
      setCatalog({ status: 'ready', source: got.source, plugins: got.plugins, dropped: got.dropped, at: Date.now() });
    } catch (e) {
      setCatalog((c) => ({
        status: 'failed',
        detail: e.data?.detail || (e.message !== CATALOG_UNLOADED ? e.message : null),
        source: e.data?.source || null,
        plugins: c.plugins,
        dropped: c.dropped,
      }));
    } finally {
      loading.current = false;
    }
  }, []);

  async function putBack() {
    if (!turnedOn.current) return;
    turnedOn.current = false;
    try { onView?.(await savePluginsEnabled(false)); } catch { /* left on: Settings → Plugins turns it off */ }
  }

  /**
   * A card's Install, Update or Reinstall (lib/plugins-client.js cardInstall):
   * plugins on if they're off, the real list fetched now (it wins over the
   * shipped copy), this entry checked in it, then the package downloaded and
   * checked. The yes comes next, in the card.
   */
  async function get(entry) {
    const { id } = entry;
    setBusy(`get:${id}`);
    setOffer(null);
    setNote(null);
    try {
      const got = await cardInstall(entry, { enabled });
      if (got.view) onView?.(got.view);
      turnedOn.current = got.turnedOn;
      setCatalog({ status: 'ready', source: got.list.source, plugins: got.list.plugins, dropped: got.list.dropped, at: Date.now() });
      setOffer({ at: 'browse', id, turnsOn: got.turnedOn, ...got.offer });
    } catch (e) {
      if (e.view) onView?.(e.view);
      turnedOn.current = Boolean(e.turnedOn);
      setNote({ at: 'browse', id, tone: 'bad', text: e.message });
      await putBack();
    } finally {
      setBusy(null);
    }
  }

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
    const { at, id } = offer;
    setBusy('install');
    setNote(null);
    try {
      const done = offer.file ? await installPackage(offer.file, offer.sha256) : await installDownloaded(offer.sha256);
      turnedOn.current = false;
      onView?.({ enabled: done.enabled, plugins: done.plugins, scanner: done.scanner });
      setNote({
        at, id,
        tone: 'ok',
        text: `Installed ${done.installed.name} ${done.installed.version}${done.replaced?.version ? `, in place of ${done.replaced.version}` : ''}.`,
        // An Update: its card says "Updated to 1.0.1 ✓" (cardState).
        updated: updatedTo(done),
      });
      setOffer(null);
    } catch (e) {
      setNote({ at, id, tone: 'bad', text: e.message });
      setOffer(null);
      await putBack();
    } finally {
      setBusy(null);
    }
  }

  return {
    catalog, offer, busy, note, setNote, load, install, get,
    /** Install from a link: the package downloaded from a pasted https link and checked, then its yes. */
    getLink: (url) => check('link', 'link', () => downloadPlugin({ url })),
    /** Install from a file: the package checked through, then the yes. */
    checkFile: (file) => check('file', 'check', async () => ({ file, ...(await checkPackage(file)) }), `${file.name} can’t be installed. `),
    /** No to the yes: nothing installs, and plugins turned on for it go back off. */
    cancel: () => { setOffer(null); putBack(); },
    /** Plugins turned off: nothing waits for a yes. */
    reset: () => { turnedOn.current = false; setOffer(null); setNote(null); },
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

// A bar that fills most of the way while the server works (it says no more
// than started or done), and is gone the moment it's done.
const BAR_CSS = '@keyframes sdPluginFill { from { width: 6%; } to { width: 88%; } }';

function WorkBar({ label, kind }) {
  return (
    <div data-card-bar={kind} role="status" style={{ width: '100%' }}>
      <div style={{ height: 6, borderRadius: 3, overflow: 'hidden', background: 'rgba(var(--sd-ink, 255, 255, 255), 0.1)' }}>
        <i style={{ display: 'block', height: '100%', borderRadius: 3, background: GREEN, animation: 'sdPluginFill 2.4s cubic-bezier(.2,.8,.3,1) forwards' }} />
      </div>
      <div style={{ fontSize: 12.5, color: FG3, marginTop: 6 }}>{label}</div>
    </div>
  );
}

/**
 * The plugin list as cards: the shipped copy until the live list has been
 * fetched, then the live list merged over it (lib/plugins-shipped.js cardsFrom). `installed` is
 * GET /api/plugins's `plugins`, for Install, Installed or Update. `install`
 * is usePluginInstall's, whose state each card shows inside itself
 * (cardState). `quiet` keeps the buttons plain, where something else on the
 * screen is the main way in (the guided setup's CSV).
 */
export function PluginCards({ install, installed, quiet = false, columns = 'repeat(auto-fill, minmax(250px, 1fr))' }) {
  const { catalog } = install;
  const plugins = cardsFrom(catalog);
  const anyBusy = Boolean(install.busy);
  return (
    <div data-catalog={Array.isArray(catalog.plugins) ? 'live' : 'shipped'}>
      <style>{BAR_CSS}</style>
      {catalog.status === 'failed' && (
        <Status tone="bad">
          <div data-catalog-failed="" style={{ fontWeight: 650 }}>{CATALOG_UNLOADED}</div>
          {catalog.detail && <div style={{ fontSize: 12.5, marginTop: 2 }}>{catalog.detail}</div>}
          <SourceLines source={catalog.source} />
          <div style={row}>
            <Btn onClick={install.load} disabled={anyBusy}>Try again</Btn>
          </div>
        </Status>
      )}
      {plugins.length === 0 && <Body>The plugin list has no plugins in it yet.</Body>}
      <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 10, marginTop: 8 }}>
        {plugins.map((p) => {
          const { state, error, done } = cardState(install, p.id);
          const offer = state === 'confirm' || state === 'installing' ? install.offer : null;
          // The yes shows the package's own words, which the live list and the package settle.
          const shown = offer ? { ...p, ...offer.plugin } : p;
          const action = catalogAction(p, installed);
          const have = (installed || []).find((i) => i.id === p.id);
          return (
            <div key={p.id} data-plugin-card={p.id} data-action={action || 'none'} data-card-state={state} style={{
              border: offer ? '1px solid var(--sd-green-line, rgba(0, 255, 136, 0.4))' : LINE,
              borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4,
              background: 'rgba(var(--sd-ink, 255, 255, 255), 0.03)', minWidth: 0,
            }}>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: FG1, fontWeight: 650, fontSize: 14 }}>{shown.name}</span>
                <span style={{ color: FG3, fontSize: 12 }}>{shown.version}{p.size ? ` · ${size(p.size)}` : ''}</span>
              </div>
              <div style={{ fontSize: 13, color: FG3, lineHeight: 1.5 }}>{shown.about}</div>
              {shown.risk && (
                <div style={{ fontSize: 12.5, color: GOLD, lineHeight: 1.5 }}><strong>Risk:</strong> {shown.risk}</div>
              )}
              {p.problem && (
                <div style={{ fontSize: 12.5, color: GOLD, lineHeight: 1.5 }}><strong>Not for this version.</strong> {p.problem}</div>
              )}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
                {state === 'downloading' && <WorkBar kind="downloading" label="Getting the plugin list and the package, and checking them…" />}
                {state === 'installing' && (
                  <WorkBar kind="installing" label={`${isUpdate(offer) ? 'Updating' : 'Installing'} ${shown.name}…`} />
                )}
                {state === 'confirm' && <CardYes offer={offer} busy={install.busy} onInstall={install.install} onCancel={install.cancel} />}
                {state === 'idle' && <>
                  {action === 'installed' && (
                    <span data-card-installed={done ? 'updated' : ''} style={{ color: GREEN, fontSize: 13, fontWeight: 650 }}>{done || 'Installed ✓'}</span>
                  )}
                  {ACTION_LABEL[action] && (
                    <Btn primary={!quiet && action !== 'reinstall'} onClick={() => install.get(p)} disabled={anyBusy}>{ACTION_LABEL[action]}</Btn>
                  )}
                  <span style={{ color: 'var(--sd-fg-4, #667)', fontSize: 12 }}>
                    {action === 'update' && have?.version ? `${have.version} installed · ` : ''}
                    {p.host ? `from ${p.host}` : ACTION_LABEL[action] ? 'Downloaded only when you press Install' : ''}
                  </span>
                </>}
              </div>
              {error && <div data-card-error="" role="alert" style={{ fontSize: 12.5, color: RED, lineHeight: 1.5, marginTop: 4 }}>{error}</div>}
            </div>
          );
        })}
      </div>
      <SourceLines source={catalog.source} dropped={catalog.dropped} />
    </div>
  );
}

/** Is this offer a newer version of a plugin installed here: an Update? */
function isUpdate(offer) {
  return Boolean(offer?.replaces?.version && compareVersions(offer.plugin.version, offer.replaces.version) > 0);
}

/**
 * The yes, inside the card: the card above it already shows the package's
 * name, version, what it does and its risk; this adds that a plugin runs its
 * own code here, where it came from and what vouches for it, what it
 * replaces, and that it turns plugins on when they were off. For an Update it
 * asks from which version to which. Nothing installs without Install (or
 * Update) here.
 */
function CardYes({ offer, busy, onInstall, onCancel }) {
  const { plugin, from, replaces, turnsOn } = offer;
  const update = isUpdate(offer);
  return (
    <div data-card-yes={update ? 'update' : 'install'} style={{ width: '100%', borderTop: LINE, paddingTop: 10, fontSize: 13, color: FG3, lineHeight: 1.55 }}>
      <div style={{ color: FG1, fontWeight: 650 }}>
        {update ? `Update ${plugin.name} from ${replaces.version} to ${plugin.version}?` : `Install ${plugin.name} ${plugin.version}?`}
      </div>
      <div style={{ marginTop: 4 }}>{PLUGIN_TRUST_LINE}</div>
      {from && (
        <div data-plugin-from={from.kind} style={{ marginTop: 4 }}>
          Downloaded from <strong>{from.host}</strong>. {from.kind === 'link' ? LINK_CHECK_LINE : LIST_CHECK_LINE}
        </div>
      )}
      {replaces && <div style={{ marginTop: 4 }}>It replaces {replaces.version ? `version ${replaces.version}` : 'the copy'}, which is installed now.</div>}
      {turnsOn && <div data-turns-on="" style={{ marginTop: 4 }}>{TURNS_ON_LINE}</div>}
      <div style={{ ...row, marginTop: 10 }}>
        <Btn primary onClick={onInstall} disabled={!!busy}>{update ? 'Update' : 'Install'}</Btn>
        <Btn onClick={onCancel} disabled={!!busy}>Cancel</Btn>
      </div>
    </div>
  );
}

/**
 * The yes for a package from a file or a link (Settings → Plugins →
 * Advanced): its own name, version, what it does and its risk, that a plugin
 * runs its own code here, where it came from and what vouches for it, and
 * what it replaces. Nothing installs without Install here.
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

/** A note (an install done, or why not) or a waiting yes, where `at` is: 'link', 'file' or 'installed'. */
export function PluginOfferAt({ at, install }) {
  const { offer, note, busy } = install;
  return (
    <>
      {offer?.at === at && <PluginOffer offer={offer} busy={busy} onInstall={install.install} onCancel={install.cancel} />}
      {note?.at === at && <Status tone={note.tone}>{note.text}</Status>}
    </>
  );
}
