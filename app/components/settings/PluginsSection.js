'use client';

// Settings → Plugins (Blake, 2026-10-12: "a plugins tab in the settings to
// install these plugins"). Enable plugins is a switch, off by default ("we
// would first have to enable plug ins"). Off, the section is the switch and a
// sentence; on, the installed plugins, each with Uninstall, and Install from a
// file. The server does the work (app/api/plugins, lib/plugins.js); this
// section only asks, on a click.
//
// Nothing installs without a yes: a picked package is checked through first,
// and its name, version, what it does and its risk are shown with the plain
// line that a plugin runs its own code here. Install then sends the checksum
// that check answered, so only the package agreed to goes in
// (lib/plugins-client.js CONFIRM_HEADER).

import { useEffect, useId, useRef, useState } from 'react';
import { Section, Body, Status, Btn, LINE } from '../ui';
import {
  fetchPlugins, savePluginsEnabled, checkPackage, installPackage, removePlugin, MAX_PLUGIN_BYTES, PLUGIN_TRUST_LINE,
} from '../../../lib/plugins-client';

const row = { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' };
const subhead = { fontSize: 14, fontWeight: 650, margin: '26px 0 4px', color: 'var(--sd-fg-1, #e8e8ee)' };
const STATE_LABEL = { unsupported: 'Switched off', broken: 'Broken' };

function size(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

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
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  // A picked package and what its check said: { file, plugin, sha256, replaces }.
  const [offer, setOffer] = useState(null);
  const [note, setNote] = useState(null);
  // The plugin whose Uninstall is asking "are you sure", and what its row says after.
  const [confirming, setConfirming] = useState(null);
  const [rowNote, setRowNote] = useState(null);

  useEffect(() => {
    let gone = false;
    fetchPlugins().then((v) => { if (!gone) setView(v); }).catch((e) => { if (!gone) setError(e.message); });
    return () => { gone = true; };
  }, []);

  async function toggle(on) {
    setBusy('enable');
    setError(null);
    try {
      setView(await savePluginsEnabled(on));
      if (!on) { setOffer(null); setNote(null); setConfirming(null); }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function choose(event) {
    const file = event.target.files?.[0] || null;
    if (picker.current) picker.current.value = '';
    setOffer(null);
    setNote(null);
    if (!file) return;
    if (file.size > MAX_PLUGIN_BYTES) {
      setNote({ tone: 'bad', text: `That file is ${size(file.size)}. A plugin package can be up to ${size(MAX_PLUGIN_BYTES)}.` });
      return;
    }
    setBusy('check');
    try {
      const checked = await checkPackage(file);
      setOffer({ file, ...checked });
    } catch (e) {
      setNote({ tone: 'bad', text: `${file.name} can’t be installed. ${e.message}` });
    } finally {
      setBusy(null);
    }
  }

  async function install() {
    if (!offer) return;
    setBusy('install');
    setNote(null);
    try {
      const done = await installPackage(offer.file, offer.sha256);
      setView({ enabled: done.enabled, plugins: done.plugins, scanner: done.scanner });
      setNote({
        tone: 'ok',
        text: `Installed ${done.installed.name} ${done.installed.version}${done.replaced?.version ? `, in place of ${done.replaced.version}` : ''}.`,
      });
      setOffer(null);
    } catch (e) {
      setNote({ tone: 'bad', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(plugin) {
    setBusy(`uninstall:${plugin.id}`);
    setRowNote(null);
    try {
      const done = await removePlugin(plugin.id);
      setView({ enabled: done.enabled, plugins: done.plugins, scanner: done.scanner });
      setConfirming(null);
      setNote({ tone: 'ok', text: `Uninstalled ${done.removed.name}${done.removed.version ? ` ${done.removed.version}` : ''}.` });
    } catch (e) {
      setRowNote({ id: plugin.id, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const on = view?.enabled === true;
  const plugins = view?.plugins || [];

  return (
    <Section id="plugins" title="Plugins">
      <div data-plugins-switch="" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 8 }}>
        <input id={id} type="checkbox" checked={on} disabled={!view || busy === 'enable'} onChange={(e) => toggle(e.target.checked)}
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
                        {busy === `uninstall:${p.id}` ? 'Uninstalling…' : 'Uninstall'}
                      </Btn>
                      <Btn onClick={() => { setConfirming(null); setRowNote(null); }} disabled={busy === `uninstall:${p.id}`}>Cancel</Btn>
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

          <h3 style={subhead}>Install from a file</h3>
          <Body>
            Pick a plugin package (a .sgplugin file). You see what it is and what it does before anything is installed.
          </Body>
          <input ref={picker} type="file" accept=".sgplugin" onChange={choose} style={{ display: 'none' }} />
          <div style={row}>
            <Btn onClick={() => picker.current?.click()} disabled={!!busy}>
              {busy === 'check' ? 'Checking the package…' : 'Install from a file…'}
            </Btn>
          </div>
          {offer && (
            <Status>
              <div data-plugin-offer="" style={{ color: 'var(--sd-fg-1, #e8e8ee)', fontWeight: 650 }}>
                {offer.plugin.name} {offer.plugin.version}
              </div>
              <div style={{ marginTop: 4 }}>{offer.plugin.about}</div>
              {offer.plugin.risk && (
                <div style={{ marginTop: 8, color: 'var(--sd-gold, #FFD700)' }}>
                  <strong>Risk:</strong> {offer.plugin.risk}
                </div>
              )}
              <div style={{ marginTop: 8 }}>{PLUGIN_TRUST_LINE}</div>
              {offer.replaces && (
                <div style={{ marginTop: 8 }}>
                  It replaces {offer.replaces.version ? `version ${offer.replaces.version}` : 'the copy'}, which is installed now.
                </div>
              )}
              <div style={row}>
                <Btn primary onClick={install} disabled={!!busy}>{busy === 'install' ? 'Installing…' : 'Install'}</Btn>
                <Btn onClick={() => setOffer(null)} disabled={busy === 'install'}>Cancel</Btn>
              </div>
            </Status>
          )}
          {note && <Status tone={note.tone}>{note.text}</Status>}
        </>
      )}
    </Section>
  );
}
