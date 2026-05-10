import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDirContents, dirSize, maybeGc, parseSizeLimit } from '../src/gc.js';

describe('parseSizeLimit', () => {
  it('parses binary unit suffixes', () => {
    expect(parseSizeLimit('2GiB')).toBe(2 * 1024 ** 3);
    expect(parseSizeLimit('500MiB')).toBe(500 * 1024 ** 2);
    expect(parseSizeLimit('1.5GiB')).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it('parses decimal unit suffixes', () => {
    expect(parseSizeLimit('1024MB')).toBe(1024 * 1000 ** 2);
    expect(parseSizeLimit('1GB')).toBe(1000 ** 3);
    expect(parseSizeLimit('1.5GB')).toBe(Math.round(1.5 * 1000 ** 3));
  });

  it('treats plain integer as bytes', () => {
    expect(parseSizeLimit('1024')).toBe(1024);
    expect(parseSizeLimit('0001')).toBe(1);
  });

  it('treats 0 / empty / undefined as disabled (null)', () => {
    expect(parseSizeLimit('0')).toBeNull();
    expect(parseSizeLimit('')).toBeNull();
    expect(parseSizeLimit('  ')).toBeNull();
    expect(parseSizeLimit(undefined)).toBeNull();
  });

  it('throws on invalid formats', () => {
    expect(() => parseSizeLimit('2gigabytes')).toThrow(/Invalid cache-size-limit format/);
    expect(() => parseSizeLimit('foo')).toThrow(/Invalid cache-size-limit format/);
    expect(() => parseSizeLimit('1.5')).toThrow(/Invalid cache-size-limit format/);
    expect(() => parseSizeLimit('-100')).toThrow(/Invalid cache-size-limit format/);
  });

  it('accepts case variations of unit suffix', () => {
    expect(parseSizeLimit('2gib')).toBe(2 * 1024 ** 3);
    expect(parseSizeLimit('500mib')).toBe(500 * 1024 ** 2);
  });

  it('parses every supported unit', () => {
    expect(parseSizeLimit('1B')).toBe(1);
    expect(parseSizeLimit('1KB')).toBe(1000);
    expect(parseSizeLimit('1KiB')).toBe(1024);
    expect(parseSizeLimit('1MB')).toBe(1000 ** 2);
    expect(parseSizeLimit('1MiB')).toBe(1024 ** 2);
    expect(parseSizeLimit('1GB')).toBe(1000 ** 3);
    expect(parseSizeLimit('1GiB')).toBe(1024 ** 3);
    expect(parseSizeLimit('1TB')).toBe(1000 ** 4);
    expect(parseSizeLimit('1TiB')).toBe(1024 ** 4);
  });
});

describe('dirSize / clearDirContents / maybeGc', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-zig-gc-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns 0 for nonexistent directories without crashing', async () => {
    const ghost = path.join(root, 'never-existed');
    expect(await dirSize(ghost)).toBe(0);
  });

  it('returns 0 for an empty directory', async () => {
    expect(await dirSize(root)).toBe(0);
  });

  it('sums file sizes recursively', async () => {
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(100));
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', 'b.bin'), Buffer.alloc(250));
    expect(await dirSize(root)).toBe(350);
  });

  it('clearDirContents removes everything inside but keeps the directory', async () => {
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(50));
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', 'b.bin'), Buffer.alloc(50));

    await clearDirContents(root);

    expect(await fs.readdir(root)).toEqual([]);
    const stat = await fs.stat(root);
    expect(stat.isDirectory()).toBe(true);
  });

  it('clearDirContents on nonexistent directory is a no-op', async () => {
    const ghost = path.join(root, 'never-existed');
    await expect(clearDirContents(ghost)).resolves.toBeUndefined();
  });

  it('maybeGc skips work when limit is null (disabled)', async () => {
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(1000));
    const result = await maybeGc(root, null);
    expect(result).toEqual({ purged: false, size: 0, limit: null });
    expect(await fs.readdir(root)).toEqual(['a.bin']);
  });

  it('maybeGc keeps contents when size is under the limit', async () => {
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(100));
    const result = await maybeGc(root, 1000);
    expect(result.purged).toBe(false);
    expect(result.size).toBe(100);
    expect(await fs.readdir(root)).toEqual(['a.bin']);
  });

  it('maybeGc purges contents when size exceeds the limit', async () => {
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(2000));
    const result = await maybeGc(root, 1000);
    expect(result.purged).toBe(true);
    expect(result.size).toBe(2000);
    expect(await fs.readdir(root)).toEqual([]);
  });
});
