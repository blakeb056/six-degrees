// Six Degrees became Sixgree. Only what people see was renamed; these are the
// bridges that keep every existing install working (docs/brain/00-START-HERE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dmgName, legacyDmgName, planFromRelease, parseSha256Sums, APP_BUNDLE_NAME, BUNDLE_ID,
} from '../lib/updater.js';
import { userDataPath, USER_DATA_FOLDER } from '../desktop/lib.mjs';

const repoFile = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const SLUG = 'blakeb056/six-degrees';

function release(version, names) {
  const tag = `v${version}`;
  return {
    tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/${SLUG}/releases/tag/${tag}`,
    assets: names.map((name) => ({
      name, size: 1000, browser_download_url: `https://github.com/${SLUG}/releases/download/${tag}/${name}`,
    })),
  };
}
const plan = (r, chip = 'arm64') => planFromRelease(r, { currentVersion: '1.0.0', chip, slug: SLUG });

test('bridge 1: the updater takes the new disk image name first, and the old one when that is all there is', () => {
  assert.equal(dmgName('1.0.1', 'arm64'), 'Sixgree-1.0.1-arm64.dmg');
  // Exactly what 1.0.0 asks for: release.yml must keep publishing this name.
  assert.equal(legacyDmgName('1.0.1', 'arm64'), 'Six-Degrees-1.0.1-arm64.dmg');
  const both = release('1.0.1', ['Six-Degrees-1.0.1-arm64.dmg', 'Sixgree-1.0.1-arm64.dmg', 'SHA256SUMS']);
  assert.equal(plan(both).plan.dmg.name, 'Sixgree-1.0.1-arm64.dmg');
  const oldOnly = release('1.0.1', ['Six-Degrees-1.0.1-x64.dmg', 'SHA256SUMS']);
  assert.equal(plan(oldOnly, 'x64').plan.dmg.name, 'Six-Degrees-1.0.1-x64.dmg');
  assert.equal(plan(oldOnly, 'arm64').refusal.code, 'no-download');
});

test('bridge 1: the release publishes every download under both names, all in SHA256SUMS', () => {
  // Run release.yml's own step on stand-in files.
  const yml = repoFile('.github/workflows/release.yml');
  const step = yml.split('- name: Downloads with fixed names, and checksums')[1].split('\n      - name:')[0];
  const script = step.split('run: |\n')[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sixgree-release-'));
  try {
    const bin = path.join(dir, 'bin');
    execFileSync('mkdir', ['-p', bin, path.join(dir, 'out')]);
    // GitHub's runner has sha256sum; a Mac has shasum.
    writeFileSync(path.join(bin, 'sha256sum'), '#!/bin/sh\nexec shasum -a 256 "$@"\n');
    chmodSync(path.join(bin, 'sha256sum'), 0o755);
    const out = path.join(dir, 'out');
    const made = ['Sixgree-1.0.1-arm64.dmg', 'Sixgree-1.0.1-x64.dmg', 'Sixgree-1.0.1-win-x64-Setup.exe',
      'six-degrees_1.0.1_amd64.deb', 'Sixgree-1.0.1-linux-x64.tar.gz'];
    for (const f of made) writeFileSync(path.join(out, f), f);
    execFileSync('bash', ['-e', '-c', script], { cwd: out, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: 'pipe' });
    const files = readdirSync(out);
    for (const want of [
      'Six-Degrees-1.0.1-arm64.dmg', 'Six-Degrees-1.0.1-x64.dmg',
      'Sixgree-Mac-Apple-Silicon.dmg', 'Sixgree-Mac-Intel.dmg', 'Six-Degrees-Mac-Apple-Silicon.dmg', 'Six-Degrees-Mac-Intel.dmg',
      'Sixgree-Windows-Setup.exe', 'Six-Degrees-Windows-Setup.exe',
      'Sixgree-Linux-x64.deb', 'Six-Degrees-Linux-x64.deb', 'Sixgree-Linux-x64.tar.gz', 'Six-Degrees-Linux-x64.tar.gz',
    ]) assert.ok(files.includes(want), want);
    assert.equal(readFileSync(path.join(out, 'Six-Degrees-1.0.1-arm64.dmg'), 'utf8'), 'Sixgree-1.0.1-arm64.dmg', 'the same file');
    const sums = parseSha256Sums(readFileSync(path.join(out, 'SHA256SUMS'), 'utf8'));
    for (const f of files.filter((n) => n !== 'SHA256SUMS')) assert.ok(sums.get(f), `${f} is in SHA256SUMS`);
    // And 1.0.0's updater, given this release, finds its file.
    const r = release('1.0.1', [...files]);
    const legacyFind = r.assets.find((a) => a.name === legacyDmgName('1.0.1', 'arm64'));
    assert.ok(legacyFind);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bridge 1: what 1.0.0 looks for inside the disk image is still there', () => {
  assert.equal(APP_BUNDLE_NAME, 'Six Degrees.app');
  assert.equal(BUNDLE_ID, 'com.blakeburford.sixdegrees');
  const build = repoFile('scripts/build-app.mjs');
  assert.ok(build.includes("const APP_NAME = 'Six Degrees';"), 'the bundle keeps its file name');
  assert.ok(build.includes("const DISPLAY_NAME = 'Sixgree';"));
  assert.match(build, /CFBundleDisplayName: DISPLAY_NAME/, 'the Electron app shows Sixgree');
  assert.match(build, /<key>CFBundleDisplayName<\/key><string>\$\{DISPLAY_NAME\}<\/string>/, 'so does the classic app');
  assert.match(build, /LSHasLocalizedDisplayName: true/, 'and Finder and the Dock use it');
});

test('bridge 2: Electron keeps its settings in the old "Six Degrees" folder, pinned before anything reads it', () => {
  assert.equal(USER_DATA_FOLDER, 'Six Degrees');
  assert.equal(userDataPath('/Users/me/Library/Application Support'), path.join('/Users/me/Library/Application Support', 'Six Degrees'));
  const main = repoFile('desktop/main.mjs');
  const at = (s) => { const i = main.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("app.setName('Sixgree');") < at("app.setPath('userData', USER_DATA);"));
  assert.ok(at("app.setPath('userData', USER_DATA);") < at('app.requestSingleInstanceLock()'), 'the lock lives in userData');
  assert.ok(at("app.setPath('sessionData', USER_DATA);") < at('app.whenReady()'));
  assert.ok(main.includes("app.setAppUserModelId('com.blakeburford.sixdegrees')"), 'Windows AppUserModelID unchanged');
  assert.ok(main.includes("path.join(os.homedir(), '.six-degrees')"), 'the network stays where it is');
});

test('bridge 3: Windows updates the same install and replaces the old shortcuts', () => {
  const iss = repoFile('scripts/windows/six-degrees.iss');
  assert.ok(iss.includes('AppId={{010929DA-B1D1-47A6-B6C8-BE7CC9ACA2C5}'), 'AppId unchanged');
  assert.ok(iss.includes('Type: files; Name: "{autoprograms}\\Six Degrees.lnk"'));
  assert.ok(iss.includes('Type: files; Name: "{autodesktop}\\Six Degrees.lnk"'));
  assert.ok(iss.includes('Name: "{autoprograms}\\Sixgree"; Filename: "{app}\\Six Degrees.exe"; AppUserModelID: "com.blakeburford.sixdegrees"'));
  assert.ok(iss.includes('Name: "{autodesktop}\\Sixgree"; Filename: "{app}\\Six Degrees.exe"; AppUserModelID: "com.blakeburford.sixdegrees"'));
  assert.ok(iss.includes('OutputBaseFilename=Sixgree-{#AppVersion}-win-x64-Setup'));
  assert.ok(iss.indexOf('[InstallDelete]') < iss.indexOf('Six Degrees.lnk'));
});

test('bridge 4: the npm package is sixgree, six-degrees still runs it, and its publish step cannot fail the release', () => {
  const pkg = JSON.parse(repoFile('package.json'));
  assert.equal(pkg.name, 'sixgree');
  assert.equal(pkg.bin.sixgree, 'bin/six-degrees.mjs');
  assert.equal(pkg.bin['six-degrees'], pkg.bin.sixgree);
  assert.ok(existsSync(new URL(`../${pkg.bin.sixgree}`, import.meta.url)));
  const yml = repoFile('.github/workflows/release.yml');
  const npmJob = yml.split('\n  npm:\n')[1];
  assert.match(npmJob, /^ {4}continue-on-error: true$/m);
  assert.match(npmJob, /TGZ=\$\(ls sixgree-\*\.tgz\)/);
});

test('bridge 5: the site is at sixgree.com', () => {
  assert.match(repoFile('scripts/build-site.mjs'), /export const SITE = 'https:\/\/sixgree\.com';/);
  assert.match(repoFile('site/robots.txt'), /Sitemap: https:\/\/sixgree\.com\/sitemap\.xml/);
  assert.match(repoFile('lib/galaxy-export.js'), /CREDIT = 'Sixgree · sixgree\.com'/);
});
