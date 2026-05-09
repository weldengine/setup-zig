import { Buffer } from 'node:buffer';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseKey, parseSignature, verifySignature, type ParsedKey } from './minisign.ts';

export const ZIG_PUBLIC_KEY = 'RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U';

export const COMMUNITY_MIRRORS_URL = 'https://ziglang.org/download/community-mirrors.txt';
export const CANONICAL_RELEASE = 'https://ziglang.org/download';
export const CANONICAL_DEV = 'https://ziglang.org/builds';

export const FALLBACK_MIRRORS: readonly string[] = [
  'https://pkg.machengine.org/zig',
  'https://zigmirror.hryx.net/zig',
  'https://zig.linus.dev/zig',
  'https://zig.squirl.dev',
  'https://zig.florent.dev',
  'https://zig.mirror.mschae23.de/zig',
  'https://zigmirror.meox.dev',
  'https://ziglang.freetls.fastly.net',
  'https://zig.tilok.dev',
  'https://zig-mirror.tsimnet.eu/zig',
  'https://zig.karearl.com/zig',
  'https://pkg.earth/zig',
  'https://fs.liujiacai.net/zigbuilds',
];

export type DownloadInputs = {
  version: string;
  tarballFilename: string;
  source: string;
  mirrorOverride: string;
  destDir?: string;
};

export type DownloadResult = {
  tarballPath: string;
  mirrorUsed: string;
};

export async function downloadTarball(inputs: DownloadInputs): Promise<DownloadResult> {
  const pubkey = await parseKey(ZIG_PUBLIC_KEY);
  return downloadTarballWithKey(inputs, pubkey);
}

export async function downloadTarballWithKey(
  inputs: DownloadInputs,
  pubkey: ParsedKey,
): Promise<DownloadResult> {
  const destDir = inputs.destDir ?? os.tmpdir();
  const tarballPath = path.join(destDir, inputs.tarballFilename);

  const override = inputs.mirrorOverride.trim();
  if (override !== '') {
    if (override.includes('://ziglang.org/') || override.startsWith('ziglang.org/')) {
      throw new Error(
        "'https://ziglang.org' cannot be used as mirror override; use the default mirror list instead.",
      );
    }
    const data = await fetchFromMirror(
      override,
      inputs.tarballFilename,
      inputs.source,
      pubkey,
      new AbortController().signal,
    );
    await fs.writeFile(tarballPath, data);
    return { tarballPath, mirrorUsed: override };
  }

  const mirrors = await fetchMirrorList();
  const shuffled = shuffle(mirrors);

  try {
    const result = await raceMirrors(shuffled, inputs.tarballFilename, inputs.source, pubkey);
    await fs.writeFile(tarballPath, result.data);
    return { tarballPath, mirrorUsed: result.mirror };
  } catch (raceError) {
    const canonical = inputs.version.includes('-dev')
      ? CANONICAL_DEV
      : `${CANONICAL_RELEASE}/${inputs.version}`;
    try {
      const data = await fetchFromMirror(
        canonical,
        inputs.tarballFilename,
        inputs.source,
        pubkey,
        new AbortController().signal,
      );
      await fs.writeFile(tarballPath, data);
      return { tarballPath, mirrorUsed: canonical };
    } catch (canonicalError) {
      throw new Error(
        `All mirrors failed and ziglang.org last-resort failed: ` +
          `mirrors=${String(raceError)} canonical=${String(canonicalError)}`,
      );
    }
  }
}

export async function fetchMirrorList(): Promise<readonly string[]> {
  try {
    const resp = await fetch(COMMUNITY_MIRRORS_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status.toString()}`);
    const text = await resp.text();
    const list = text.split('\n').filter((line) => line.length !== 0);
    if (list.length === 0) throw new Error('empty mirror list');
    return list;
  } catch {
    return FALLBACK_MIRRORS;
  }
}

async function raceMirrors(
  mirrors: readonly string[],
  tarballFilename: string,
  source: string,
  pubkey: ParsedKey,
): Promise<{ data: Buffer; mirror: string }> {
  const controller = new AbortController();

  const attempts = mirrors.map(async (mirror) => {
    const data = await fetchFromMirror(mirror, tarballFilename, source, pubkey, controller.signal);
    return { data, mirror };
  });

  attempts.forEach((p) => {
    p.catch(() => {
      // Suppress unhandled rejections from losing-or-aborted attempts.
    });
  });

  try {
    const winner = await Promise.any(attempts);
    return winner;
  } finally {
    controller.abort();
  }
}

async function fetchFromMirror(
  mirror: string,
  tarballFilename: string,
  source: string,
  pubkey: ParsedKey,
  signal: AbortSignal,
): Promise<Buffer> {
  const sourceParam = source.length === 0 ? '' : `?source=${encodeURIComponent(source)}`;
  const tarballUrl = `${mirror}/${tarballFilename}${sourceParam}`;
  const sigUrl = `${mirror}/${tarballFilename}.minisig${sourceParam}`;

  const [tarballData, sigData] = await Promise.all([
    fetchBuffer(tarballUrl, signal),
    fetchBuffer(sigUrl, signal),
  ]);

  const sig = parseSignature(sigData);
  const ok = await verifySignature(pubkey, sig, tarballData);
  if (!ok) {
    throw new Error(`signature verification failed for ${tarballUrl}`);
  }

  const trusted = sig.trustedComment.toString();
  const match = /^timestamp:\d+\s+file:([^\s]+)\s+hashed$/.exec(trusted);
  if (match === null || match[1] !== tarballFilename) {
    throw new Error(`filename verification failed for ${tarballUrl}: trusted comment is '${trusted}'`);
  }

  return tarballData;
}

async function fetchBuffer(url: string, signal: AbortSignal): Promise<Buffer> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status.toString()} for ${url}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    const other = copy[j];
    if (tmp !== undefined && other !== undefined) {
      copy[i] = other;
      copy[j] = tmp;
    }
  }
  return copy;
}
