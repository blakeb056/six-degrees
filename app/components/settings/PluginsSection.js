'use client';

// Settings → Plugins (Blake, 2026-10-12: "a plugins tab in the settings to
// install these plugins"). Enable plugins is a switch, off by default ("we
// would first have to enable plug ins"). Off, the section is the switch and a
// sentence. On: Browse first, the plugin list's cards with one-click Install
// (Blake, 2026-10-14: "i dont want them have to drag and drop"); then the
// installed plugins, each with Uninstall; then a closed Advanced, with Install
// from a file and Install from a link. The server does the work
// (app/api/plugins, lib/plugins.js, lib/plugin-catalog.js); this section only
// asks, on a person's open or click.
//
// The plugin list is the one thing here that goes online, and only when the
// section is opened with plugins on: the first time its Browse comes into
// view (scrolled to, picked in the notch, or just switched on), then again
// only on Try again. Settings is one long page, so opening it for anything
// else never fetches the list.
//
// Nothing installs without a yes (PluginBrowse.js PluginOffer): a package,
// from the list, a link or a file, is checked through first, and its name,
// version, what it does and its risk are shown with the plain line that a
// plugin runs its own code here. Install then sends the checksum that check
// answered, so only the package agreed to goes in (lib/plugins-client.js
// CONFIRM_HEADER).

import { useEffect, useId, useRef, useState } from 'react';
import { Section, Body, Status, Btn, LINE } from '../ui';
import { fetchPlugins, savePluginsEnabled, removePlugin, MAX_PLUGIN_BYTES } from '../../../lib/plugins-client';
import { usePluginInstall, PluginCards, PluginOfferAt, size } from './PluginBrowse';

const row = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' };
const subhead = { fontSize: 14, fontWeight: 650, margin: '26px 0 4px', color: 'var(--sd-fg-1, #e8e8ee)' };
const minorhead = { fontSize: 13.5, fontWeight: 650, margin: '18px 0 2px', color: 'var(--sd-fg-1, #e8e8ee)' };
const STATE_LABEL = { unsupported: 'Switched off', broken: 'Broken' };

/** Which scanner scans run now, in a sentence. */
function scannerLine(scanner) {
  if (!scanner) return null;
  if (scanner.from === 'plugin') return `Scans use the scanner from ${scanner.plugin.name} ${scanner.plugin.version}.`;
  if (scanner.from === 'built-in') return 'Scans use the scanner built into Sixgree.';
  return 'No scanner is installed, so scanning is off.';
}

export default function PluginsSection() {
  const id = useId();
  const picker = useRef(null);
  const browseRef = useRef(null);
  const asked = useRef(false);
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [link, setLink] = useState('');
  // The plugin whose Uninstall is asking "are you sure", and what its row says after.
  const [confirming, setConfirming] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [rowNote, setRowNote] = useState(null);
  const install = usePluginInstall({ onInstalled: setView });
  const busy = install.busy || (toggling ? 'enable' : null) || (removing ? `uninstall:${removing}` : null);
  const { load } = install;

  useEffect(() => {
    let gone = false;
    fetchPlugins().then((v) => { if (!gone) setView(v); }).catch((e) => { if (!gone) setError(e.message); });
    return () => { gone = true; };
  }, []);

  const on = view?.enabled === true;

  // The plugin list, the first time Browse is in view with plugins on. Once
  // per visit: `asked` outlives React's second run of effects in development,
  // and the observer stops at its first sight.
  useEffect(() => {
    const el = browseRef.current;
    if (!on || asked.current || !el) return undefined;
    const seen = () => {
      if (asked.current) return;
      asked.current = true;
      load();
    };
    if (typeof IntersectionObserver === 'undefined') {
      seen();
      return undefined;
    }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        watch.disconnect();
        seen();
      }
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [on, load]);

  async function toggle(next) {
    setToggling(true);
    setError(null);
    try {
      setView(await savePluginsEnabled(next));
      if (!next) { install.reset(); setConfirming(null); }
    } catch (e) {
      setError(e.message);
    } finally {
      setToggling(false);
    }
  }

  function choose(event) {
    const file = event.target.files?.[0] || null;
    if (picker.current) picker.current.value = '';
    install.reset();
    if (!file) return;
    if (file.size > MAX_PLUGIN_BYTES) {
      install.setNote({ at: 'file', tone: 'bad', text: `That file is ${size(file.size)}. A plugin package can be up to ${size(MAX_PLUGIN_BYTES)}.` });
      return;
    }
    install.checkFile(file);
  }

  async function uninstall(plugin) {
    setRemoving(plugin.id);
    setRowNote(null);
    try {
      const done = await removePlugin(plugin.id);
      setView({ enabled: done.enabled, plugins: done.plugins, scanner: done.scanner });
      setConfirming(null);
      install.setNote({ at: 'installed', tone: 'ok', text: `Uninstalled ${done.removed.name}${done.removed.version ? ` ${done.removed.version}` : ''}.` });
    } catch (e) {
      setRowNote({ id: plugin.id, text: e.message });
    } finally {
      setRemoving(null);
    }
  }

  const plugins = view?.plugins || [];

  return (
    <Section id="plugins" title="Plugins">
      <div data-plugins-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 8 }}>
        <input id={id} type="checkbox" checked={on} disabled={!view || toggling} onChange={(e) => toggle(e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: '#00c870', cursor: 'pointer' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <label htmlFor={id} style={{ display: 'block', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Enable plugins
          </label>
          <div style={{ fontSize: 12.5, color: 'var(--sd-fg-3, #8b9a9a)', lineHeight: 1.5 }}>
            Plugins add features to Sixgree, such as a scanner, from packages you install on this computer.
            {on ? ' Turn this off and every plugin stays installed but none of them is used.' : ''}
          </div>
        </div>
      </div>
      {error && <Status tone="bad">{error}</Status>}

      {on && (
        <>
          <h3 style={subhead}>Browse</h3>
          <div ref={browseRef} data-plugins-browse="">
            <Body>
              The plugins on the official list. Install downloads one and shows you what it is before anything is installed.
            </Body>
            <PluginCards catalog={install.catalog} installed={plugins} busy={busy} onGet={install.get} onRetry={load} />
          </div>
          <PluginOfferAt at="browse" install={install} />

          <h3 style={subhead}>Installed</h3>
          {plugins.length === 0 && <Body>None yet.</Body>}
          {plugins.map((p) => {
            const asking = confirming === p.id;
            return (
              <div key={p.id} data-plugin={p.id} style={{ padding: '10px 0', borderTop: LINE }}>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--sd-fg-1, #e8e8ee)', fontWeight: 650, fontSize: 13.5 }}>
                    {p.name}
                    {p.version && <span style={{ fontWeight: 400, color: 'var(--sd-fg-3, #8b9a9a)' }}> · {p.version}</span>}
                    {STATE_LABEL[p.state] && (
                      <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 650, color: p.state === 'broken' ? 'var(--sd-red, #ff7676)' : 'var(--sd-gold, #FFD700)' }}>
                        {STATE_LABEL[p.state]}
                      </span>
                    )}
                  </span>
                </div>
                {p.about && <Body style={{ fontSize: 13 }}>{p.about}</Body>}
                {p.problem && <Body style={{ fontSize: 12.5, color: p.state === 'broken' ? 'var(--sd-red, #ff7676)' : 'var(--sd-gold, #FFD700)' }}>{p.problem}</Body>}
                {asking ? (
                  <Status>
                    Uninstall {p.name}{p.version ? ` ${p.version}` : ''}? Its files go from this computer. Whatever it brought
                    into your network stays.
                    <div style={row}>
                      <Btn tone="bad" onClick={() => uninstall(p)} disabled={!!busy}>
                        {removing === p.id ? 'Uninstalling…' : 'Uninstall'}
                      </Btn>
                      <Btn onClick={() => { setConfirming(null); setRowNote(null); }} disabled={removing === p.id}>Cancel</Btn>
                    </div>
                  </Status>
                ) : (
                  <div style={{ ...row, marginTop: 8 }}>
                    <Btn onClick={() => { setConfirming(p.id); setRowNote(null); }} disabled={!!busy}>Uninstall</Btn>
                  </div>
                )}
                {rowNote?.id === p.id && <Status tone="bad">{rowNote.text}</Status>}
              </div>
            );
          })}
          <Body style={{ fontSize: 12.5, marginTop: 10 }}>
            {scannerLine(view.scanner)}
            {view.scanner?.skipped ? ` ${view.scanner.skipped}` : ''}
          </Body>
          <PluginOfferAt at="installed" install={install} />

          <details data-plugins-advanced="" style={{ marginTop: 24, borderTop: LINE, paddingTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 650, color: 'var(--sd-fg-2, #c3cbda)' }}>Advanced</summary>

            <h4 style={minorhead}>Install from a file</h4>
            <Body>
              Pick a plugin package (a .sgplugin file). You see what it is and what it does before anything is installed.
            </Body>
            <input ref={picker} type="file" accept=".sgplugin" onChange={choose} style={{ display: 'none' }} />
            <div style={row}>
              <Btn onClick={() => picker.current?.click()} disabled={!!busy}>
                {busy === 'check' ? 'Checking the package…' : 'Install from a file…'}
              </Btn>
            </div>
            <PluginOfferAt at="file" install={install} />

            <h4 style={minorhead}>Install from a link</h4>
            <Body>
              Paste an https link to a .sgplugin package. It is downloaded when you press Install from the link, and you see
              what it is before anything is installed.
            </Body>
            <form style={row} onSubmit={(e) => { e.preventDefault(); if (link.trim()) install.getLink(link.trim()); }}>
              <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/plugin.sgplugin"
                aria-label="Link to a plugin package" data-plugin-link="" spellCheck={false} autoComplete="off"
                style={{
                  flex: '1 1 260px', minWidth: 0, padding: '9px 12px', borderRadius: 7, border: LINE, fontSize: 13.5,
                  background: 'rgba(var(--sd-ink, 255, 255, 255), 0.05)', color: 'var(--sd-fg-1, #fff)', fontFamily: 'inherit',
                }} />
              <Btn type="submit" disabled={!!busy || !link.trim()}>
                {busy === 'link' ? 'Downloading…' : 'Install from the link…'}
              </Btn>
            </form>
            <PluginOfferAt at="link" install={install} />
          </details>
        </>
      )}
    </Section>
  );
}
