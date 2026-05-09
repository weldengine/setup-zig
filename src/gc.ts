import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)$/i;

function getMultiplier(unit: string): number {
  switch (unit.toUpperCase()) {
    case 'B':
      return 1;
    case 'KB':
      return 1000;
    case 'KIB':
      return 1024;
    case 'MB':
      return 1000 ** 2;
    case 'MIB':
      return 1024 ** 2;
    case 'GB':
      return 1000 ** 3;
    case 'GIB':
      return 1024 ** 3;
    case 'TB':
      return 1000 ** 4;
    case 'TIB':
      return 1024 ** 4;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

export function parseSizeLimit(input: string | undefined): number | null {
  if (input === undefined) return null;
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '0') return null;

  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const match = SIZE_RE.exec(trimmed);
  if (match === null) {
    throw new Error(
      `Invalid cache-size-limit format: '${input}'. ` +
        `Expected a positive integer (bytes) or a value with a unit suffix ` +
        `(e.g. '2GiB', '500MiB', '1024MB', '1.5GB'). Use '0' or empty string to disable.`,
    );
  }

  const valueStr = match[1];
  const unit = match[2];
  if (valueStr === undefined || unit === undefined) {
    throw new Error(`Invalid cache-size-limit format: '${input}'`);
  }
  const value = parseFloat(valueStr);
  return Math.round(value * getMultiplier(unit));
}

export async function dirSize(dirPath: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const p = path.join(ent.parentPath, ent.name);
    try {
      const stat = await fs.stat(p);
      total += stat.size;
    } catch {
      // File disappeared between readdir and stat — skip
    }
  }
  return total;
}

export async function clearDirContents(dirPath: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return;
  }
  await Promise.all(
    entries.map((e) => fs.rm(path.join(dirPath, e), { recursive: true, force: true })),
  );
}

export type GcResult = {
  purged: boolean;
  size: number;
  limit: number | null;
};

export async function maybeGc(dirPath: string, sizeLimit: number | null): Promise<GcResult> {
  if (sizeLimit === null) {
    return { purged: false, size: 0, limit: null };
  }
  const size = await dirSize(dirPath);
  if (size > sizeLimit) {
    await clearDirContents(dirPath);
    return { purged: true, size, limit: sizeLimit };
  }
  return { purged: false, size, limit: sizeLimit };
}
