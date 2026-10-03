// Where the Social tab keeps what it knows, per profile, in the data folder:
//
//   social-<profile>.json           numbers and dates (app/api/social): who you
//                                   messaged, when, who wrote last, the list of
//                                   conversations. Never any words.
//   social-messages-<profile>.json  the messages themselves, only while Keep my
//                                   messages is on (app/api/social/messages),
//                                   and the notes sent with requests, likewise.
//   crm-<profile>.json              your own CRM: each person's stage, tags,
//                                   notes and next follow-up (app/api/social/crm,
//                                   lib/social-crm.js). Always kept: you wrote
//                                   it. Forget it offers to delete it, asking
//                                   separately, so notes aren't lost by accident.
//
// Two files so that turning Keep my messages off, or Forget it, deletes the
// words by deleting one file, and so the everyday file the Galaxy and the
// Social tab read stays small however many messages there are. "Export backup file…" carries
// them when its Social box is ticked (lib/data-folder.js SOCIAL_FILE); the backups Six Degrees
// makes by itself never do, so deleting them here deletes them everywhere (lib/backups.js).

import { readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './db-client';
import { resolveProfile } from './profile';

// The last messages file read, while it's unchanged (readMessages).
const cache = { file: null, mtimeMs: 0, size: 0, data: null };

/** The Social tab's files for the profile in use, or null before there is one. */
export function socialFiles() {
  const me = resolveProfile({ create: false });
  if (!me?.id || !/^[\w-]+$/.test(String(me.id))) return null;
  const dir = dataDir();
  const messages = path.join(dir, `social-messages-${me.id}.json`);
  return {
    profileId: me.id,
    social: path.join(dir, `social-${me.id}.json`),
    messages,
    crm: path.join(dir, `crm-${me.id}.json`),
    // An import's messages arrive in parts (each request stays under the 10 MB
    // middleware reads); they gather here and replace `messages` at the end.
    incoming: `${messages}.incoming`,
  };
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) ?? fallback; } catch { return fallback; }
}

/** Written whole or not at all: a crash mid-write never leaves half a file. */
export function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
  if (cache.file === file) cache.file = null;
}

/** The kept messages, their live-sync previews and the requests' notes, or empty ones. */
export function readMessages(file) {
  // Kept in memory while the file is unchanged: a long history is read once,
  // not on every page of a thread or every letter typed in the search box.
  let st;
  try { st = statSync(file); } catch { return { threads: {}, previews: {}, invites: {} }; }
  if (cache.file === file && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.data;
  const raw = readJson(file, {});
  const data = {
    threads: raw?.threads && typeof raw.threads === 'object' ? raw.threads : {},
    previews: raw?.previews && typeof raw.previews === 'object' ? raw.previews : {},
    invites: raw?.invites && typeof raw.invites === 'object' ? raw.invites : {},
  };
  Object.assign(cache, { file, mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
}

/** The messages gone: the kept file and any import still arriving. */
export function deleteMessages(files) {
  if (!files) return;
  rmSync(files.messages, { force: true });
  rmSync(files.incoming, { force: true });
  cache.file = null;
}
