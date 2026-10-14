// lib/plugins.js: plugin packages checked, installed, listed and removed, in
// a temporary data folder (SIX_DEGREES_HOME's stand-in), never the real one.
//
// What it promises: a manifest that isn't sound, a file the manifest doesn't
// list, a file that doesn't match its checksum, or a plugin made for another
// version of Sixgree is refused with a plain reason, and nothing is written; a
// package installs only with its own checksum as the yes; a reinstall that
// fails halfway leaves the old version exactly as it was; an uninstall
// removes the plugin's folder and nothing else; and a plugin changed or broken
// on the disk is listed as broken, never thrown. Every package is invented.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, utimesSync,
  renameSync as renameReal,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkManifest, readPackage, installPlugin, uninstallPlugin, listPlugins, scannerPlugin, installedPlugin,
  parseRange, rangeAllows, fitProblem, PluginError, PLUGINS_DIR,
} from '../lib/plugins.js';
import { PLUGIN_WORK_PREFIX, sweepLeftovers } from '../lib/data-folder.js';
import { makePackage, sha256, STAND_IN_SCANNER } from './helpers/plugins.mjs';
import { writeZip } from '../lib/zip-write.js';
import { buildPackage, PLUGINS } from '../scripts/build-plugin.mjs';
import { standInRoot } from './helpers/scanner.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'sixgree-plugins-'));
let home;
let n = 0;

before(() => {
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
});

beforeEach(() => {
  home = path.join(dir, `home-${++n}`);
  mkdirSync(home);
});

const APP = { appVersion: '1.2.8' };
const install = (pkg, opts = {}) => installPlugin(home, pkg.zip, { ...APP, sha256: pkg.sha256, ...opts });
const pluginsIn = () => (existsSync(path.join(home, PLUGINS_DIR)) ? readdirSync(path.join(home, PLUGINS_DIR)) : []);
const workFolders = () => readdirSync(home).filter((name) => name.startsWith(PLUGIN_WORK_PREFIX));

function refused(fn, pattern, status = 400) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof PluginError, `a PluginError, not ${err?.constructor?.name}: ${err?.message}`);
    assert.match(err.message, pattern);
    assert.equal(err.status, status, err.message);
    return true;
  });
}

const good = () => makePackage().manifest;

test('a sound manifest is accepted and comes back cleaned', () => {
  const m = checkManifest({ ...good(), name: '  Manual scan  ', extra_key_from_a_later_format: true });
  assert.equal(m.name, 'Manual scan');
  assert.deepEqual(m.unlocks, ['manual']);
  assert.equal(m.risk, 'An invented risk note.');
  assert.equal(Object.isFrozen(m), true);
  assert.equal('extra_key_from_a_later_format' in m, false);
  assert.equal(checkManifest({ ...good(), risk: undefined }).risk, null, 'risk is optional');
  assert.deepEqual(checkManifest({ ...good(), unlocks: ['auto', 'manual'] }).unlocks, ['auto', 'manual']);
});

test('each part of a manifest is checked, with a reason in words', () => {
  const g = good();
  for (const [change, pattern] of [
    [{ format: 'zip' }, /isn’t a Sixgree plugin/],
    [{ format_version: 0 }, /format_version isn’t one Sixgree knows/],
    [{ id: 'Manual-Scan' }, /id isn’t one Sixgree accepts/],
    [{ id: '-scan' }, /id isn’t one Sixgree accepts/],
    [{ id: 'a' }, /id isn’t one Sixgree accepts/],
    [{ id: '../scan' }, /id isn’t one Sixgree accepts/],
    [{ id: 'x'.repeat(42) }, /id isn’t one Sixgree accepts/],
    [{ name: '' }, /has no name/],
    [{ name: 'x'.repeat(61) }, /name is longer than 60/],
    [{ name: 'Manual ‮scan' }, /aren’t plain text/],
    [{ name: 7 }, /name isn’t text/],
    [{ version: 'one' }, /isn’t a version number/],
    [{ sixgree: 'any' }, /which Sixgree it is for/],
    [{ sixgree: '>=1.2' }, /which Sixgree it is for/],
    [{ about: undefined }, /has no about/],
    [{ kind: 'theme' }, /kind of plugin this Sixgree doesn’t know/],
    [{ unlocks: [] }, /unlocks must list/],
    [{ unlocks: ['everything'] }, /unlocks must list/],
    [{ unlocks: ['auto', 'auto'] }, /unlocks must list/],
    [{ files: [] }, /no list of files/],
    [{ files: {} }, /1 to 200 files/],
    [{ files: { ...g.files, '../evil.py': sha256('x') } }, /climbs out/],
    [{ files: { ...g.files, 'Manifest.json': sha256('x') } }, /manifest itself/],
    [{ files: { ...g.files, 'scanner/Scrape.py': sha256('x') } }, /twice/],
    [{ files: { ...g.files, 'scanner/scrape.py': 'not-a-checksum' } }, /isn’t a SHA-256/],
    [{ files: { ...g.files, scanner: sha256('x') } }, /scanner as a file and as a folder/],
    [{ files: { 'scanner/scrape.py': g.files['scanner/scrape.py'] } }, /doesn’t list scanner\/requirements\.txt/],
  ]) {
    refused(() => checkManifest({ ...g, ...change }), pattern);
  }
  refused(() => checkManifest(null), /isn’t a JSON object/);
  refused(() => checkManifest([]), /isn’t a JSON object/);
  // A newer format says to update, rather than that the package is wrong.
  refused(() => checkManifest({ ...g, format_version: 2 }), /made for a newer Sixgree.*Update Sixgree/, 409);
});

test('which Sixgree a plugin is for: ranges read, checked, and said in words', () => {
  assert.deepEqual(parseRange('>=1.2.8'), [{ op: '>=', version: '1.2.8' }]);
  assert.deepEqual(parseRange(' >=2.0.0   <3.0.0 '), [{ op: '>=', version: '2.0.0' }, { op: '<', version: '3.0.0' }]);
  assert.deepEqual(parseRange('1.2.8'), [{ op: '=', version: '1.2.8' }]);
  for (const bad of ['', '>= 1.2.8', '^1.2.8', '1.2', '>=1.2.8 || 2.0.0', 'a b c d e', null]) assert.equal(parseRange(bad), null, String(bad));
  const r = parseRange('>=1.2.8 <2.0.0');
  assert.equal(rangeAllows(r, '1.2.8'), true);
  assert.equal(rangeAllows(r, '1.10.0'), true);
  assert.equal(rangeAllows(r, '1.2.7'), false);
  assert.equal(rangeAllows(r, '2.0.0'), false);
  assert.equal(rangeAllows(parseRange('>1.0.0 <=1.5.0'), '1.5.0'), true);
  assert.equal(fitProblem({ sixgree: '>=1.2.8' }, '1.2.8'), null);
  assert.equal(fitProblem({ sixgree: '>=2.0.0 <3.0.0' }, '1.2.8'),
    'It is made for Sixgree 2.0.0 or newer and older than 3.0.0, and this copy is 1.2.8.');
});

test('a sound package is read through and writes nothing', () => {
  const pkg = makePackage();
  const read = readPackage(pkg.zip, APP);
  assert.equal(read.manifest.id, 'manual-scan');
  assert.equal(read.sha256, pkg.sha256);
  assert.deepEqual([...read.files.keys()].sort(), Object.keys(STAND_IN_SCANNER).sort());
  assert.deepEqual(readdirSync(home), []);
  // Folders the files are in may be named in the zip too.
  const withFolder = makePackage({ extra: [{ name: 'scanner', dir: true }] });
  assert.equal(readPackage(withFolder.zip, APP).manifest.id, 'manual-scan');
});

test('a package is refused for a file it doesn’t list, one it lacks, or one that was changed', () => {
  refused(() => readPackage(makePackage({ extra: [{ name: 'scanner/extra.py', data: 'print(1)' }] }).zip, APP),
    /holds a file its manifest doesn’t list: scanner\/extra\.py/);
  // A second manifest that differs only in case is caught by the zip reader, as two names a disk would treat as one.
  refused(() => readPackage(makePackage({ extra: [{ name: 'Manifest.JSON', data: '{}' }] }).zip, APP), /Manifest\.JSON twice/);
  refused(() => readPackage(makePackage({ extra: [{ name: 'hidden', dir: true }] }).zip, APP), /folder its manifest doesn’t list: hidden\//);
  const g = good();
  refused(() => readPackage(makePackage({ manifest: { files: { ...g.files, 'scanner/more.py': sha256('more') } } }).zip, APP),
    /lists scanner\/more\.py, but the package doesn’t hold it/);
  refused(() => readPackage(makePackage({ manifest: { files: { ...g.files, 'scanner/scrape.py': sha256('something else') } } }).zip, APP),
    /scanner\/scrape\.py doesn’t match its checksum/);
});

test('a package is refused without a manifest, with a broken one, or when it is no zip a plugin may be', () => {
  refused(() => readPackage(writeZip([{ name: 'scanner/scrape.py', data: 'x' }]), APP), /no manifest\.json at its top/);
  refused(() => readPackage(makePackage({ rawManifest: '{ not json' }).zip, APP), /isn’t valid JSON/);
  refused(() => readPackage(makePackage({ extra: [{ name: '../evil.py', data: 'x' }] }).zip, APP), /opened safely.*climbs out/);
  refused(() => readPackage(Buffer.from('not a zip, just some words in a file'), APP), /opened safely/);
  refused(() => readPackage(Buffer.alloc(0), APP), /no package/);
  refused(() => readPackage(Buffer.alloc(8 * 1024 * 1024 + 1), APP), /larger than a plugin package may be/, 413);
});

test('a plugin made for another version of Sixgree is refused at install, in words', () => {
  const pkg = makePackage({ manifest: { sixgree: '>=2.0.0' } });
  refused(() => install(pkg), /made for Sixgree 2\.0\.0 or newer, and this copy is 1\.2\.8/, 409);
  assert.deepEqual(pluginsIn(), []);
});

test('nothing installs without the yes: the package’s own checksum', () => {
  const pkg = makePackage();
  refused(() => installPlugin(home, pkg.zip, APP), /without a yes/, 409);
  refused(() => installPlugin(home, pkg.zip, { ...APP, sha256: sha256('another package') }), /isn’t the package you said yes to/, 409);
  assert.deepEqual(pluginsIn(), []);
  assert.deepEqual(workFolders(), []);
});

test('install puts exactly the package’s files in plugins/<id>/, and list shows it ready', () => {
  const pkg = makePackage();
  const done = install(pkg);
  assert.deepEqual(done.installed, {
    id: 'manual-scan', name: 'Manual scan', version: '1.0.0', about: 'An invented scanner, for tests.',
    risk: 'An invented risk note.', kind: 'scanner', unlocks: ['manual'],
  });
  assert.equal(done.replaced, null);
  const folder = path.join(home, PLUGINS_DIR, 'manual-scan');
  assert.deepEqual(readdirSync(folder).sort(), ['manifest.json', 'scanner']);
  assert.deepEqual(readdirSync(path.join(folder, 'scanner')).sort(), ['image_store.py', 'requirements.txt', 'scrape.py']);
  assert.equal(readFileSync(path.join(folder, 'scanner', 'scrape.py'), 'utf8'), STAND_IN_SCANNER['scanner/scrape.py']);
  // Nothing else in the data folder: no working folder left behind.
  assert.deepEqual(readdirSync(home), [PLUGINS_DIR]);
  const [listed] = listPlugins(home, APP);
  assert.equal(listed.state, 'ready');
  assert.equal(listed.problem, null);
  assert.equal(listed.name, 'Manual scan');
  assert.equal(installedPlugin(home, 'manual-scan', APP).state, 'ready');
  assert.equal(installedPlugin(home, 'auto-scan', APP), null);
  assert.equal(installedPlugin(home, '../x', APP), null);
});

test('a reinstall replaces the old version whole', () => {
  install(makePackage());
  const v2 = makePackage({
    files: { ...STAND_IN_SCANNER, 'scanner/scrape.py': 'raise SystemExit("version two")\n' },
    manifest: { version: '1.1.0' },
  });
  const done = install(v2);
  assert.deepEqual(done.replaced, { version: '1.0.0', state: 'ready' });
  const [listed] = listPlugins(home, APP);
  assert.equal(listed.version, '1.1.0');
  assert.equal(readFileSync(path.join(home, PLUGINS_DIR, 'manual-scan', 'scanner', 'scrape.py'), 'utf8'), 'raise SystemExit("version two")\n');
  assert.deepEqual(readdirSync(home), [PLUGINS_DIR]);
});

test('a reinstall that fails halfway leaves the old version exactly as it was', () => {
  install(makePackage());
  const folder = path.join(home, PLUGINS_DIR, 'manual-scan');
  const before = readFileSync(path.join(folder, 'scanner', 'scrape.py'));
  const v2 = makePackage({ files: { ...STAND_IN_SCANNER, 'scanner/scrape.py': 'version two' }, manifest: { version: '2.0.0' } });

  // The move into place fails, after the old copy was moved aside: it is put back.
  let moves = 0;
  const failSecond = (from, to) => {
    moves++;
    if (moves === 2) throw Object.assign(new Error('the disk said no'), { code: 'EIO' });
    return renameReal(from, to);
  };
  refused(() => install(v2, { rename: failSecond }), /couldn’t be put in place \(the disk said no\)\. The version installed before is kept/, 500);
  assert.equal(moves, 3, 'aside, into place (failed), and back');
  assert.deepEqual(readFileSync(path.join(folder, 'scanner', 'scrape.py')), before);
  assert.equal(listPlugins(home, APP)[0].version, '1.0.0');
  assert.equal(listPlugins(home, APP)[0].state, 'ready');
  assert.deepEqual(workFolders(), [], 'the unpacked copy is gone');

  // The move aside itself fails: nothing was touched.
  refused(() => install(v2, { rename: () => { throw new Error('busy'); } }), /The version installed before is kept/, 500);
  assert.equal(listPlugins(home, APP)[0].version, '1.0.0');

  // A broken package fails before anything moves: the old version is untouched.
  const broken = makePackage({ manifest: { version: '3.0.0', files: { ...good().files, 'scanner/scrape.py': sha256('not this') } } });
  refused(() => install(broken), /doesn’t match its checksum/);
  assert.equal(listPlugins(home, APP)[0].version, '1.0.0');
  assert.deepEqual(workFolders(), []);
});

test('uninstall removes the plugin’s folder and nothing else', () => {
  install(makePackage());
  install(makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan', unlocks: ['auto'] } }));
  // Something the plugin brought into the data folder: it stays.
  writeFileSync(path.join(home, 'linkedin-activity.json'), '{"searches":[]}');
  const done = uninstallPlugin(home, 'manual-scan', APP);
  assert.deepEqual(done.removed, { id: 'manual-scan', name: 'Manual scan', version: '1.0.0' });
  assert.deepEqual(pluginsIn(), ['auto-scan']);
  assert.ok(existsSync(path.join(home, 'linkedin-activity.json')));
  assert.deepEqual(workFolders(), []);
  refused(() => uninstallPlugin(home, 'manual-scan', APP), /No plugin called manual-scan is installed/, 404);
  for (const bad of ['../auto-scan', '', 'Auto-Scan', null, '.']) refused(() => uninstallPlugin(home, bad, APP), /isn’t the id of a plugin/);
  assert.deepEqual(pluginsIn(), ['auto-scan']);
  // A broken plugin can be removed too.
  rmSync(path.join(home, PLUGINS_DIR, 'auto-scan', 'manifest.json'));
  assert.equal(uninstallPlugin(home, 'auto-scan', APP).removed.id, 'auto-scan');
  assert.deepEqual(pluginsIn(), []);
});

test('list shows a changed, broken or misfiled plugin as broken, with why, and never throws', () => {
  install(makePackage());
  const folder = path.join(home, PLUGINS_DIR, 'manual-scan');
  writeFileSync(path.join(folder, 'scanner', 'scrape.py'), 'print("changed after install")');
  let [p] = listPlugins(home, APP);
  assert.equal(p.state, 'broken');
  assert.equal(p.problem, 'scanner/scrape.py has changed since it was installed.');
  assert.equal(p.name, 'Manual scan', 'what the manifest says is still shown');

  rmSync(path.join(folder, 'scanner', 'scrape.py'));
  [p] = listPlugins(home, APP);
  assert.equal(p.problem, 'scanner/scrape.py is missing.');

  // A link in place of a file is never followed.
  writeFileSync(path.join(dir, `outside-${n}.py`), STAND_IN_SCANNER['scanner/scrape.py']);
  symlinkSync(path.join(dir, `outside-${n}.py`), path.join(folder, 'scanner', 'scrape.py'));
  [p] = listPlugins(home, APP);
  assert.equal(p.problem, 'scanner/scrape.py isn’t a plain file.');

  writeFileSync(path.join(folder, 'manifest.json'), '{ broken');
  [p] = listPlugins(home, APP);
  assert.deepEqual([p.id, p.name, p.state, p.problem], ['manual-scan', 'manual-scan', 'broken', 'Its manifest.json isn’t valid JSON.']);

  // A folder whose manifest names another plugin.
  install(makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan' } }));
  const renamed = path.join(home, PLUGINS_DIR, 'other-scan');
  renameReal(path.join(home, PLUGINS_DIR, 'auto-scan'), renamed);
  const other = listPlugins(home, APP).find((x) => x.id === 'other-scan');
  assert.equal(other.problem, 'Its folder is other-scan, but its manifest says it is auto-scan.');

  // A link where a plugin's folder should be, and things that aren't plugins at all.
  symlinkSync(renamed, path.join(home, PLUGINS_DIR, 'linked-scan'));
  writeFileSync(path.join(home, PLUGINS_DIR, '.DS_Store'), '');
  mkdirSync(path.join(home, PLUGINS_DIR, 'Not A Plugin'));
  const all = listPlugins(home, APP);
  assert.deepEqual(all.map((x) => x.id).sort(), ['linked-scan', 'manual-scan', 'other-scan']);
  assert.equal(all.find((x) => x.id === 'linked-scan').problem, 'It isn’t a folder.');
  assert.deepEqual(listPlugins(path.join(dir, 'no-such-folder'), APP), []);
});

test('a plugin a new Sixgree no longer fits stays installed, switched off', () => {
  install(makePackage({ manifest: { sixgree: '>=1.2.0 <1.3.0' } }));
  const [p] = listPlugins(home, { appVersion: '1.3.0' });
  assert.equal(p.state, 'unsupported');
  assert.match(p.problem, /made for Sixgree 1\.2\.0 or newer and older than 1\.3\.0, and this copy is 1\.3\.0\. It stays installed, switched off\./);
  assert.equal(listPlugins(home, APP)[0].state, 'ready');
});

test('the scanner plugin: the newest ready one, and why any other wasn’t used', () => {
  assert.deepEqual(scannerPlugin(home, APP), { plugin: null, dir: null, skipped: [] });
  install(makePackage({ manifest: { id: 'manual-scan', version: '1.0.0' } }));
  install(makePackage({ manifest: { id: 'auto-scan', name: 'Auto scan', version: '1.1.0', unlocks: ['auto'] } }));
  let s = scannerPlugin(home, APP);
  assert.equal(s.plugin.id, 'auto-scan', 'the newer version');
  assert.equal(s.dir, path.join(home, PLUGINS_DIR, 'auto-scan'));
  // The same version: the first by id.
  install(makePackage({ manifest: { id: 'manual-scan', version: '1.1.0' } }));
  assert.equal(scannerPlugin(home, APP).plugin.id, 'auto-scan');
  // A newer one that's broken is passed over, with why.
  install(makePackage({ manifest: { id: 'manual-scan', version: '9.0.0' } }));
  writeFileSync(path.join(home, PLUGINS_DIR, 'manual-scan', 'scanner', 'requirements.txt'), 'changed');
  s = scannerPlugin(home, APP);
  assert.equal(s.plugin.id, 'auto-scan');
  assert.deepEqual(s.skipped, ['Manual scan 9.0.0 can’t be used: scanner/requirements.txt has changed since it was installed.']);
});

test('a working folder an install left behind is swept once it is an hour old', () => {
  const left = mkdtempSync(path.join(home, PLUGIN_WORK_PREFIX));
  writeFileSync(path.join(left, 'half.py'), 'x');
  assert.equal(sweepLeftovers(home), 0, 'not yet: an install may still be using it');
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(left, old, old);
  assert.equal(sweepLeftovers(home), 1);
  assert.equal(existsSync(left), false);
});

test('scripts/build-plugin.mjs makes the two scanner packages, and both install', () => {
  const root = standInRoot(path.join(dir, `build-root-${n}`));
  assert.deepEqual(PLUGINS.map((p) => [p.id, p.unlocks]), [['auto-scan', ['auto']], ['manual-scan', ['manual']]]);
  for (const plugin of PLUGINS) {
    const zip = buildPackage(plugin, { version: '1.0.0', appVersion: '1.2.8', root });
    assert.ok(zip.equals(buildPackage(plugin, { version: '1.0.0', appVersion: '1.2.8', root })), 'the same bytes every time');
    const { manifest, files } = readPackage(zip, APP);
    assert.equal(manifest.id, plugin.id);
    assert.equal(manifest.sixgree, '>=1.2.8');
    assert.equal(manifest.kind, 'scanner');
    assert.ok(manifest.risk, 'each carries its risk');
    assert.deepEqual([...files.keys()], ['scanner/scrape.py', 'scanner/image_store.py', 'scanner/requirements.txt']);
    assert.equal(files.get('scanner/scrape.py').toString(), readFileSync(path.join(root, 'scripts', 'scrape.py'), 'utf8'));
    installPlugin(home, zip, { ...APP, sha256: sha256(zip) });
  }
  assert.deepEqual(listPlugins(home, APP).map((p) => [p.id, p.state]), [['auto-scan', 'ready'], ['manual-scan', 'ready']]);
  // Not for a Sixgree older than the one it was built with.
  refused(() => readPackage(buildPackage(PLUGINS[0], { version: '1.0.0', appVersion: '1.2.8', root }), { appVersion: '1.2.7' }),
    /made for Sixgree 1\.2\.8 or newer/, 409);
});
