// A small zip writer, in Node's own zlib: what scripts/build-plugin.mjs packs
// plugin packages with, and what the tests make archives with, good ones and
// deliberately broken ones (tests/zip-read.test.mjs).
//
// It writes the plainest zip there is, the kind lib/zip-read.js accepts: no
// zip64, no encryption, names in UTF-8, Unix modes, and a fixed date on every
// entry so the same files always make the same package, byte for byte.
//
// The `raw` fields on an entry are for tests that need a zip this writer would
// never make on its own (an encrypted flag, a symbolic link's mode, a lying
// size); a package never sets them.

import { deflateRawSync, crc32 } from 'node:zlib';

// 1 January 2026, 00:00, in the zip's own date format (MS-DOS time).
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UNIX = 3;
const FLAG_UTF8 = 0x0800;

/**
 * @param {Array<{ name: string, data?: Buffer|string, dir?: boolean, method?: 'deflate'|'store',
 *                 raw?: { flags?: number, externalAttr?: number, madeBy?: number, extra?: Buffer,
 *                         size?: number, crc?: number, nameBytes?: Buffer, method?: number } }>} entries
 * @returns {Buffer} the archive
 */
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = entry.raw || {};
    const dir = Boolean(entry.dir);
    const name = dir && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name;
    const nameBytes = raw.nameBytes || Buffer.from(name, 'utf8');
    const data = dir ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const deflate = !dir && (entry.method || 'deflate') === 'deflate';
    const packed = deflate ? deflateRawSync(data, { level: 9 }) : data;
    const method = raw.method ?? (deflate ? 8 : 0);
    const flags = raw.flags ?? FLAG_UTF8;
    const crc = raw.crc ?? (crc32(data) >>> 0);
    const size = raw.size ?? data.length;
    const extra = raw.extra || Buffer.alloc(0);
    const mode = dir ? 0o040755 : 0o100644;
    const externalAttr = raw.externalAttr ?? (((mode << 16) >>> 0) | (dir ? 0x10 : 0)) >>> 0;
    const madeBy = raw.madeBy ?? ((UNIX << 8) | 20);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extra.length, 28);
    locals.push(local, nameBytes, extra, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(madeBy, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttr, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes, extra);

    offset += local.length + nameBytes.length + extra.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
