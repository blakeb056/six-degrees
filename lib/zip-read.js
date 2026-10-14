// A zip reader for plugin packages (lib/plugins.js), in Node's own zlib.
//
// A plugin package comes from outside, so its zip is read as hostile: every
// rule below is a way a zip has been used to write outside the folder it is
// unpacked into, or to fill a disk from a few kilobytes. Anything this reader
// doesn't fully understand is refused, never guessed at:
//
//   - stored and deflate entries only; no encryption, no zip64, no symlinks or
//     other special files, no archive split over several disks;
//   - names are plain relative paths: no "/" at the start, no "..", no ".",
//     no empty part, no backslash, no ":" (a drive letter, or a second stream
//     of a file on some disks), no control characters;
//   - no name twice, ignoring case and Unicode normalization, since many disks
//     treat "Scan.py" and "scan.py" as one file; and no name used as both a
//     file and a folder;
//   - caps on the number of entries, on the total unpacked size, and on how far
//     one entry may expand (a "zip bomb" is a tiny entry that expands to
//     gigabytes); each entry is inflated no further than the size it declares,
//     and its checksum (CRC-32) must match;
//   - the central directory, which lists the entries, must be where the end
//     record says and end where the end record starts, and no two entries may
//     share bytes.
//
// It reads a whole archive held in memory: packages are small (MAX_PLUGIN_BYTES).

import { inflateRawSync, crc32 } from 'node:zlib';

/** Something about the archive that can't be accepted; its message is plain and shown as is. */
export class ZipError extends Error {}

export const ZIP_LIMITS = Object.freeze({
  // Entries, folders included. A plugin is a handful of files.
  maxEntries: 256,
  // Everything unpacked, in bytes.
  maxTotalBytes: 32 * 1024 * 1024,
  // How many times larger than its packed size an entry may be. Source code
  // packs about 4 to 1; a bomb, a thousand to one or more. Only entries above
  // ratioFloor are held to it: a small file of repeated characters packs very
  // well and can't fill anything.
  maxRatio: 100,
  ratioFloor: 64 * 1024,
  // A name, in characters.
  maxNameLength: 240,
});

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const END_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;

const STORED = 0;
const DEFLATED = 8;

// General purpose flags: 0 encrypted, 6 strong encryption, 13 central
// directory encrypted. 11 says the name is UTF-8.
const FLAG_ENCRYPTED = 0x0001 | 0x0040 | 0x2000;
const FLAG_UTF8 = 0x0800;

// "Version made by" hosts whose external attributes carry a Unix mode.
const UNIX_HOSTS = new Set([3, 19]);
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Why `name` can't be a path inside a package, or null when it can. The same
 * rule for a zip's names and for the paths a manifest lists (lib/plugins.js).
 * A folder's name in a zip ends in "/"; pass it without.
 */
export function zipPathProblem(name, { maxLength = ZIP_LIMITS.maxNameLength } = {}) {
  if (typeof name !== 'string' || !name) return 'an empty name';
  if (name.length > maxLength) return `a name longer than ${maxLength} characters`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'a name with a control character in it';
  if (name.includes('\\')) return `a name with a backslash in it (${name})`;
  if (name.includes(':')) return `a name with a colon in it (${name})`;
  if (name.startsWith('/')) return `a name that starts at the top of the disk (${name})`;
  for (const part of name.split('/')) {
    if (part === '..') return `a name that climbs out of its folder (${name})`;
    if (part === '' || part === '.') return `a name with an empty or "." part (${name})`;
  }
  return null;
}

/** The key two names collide on: case and Unicode normalization ignored, as many disks do. */
export function collisionKey(name) {
  return name.normalize('NFC').toLowerCase();
}

/** The end record: at the very end of the file, after its comment (if any). */
function findEnd(buf) {
  const lowest = Math.max(0, buf.length - END_SIZE - 0xffff);
  for (let at = buf.length - END_SIZE; at >= lowest; at--) {
    if (buf.readUInt32LE(at) !== SIG_END) continue;
    if (at + END_SIZE + buf.readUInt16LE(at + 20) === buf.length) return at;
  }
  return -1;
}

/**
 * Read a zip held in `buf`.
 * @returns {Array<{ name: string, dir: boolean, data?: Buffer }>} every entry in
 *          the central directory's order. A folder's name has no trailing "/"
 *          and no data.
 * @throws ZipError with a plain reason, for anything the rules above refuse.
 */
export function readZip(buf, limits = {}) {
  const { maxEntries, maxTotalBytes, maxRatio, ratioFloor, maxNameLength } = { ...ZIP_LIMITS, ...limits };
  if (!Buffer.isBuffer(buf)) throw new ZipError('There is no file to read.');
  if (buf.length < END_SIZE) throw new ZipError('It is too short to be a zip file.');

  const end = findEnd(buf);
  if (end < 0) throw new ZipError('It isn’t a zip file, or it was cut short.');
  // A zip64 archive puts a locator just before the end record.
  if (end >= 20 && buf.readUInt32LE(end - 20) === SIG_ZIP64_LOCATOR) {
    throw new ZipError('It is a zip64 archive, which plugin packages never need.');
  }
  const disk = buf.readUInt16LE(end + 4);
  const cdDisk = buf.readUInt16LE(end + 6);
  const onDisk = buf.readUInt16LE(end + 8);
  const total = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdStart = buf.readUInt32LE(end + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) {
    throw new ZipError('It is a zip64 archive, which plugin packages never need.');
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new ZipError('It is split over several files.');
  if (total > maxEntries) throw new ZipError(`It holds ${total} entries; a plugin package can hold up to ${maxEntries}.`);
  // The directory ends exactly where the end record starts: nothing hidden between.
  if (cdStart + cdSize !== end) throw new ZipError('Its list of files isn’t where the zip says it is.');

  const entries = [];
  const keys = new Map();
  let at = cdStart;
  let totalBytes = 0;
  for (let i = 0; i < total; i++) {
    if (at + CENTRAL_SIZE > end || buf.readUInt32LE(at) !== SIG_CENTRAL) {
      throw new ZipError('Its list of files is damaged.');
    }
    const madeBy = buf.readUInt16LE(at + 4);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const packed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const startDisk = buf.readUInt16LE(at + 34);
    const external = buf.readUInt32LE(at + 38);
    const local = buf.readUInt32LE(at + 42);
    const next = at + CENTRAL_SIZE + nameLength + extraLength + commentLength;
    if (next > end) throw new ZipError('Its list of files is damaged.');
    const nameBytes = buf.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength);
    const extra = buf.subarray(at + CENTRAL_SIZE + nameLength, at + CENTRAL_SIZE + nameLength + extraLength);
    at = next;

    // The name first, so every other refusal can say which entry.
    if (!(flags & FLAG_UTF8) && nameBytes.some((b) => b >= 0x80)) {
      throw new ZipError('It has a name that isn’t marked as UTF-8 text.');
    }
    let raw;
    try { raw = utf8.decode(nameBytes); } catch { throw new ZipError('It has a name that isn’t readable text.'); }
    const dir = raw.endsWith('/');
    const name = dir ? raw.slice(0, -1) : raw;
    const problem = zipPathProblem(name, { maxLength: maxNameLength });
    if (problem) throw new ZipError(`It has ${problem}.`);

    if (flags & FLAG_ENCRYPTED) throw new ZipError(`${name} is encrypted.`);
    if (startDisk !== 0) throw new ZipError('It is split over several files.');
    if (packed === 0xffffffff || size === 0xffffffff || local === 0xffffffff || hasZip64Extra(extra)) {
      throw new ZipError('It is a zip64 archive, which plugin packages never need.');
    }
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(`${name} is packed a way Sixgree doesn’t read (method ${method}); only stored and deflate are.`);
    }
    // What kind of entry: a Unix mode says outright; otherwise the name's "/" does.
    if (UNIX_HOSTS.has(madeBy >> 8)) {
      const type = (external >>> 16) & S_IFMT;
      if (type === S_IFLNK) throw new ZipError(`${name} is a symbolic link, which a plugin package may not hold.`);
      if (type !== 0 && type !== S_IFREG && type !== S_IFDIR) throw new ZipError(`${name} isn’t a plain file or folder.`);
      if ((type === S_IFDIR) !== dir && type !== 0) throw new ZipError(`${name} is marked as a folder and a file at once.`);
    }
    if (dir && (size !== 0 || packed > 2)) throw new ZipError(`${name} is a folder with something packed inside it.`);

    // The same name twice, or two that a disk would treat as one.
    const key = collisionKey(name);
    if (keys.has(key)) throw new ZipError(`It has ${name} twice.`);
    keys.set(key, dir);

    if (!dir) {
      totalBytes += size;
      if (totalBytes > maxTotalBytes) {
        throw new ZipError(`It unpacks to more than ${Math.round(maxTotalBytes / 1048576)} MB, more than a plugin package may.`);
      }
      if (size > ratioFloor && size > maxRatio * Math.max(packed, 1)) {
        throw new ZipError(`${name} expands more than ${maxRatio} times its packed size, which a real file doesn't.`);
      }
    }
    entries.push({ name, dir, flags, method, crc, packed, size, local, nameBytes });
  }
  if (at !== end) throw new ZipError('Its list of files is damaged.');

  // A name used as a file and as a folder (a file "a" and a file "a/b").
  for (const { name } of entries) {
    const parts = name.split('/');
    for (let n = 1; n < parts.length; n++) {
      if (keys.get(collisionKey(parts.slice(0, n).join('/'))) === false) {
        throw new ZipError(`It has ${parts.slice(0, n).join('/')} as a file and as a folder.`);
      }
    }
  }

  // Each entry's own header and bytes, in order on the disk: inside the part
  // before the list of files, and sharing no byte with another entry.
  const spans = entries.map((e) => ({ e, ...localSpan(buf, e, cdStart) })).sort((a, b) => a.from - b.from);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].from < spans[i - 1].to) throw new ZipError(`${spans[i].e.name} shares its bytes with another entry.`);
  }

  return entries.map((e) => {
    if (e.dir) return { name: e.name, dir: true };
    const span = spans.find((s) => s.e === e);
    return { name: e.name, dir: false, data: unpack(buf.subarray(span.dataFrom, span.to), e) };
  });
}

/** Does an extra field carry a zip64 record (header id 1)? */
function hasZip64Extra(extra) {
  for (let at = 0; at + 4 <= extra.length;) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 0x0001) return true;
    at += 4 + length;
  }
  return false;
}

/** Where an entry's local header starts, where its bytes start, and where they end. */
function localSpan(buf, e, cdStart) {
  const from = e.local;
  if (from + LOCAL_SIZE > cdStart || buf.readUInt32LE(from) !== SIG_LOCAL) {
    throw new ZipError(`${e.name} isn’t where the list of files says it is.`);
  }
  const flags = buf.readUInt16LE(from + 6);
  const method = buf.readUInt16LE(from + 8);
  const nameLength = buf.readUInt16LE(from + 26);
  const extraLength = buf.readUInt16LE(from + 28);
  if (flags & FLAG_ENCRYPTED) throw new ZipError(`${e.name} is encrypted.`);
  if (method !== e.method) throw new ZipError(`${e.name} says two different things about how it is packed.`);
  // The local header names the same file as the list: a reader that trusts one
  // and a reader that trusts the other must never see two different packages.
  if (!buf.subarray(from + LOCAL_SIZE, from + LOCAL_SIZE + nameLength).equals(e.nameBytes)) {
    throw new ZipError(`${e.name} has a different name in its own header.`);
  }
  const dataFrom = from + LOCAL_SIZE + nameLength + extraLength;
  const to = dataFrom + e.packed;
  if (to > cdStart) throw new ZipError(`${e.name} runs past the end of the packed files.`);
  return { from, dataFrom, to };
}

/** An entry's bytes, unpacked no further than its declared size, checksum checked. */
function unpack(packed, e) {
  let data;
  if (e.method === STORED) {
    if (e.packed !== e.size) throw new ZipError(`${e.name} is stored, but its two sizes differ.`);
    data = packed;
  } else {
    try {
      // maxOutputLength stops a lying size at the size it declared, before memory does.
      data = inflateRawSync(packed, { maxOutputLength: Math.max(e.size, 1) });
    } catch {
      throw new ZipError(`${e.name} can’t be unpacked: it is damaged, or larger than it says.`);
    }
  }
  if (data.length !== e.size) throw new ZipError(`${e.name} isn’t the size it says it is.`);
  if (crc32(data) >>> 0 !== e.crc >>> 0) throw new ZipError(`${e.name} doesn’t match its checksum, so it was damaged on the way.`);
  return Buffer.from(data);
}
