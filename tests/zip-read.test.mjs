// lib/zip-read.js: the zip reader plugin packages are opened with. A package
// comes from outside, so each case here is a crafted archive of a kind that has
// been used against unzip tools: names that climb out of their folder, the same
// file twice, zip64, encryption, links, a bomb, a lying size, a damaged
// checksum, two entries sharing bytes. Each must be refused, with a reason in
// words, and nothing like it ever reaches the disk. Archives are made with
// lib/zip-write.js and then broken by hand where the writer wouldn't.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip, zipPathProblem, ZipError, ZIP_LIMITS } from '../lib/zip-read.js';
import { writeZip } from '../lib/zip-write.js';

const refused = (buf, pattern, limits) => assert.throws(() => readZip(buf, limits), (err) => {
  assert.ok(err instanceof ZipError, `a ZipError, not ${err?.constructor?.name}: ${err?.message}`);
  assert.match(err.message, pattern);
  return true;
});

/** Where the end record and the list of files are, in an archive with no comment. */
function layout(zip) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const cd = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let at = cd; at < end;) {
    entries.push(at);
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return { end, cd, entries };
}

test('a plain archive reads back: stored and deflated files, a folder, UTF-8 names, an empty file', () => {
  const zip = writeZip([
    { name: 'scanner', dir: true },
    { name: 'scanner/scan.py', data: 'print("hello")\n'.repeat(50) },
    { name: 'scanner/notes.txt', data: 'stored as is', method: 'store' },
    { name: 'scanner/café.txt', data: 'é' },
    { name: 'empty.txt', data: '' },
  ]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.dir]), [
    ['scanner', true], ['scanner/scan.py', false], ['scanner/notes.txt', false], ['scanner/café.txt', false], ['empty.txt', false],
  ]);
  assert.equal(entries[1].data.toString(), 'print("hello")\n'.repeat(50));
  assert.equal(entries[2].data.toString(), 'stored as is');
  assert.equal(entries[3].data.toString(), 'é');
  assert.equal(entries[4].data.length, 0);
});

test('the writer makes the same archive from the same files, byte for byte', () => {
  const files = [{ name: 'a.txt', data: 'one' }, { name: 'b/c.txt', data: 'two' }];
  assert.ok(writeZip(files).equals(writeZip(files)));
});

test('an archive with a comment after its end record still reads', () => {
  const zip = writeZip([{ name: 'a.txt', data: 'x' }]);
  const comment = Buffer.from('made by hand');
  const withComment = Buffer.concat([zip, comment]);
  withComment.writeUInt16LE(comment.length, zip.length - 2);
  assert.equal(readZip(withComment)[0].data.toString(), 'x');
});

test('names that would write outside the folder are refused, whatever the shape', () => {
  for (const [name, pattern] of [
    ['../evil.py', /climbs out of its folder/],
    ['scanner/../../evil.py', /climbs out of its folder/],
    ['/etc/evil', /starts at the top of the disk/],
    ['scanner\\evil.py', /backslash/],
    ['C:/evil.py', /colon/],
    ['scanner//evil.py', /empty or "\." part/],
    ['./evil.py', /empty or "\." part/],
    ['scanner/\u0007bell.py', /control character/],
  ]) {
    refused(writeZip([{ name, data: 'x' }]), pattern);
  }
  // A folder entry is held to the same rule.
  refused(writeZip([{ name: '../up', dir: true }]), /climbs out/);
});

test('zipPathProblem: the one rule for names, shared with the manifest', () => {
  assert.equal(zipPathProblem('scanner/scrape.py'), null);
  assert.equal(zipPathProblem('a-b_c.d/e f.txt'), null);
  assert.match(zipPathProblem(''), /empty/);
  assert.match(zipPathProblem('x'.repeat(ZIP_LIMITS.maxNameLength + 1)), /longer than/);
  assert.match(zipPathProblem('a/..'), /climbs out/);
  assert.match(zipPathProblem(42), /empty/);
});

test('the same name twice is refused, and so are two names a disk would treat as one', () => {
  refused(writeZip([{ name: 'a.py', data: '1' }, { name: 'a.py', data: '2' }]), /a\.py twice/);
  refused(writeZip([{ name: 'Scan.py', data: '1' }, { name: 'scan.py', data: '2' }]), /twice/);
  // é written two ways (one character, or e and an accent): one file on many disks.
  refused(writeZip([{ name: 'caf\u00e9.py', data: '1' }, { name: 'cafe\u0301.py', data: '2' }]), /twice/);
  refused(writeZip([{ name: 'scanner', dir: true }, { name: 'scanner', dir: true }]), /twice/);
});

test('a name used as a file and as a folder is refused', () => {
  refused(writeZip([{ name: 'scanner', data: 'a file' }, { name: 'scanner/scrape.py', data: 'x' }]), /scanner as a file and as a folder/);
  refused(writeZip([{ name: 'Scanner', data: 'a file' }, { name: 'scanner/scrape.py', data: 'x' }]), /as a file and as a folder/);
});

test('zip64, in any of its three signs, is refused', () => {
  const zip = writeZip([{ name: 'a.txt', data: 'x' }]);
  const { end } = layout(zip);
  // 0xFFFF entries in the end record: "look in the zip64 record instead".
  const many = Buffer.from(zip);
  many.writeUInt16LE(0xffff, end + 8);
  many.writeUInt16LE(0xffff, end + 10);
  refused(many, /zip64/);
  // A zip64 locator just before the end record.
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  refused(Buffer.concat([zip.subarray(0, end), locator, zip.subarray(end)]), /zip64/);
  // A zip64 extra field on an entry.
  const extra = Buffer.alloc(4);
  extra.writeUInt16LE(0x0001, 0);
  refused(writeZip([{ name: 'a.txt', data: 'x', raw: { extra } }]), /zip64/);
});

test('encrypted entries, links and special files are refused', () => {
  refused(writeZip([{ name: 'secret.py', data: 'x', raw: { flags: 0x0801 } }]), /secret\.py is encrypted/);
  refused(writeZip([{ name: 'link', data: '/etc/passwd', method: 'store', raw: { externalAttr: (0o120777 << 16) >>> 0 } }]), /link is a symbolic link/);
  refused(writeZip([{ name: 'fifo', data: '', raw: { externalAttr: (0o010644 << 16) >>> 0 } }]), /isn’t a plain file or folder/);
  refused(writeZip([{ name: 'odd', data: 'x', raw: { externalAttr: (0o040755 << 16) >>> 0 } }]), /folder and a file at once/);
  // A folder with something packed in it.
  refused(writeZip([{ name: 'dir', dir: true, raw: { size: 5 } }]), /folder with something packed/);
  // An archive from a system without Unix modes is read by its names.
  assert.equal(readZip(writeZip([{ name: 'dos.txt', data: 'ok', raw: { madeBy: 20, externalAttr: 0 } }]))[0].data.toString(), 'ok');
});

test('only stored and deflate are read', () => {
  refused(writeZip([{ name: 'a.bz2', data: 'x', method: 'store', raw: { method: 12 } }]), /method 12/);
});

test('names that aren’t UTF-8 text are refused', () => {
  refused(writeZip([{ name: 'x', data: 'x', raw: { nameBytes: Buffer.from([0x61, 0xe9]), flags: 0 } }]), /isn’t marked as UTF-8/);
  refused(writeZip([{ name: 'x', data: 'x', raw: { nameBytes: Buffer.from([0x61, 0xff]) } }]), /isn’t readable text/);
});

test('a bomb is refused: an entry that expands too far, or an archive that unpacks too large', () => {
  // 2 MB of zeros packs to about 2 KB: a thousand to one.
  refused(writeZip([{ name: 'zeros.bin', data: Buffer.alloc(2 * 1024 * 1024) }]), /expands more than 100 times/);
  // A size past the cap is refused before anything is unpacked.
  refused(writeZip([{ name: 'big.bin', data: 'x', raw: { size: ZIP_LIMITS.maxTotalBytes + 1 } }]), /unpacks to more than 32 MB/);
  // The total, across entries, counts too.
  const half = Buffer.alloc(600, 7);
  refused(writeZip([{ name: 'a', data: half, method: 'store' }, { name: 'b', data: half, method: 'store' }]), /unpacks to more than/, { maxTotalBytes: 1000 });
  // Too many entries.
  refused(writeZip(['a', 'b', 'c', 'd'].map((name) => ({ name, data: name }))), /holds 4 entries/, { maxEntries: 3 });
  // A small file of one repeated character packs very well and is fine: it can't fill anything.
  assert.equal(readZip(writeZip([{ name: 'spaces.py', data: ' '.repeat(4000) }]))[0].data.length, 4000);
});

test('a lying size or a damaged checksum is refused', () => {
  // Says 10 bytes, holds 5000: unpacking stops at 10 and the entry is refused.
  const words = Buffer.from(Array.from({ length: 5000 }, (_, i) => 97 + ((i * 7919) % 26)));
  refused(writeZip([{ name: 'liar.txt', data: words, raw: { size: 10 } }]), /larger than it says|isn’t the size/);
  refused(writeZip([{ name: 'short.txt', data: 'hello', method: 'store', raw: { size: 3 } }]), /two sizes differ/);
  refused(writeZip([{ name: 'bad.txt', data: 'hello', raw: { crc: 12345 } }]), /doesn’t match its checksum/);
});

test('what isn’t a zip, or is one cut short, is refused', () => {
  refused(Buffer.from('short'), /too short/);
  refused(Buffer.from('this is plain text, long enough to be looked at, and not a zip'), /isn’t a zip file/);
  const zip = writeZip([{ name: 'a.txt', data: 'x' }]);
  refused(zip.subarray(0, zip.length - 5), /isn’t a zip file, or it was cut short/);
  // Bytes put in front shift everything from where the end record says.
  refused(Buffer.concat([Buffer.from('junk in front'), zip]), /isn’t where the zip says/);
  assert.throws(() => readZip('not a buffer'), ZipError);
});

test('an entry whose own header names another file is refused', () => {
  const zip = Buffer.from(writeZip([{ name: 'a.txt', data: 'x', method: 'store' }]));
  zip[30] = 'b'.charCodeAt(0);   // the local header's copy of the name
  refused(zip, /a\.txt has a different name in its own header/);
});

test('two entries that share bytes are refused (how the smallest bombs are built)', () => {
  // b's whole local entry, kept as the data of a; then b's listing points into a.
  const inner = writeZip([{ name: 'b', data: 'hello', method: 'store' }]);
  const bLocal = inner.subarray(0, 30 + 1 + 5);
  const zip = Buffer.from(writeZip([{ name: 'a', data: bLocal, method: 'store' }, { name: 'b', data: 'hello', method: 'store' }]));
  const { entries } = layout(zip);
  zip.writeUInt32LE(30 + 1, entries[1] + 42);   // b now starts inside a's data
  refused(zip, /shares its bytes with another entry/);
});

test('a list of files that runs past where it should is refused', () => {
  const zip = Buffer.from(writeZip([{ name: 'a.txt', data: 'x' }, { name: 'b.txt', data: 'y' }]));
  const { end } = layout(zip);
  zip.writeUInt16LE(3, end + 8);
  zip.writeUInt16LE(3, end + 10);
  refused(zip, /damaged/);
});
