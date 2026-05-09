import { Buffer } from 'node:buffer';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as nodeSign,
  subtle,
  type KeyObject,
} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_DEV,
  CANONICAL_RELEASE,
  COMMUNITY_MIRRORS_URL,
  downloadTarball,
  downloadTarballWithKey,
  FALLBACK_MIRRORS,
  type DownloadInputs,
} from '../src/download.js';
import type { ParsedKey } from '../src/minisign.js';

type Signer = {
  pubkey: ParsedKey;
  signTarball: (filename: string, content: Buffer) => Buffer;
};

async function buildSigner(): Promise<Signer> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyRaw = publicKeyDer.subarray(publicKeyDer.length - 32);
  const keyId = randomBytes(8);
  const cryptoKey = await subtle.importKey('raw', publicKeyRaw, 'Ed25519', false, ['verify']);

  const sigAlgo = Buffer.from([0x45, 0x44]); // 'ED' (hashed Ed25519)

  const signTarball = (filename: string, content: Buffer): Buffer => {
    return makeSignature(content, filename, privateKey, keyId, sigAlgo);
  };

  return {
    pubkey: { id: keyId, key: cryptoKey },
    signTarball,
  };
}

function makeSignature(
  content: Buffer,
  filename: string,
  privateKey: KeyObject,
  keyId: Buffer,
  sigAlgo: Buffer,
): Buffer {
  const hash = createHash('BLAKE2b512').update(content).digest();
  const signatureRaw = nodeSign(null, hash, privateKey);
  const sigInfo = Buffer.concat([sigAlgo, keyId, signatureRaw]);
  const trustedComment = `timestamp:1700000000\tfile:${filename}\thashed`;
  const globalSignedContent = Buffer.concat([signatureRaw, Buffer.from(trustedComment)]);
  const globalSignatureRaw = nodeSign(null, globalSignedContent, privateKey);

  return Buffer.concat([
    Buffer.from('untrusted comment: signature from minisign\n'),
    Buffer.from(`${sigInfo.toString('base64')}\n`),
    Buffer.from(`trusted comment: ${trustedComment}\n`),
    Buffer.from(`${globalSignatureRaw.toString('base64')}\n`),
  ]);
}

function arrayBufferOf(buf: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

function bufferResponse(buf: Buffer): Response {
  return new Response(arrayBufferOf(buf), { status: 200 });
}

function textResponse(text: string): Response {
  return new Response(text, { status: 200 });
}

const TEST_MIRRORS: readonly string[] = [
  'https://mirror-a.test/zig',
  'https://mirror-b.test/zig',
  'https://mirror-c.test/zig',
];

const TARBALL_NAME = 'zig-x86_64-linux-0.16.0.tar.xz';
const TARBALL_CONTENT = Buffer.from('fake-tarball-bytes');

describe('downloadTarballWithKey', () => {
  let tmpDir: string;
  let signer: Signer;
  let validSig: Buffer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-zig-dl-'));
    signer = await buildSigner();
    validSig = signer.signTarball(TARBALL_NAME, TARBALL_CONTENT);
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('downloads from a community mirror when all mirrors respond OK (race winner)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) {
        return textResponse(TEST_MIRRORS.join('\n'));
      }
      if (url.endsWith(`${TARBALL_NAME}.minisig`) || url.includes(`${TARBALL_NAME}.minisig?`)) {
        return bufferResponse(validSig);
      }
      if (url.endsWith(TARBALL_NAME) || url.includes(`${TARBALL_NAME}?`)) {
        return bufferResponse(TARBALL_CONTENT);
      }
      return new Response('not found', { status: 404 });
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: 'github-test',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(TEST_MIRRORS).toContain(result.mirrorUsed);
    const written = await fs.readFile(result.tarballPath);
    expect(written.equals(TARBALL_CONTENT)).toBe(true);
  });

  it('continues the race when the first mirror dies', async () => {
    const deadMirror = TEST_MIRRORS[0];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      if (deadMirror !== undefined && url.startsWith(deadMirror)) {
        return new Response('boom', { status: 500 });
      }
      if (url.endsWith(`${TARBALL_NAME}.minisig`) || url.includes(`${TARBALL_NAME}.minisig?`)) {
        return bufferResponse(validSig);
      }
      if (url.endsWith(TARBALL_NAME) || url.includes(`${TARBALL_NAME}?`)) {
        return bufferResponse(TARBALL_CONTENT);
      }
      return new Response('not found', { status: 404 });
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(result.mirrorUsed).not.toBe(deadMirror);
    expect(TEST_MIRRORS).toContain(result.mirrorUsed);
  });

  it('falls back to ziglang.org last-resort when all community mirrors fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      const isFromTestMirror = TEST_MIRRORS.some((m) => url.startsWith(m));
      if (isFromTestMirror) return new Response('boom', { status: 500 });
      if (url.startsWith(`${CANONICAL_RELEASE}/0.16.0`)) {
        if (url.includes('.minisig')) return bufferResponse(validSig);
        return bufferResponse(TARBALL_CONTENT);
      }
      return new Response('not found', { status: 404 });
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(result.mirrorUsed).toBe(`${CANONICAL_RELEASE}/0.16.0`);
  });

  it('uses the dev URL for last-resort when version is a dev build', async () => {
    const devTarball = 'zig-x86_64-linux-0.17.0-dev.42+abcdef012.tar.xz';
    const devSig = signer.signTarball(devTarball, TARBALL_CONTENT);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      const isFromTestMirror = TEST_MIRRORS.some((m) => url.startsWith(m));
      if (isFromTestMirror) return new Response('boom', { status: 500 });
      if (url.startsWith(CANONICAL_DEV)) {
        if (url.includes('.minisig')) return bufferResponse(devSig);
        return bufferResponse(TARBALL_CONTENT);
      }
      return new Response('not found', { status: 404 });
    });

    const inputs: DownloadInputs = {
      version: '0.17.0-dev.42+abcdef012',
      tarballFilename: devTarball,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(result.mirrorUsed).toBe(CANONICAL_DEV);
  });

  it('rejects mirrors with a corrupted signature; race continues to a sound mirror', async () => {
    const badMirror = TEST_MIRRORS[0];
    const corruptedSig = Buffer.concat([validSig.subarray(0, validSig.length - 8), Buffer.alloc(8)]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      const fromBad = badMirror !== undefined && url.startsWith(badMirror);
      if (fromBad && (url.includes('.minisig') || url.endsWith('.minisig'))) {
        return bufferResponse(corruptedSig);
      }
      if (fromBad) return bufferResponse(TARBALL_CONTENT);
      if (url.includes('.minisig')) return bufferResponse(validSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(result.mirrorUsed).not.toBe(badMirror);
  });

  it('rejects ziglang.org as a mirror override (security guard)', async () => {
    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: 'https://ziglang.org/download',
      destDir: tmpDir,
    };
    await expect(downloadTarballWithKey(inputs, signer.pubkey)).rejects.toThrow(
      /cannot be used as mirror override/,
    );
  });

  it('uses the explicit mirror override when provided', async () => {
    const customMirror = 'https://my-private-mirror.example/zig';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (!url.startsWith(customMirror)) return new Response('not found', { status: 404 });
      if (url.includes('.minisig')) return bufferResponse(validSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: customMirror,
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(result.mirrorUsed).toBe(customMirror);
  });

  it('passes the source query string to the mirror request URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      if (url.includes('.minisig')) return bufferResponse(validSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: 'github-test-foobar',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    await downloadTarballWithKey(inputs, signer.pubkey);
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    const taggedCall = calls.find((u) => u.includes('source=github-test-foobar'));
    expect(taggedCall).toBeDefined();
  });

  it('exports the canonical 13-mirror fallback list verbatim from mlugg/setup-zig', () => {
    expect(FALLBACK_MIRRORS.length).toBe(13);
    expect(FALLBACK_MIRRORS[0]).toBe('https://pkg.machengine.org/zig');
  });

  it("rejects a mirror whose trusted comment names a different file", async () => {
    const wrongFilenameSig = signer.signTarball('zig-evil-payload-99.tar.xz', TARBALL_CONTENT);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      if (url.includes('.minisig')) return bufferResponse(wrongFilenameSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    await expect(downloadTarballWithKey(inputs, signer.pubkey)).rejects.toThrow(
      /All mirrors failed/,
    );
  });

  it('throws when both community mirrors and ziglang.org all fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      return new Response('boom', { status: 500 });
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    await expect(downloadTarballWithKey(inputs, signer.pubkey)).rejects.toThrow(
      /All mirrors failed and ziglang.org last-resort failed/,
    );
  });

  it('falls back to the hardcoded 13-mirror list when community-mirrors.txt is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) {
        return new Response('boom', { status: 500 });
      }
      const fromHardcoded = FALLBACK_MIRRORS.some((m) => url.startsWith(m));
      if (!fromHardcoded) return new Response('not found', { status: 404 });
      if (url.includes('.minisig')) return bufferResponse(validSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(FALLBACK_MIRRORS).toContain(result.mirrorUsed);
  });

  it('downloadTarball wraps downloadTarballWithKey with the real Zig public key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse(TEST_MIRRORS.join('\n'));
      if (url.includes('.minisig')) return bufferResponse(validSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    await expect(downloadTarball(inputs)).rejects.toThrow(/All mirrors failed/);
  });

  it('falls back to the hardcoded list when community-mirrors.txt is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlInput) => {
      const url = String(urlInput);
      if (url.startsWith(COMMUNITY_MIRRORS_URL)) return textResponse('');
      const fromHardcoded = FALLBACK_MIRRORS.some((m) => url.startsWith(m));
      if (!fromHardcoded) return new Response('not found', { status: 404 });
      if (url.includes('.minisig')) return bufferResponse(validSig);
      return bufferResponse(TARBALL_CONTENT);
    });

    const inputs: DownloadInputs = {
      version: '0.16.0',
      tarballFilename: TARBALL_NAME,
      source: '',
      mirrorOverride: '',
      destDir: tmpDir,
    };
    const result = await downloadTarballWithKey(inputs, signer.pubkey);
    expect(FALLBACK_MIRRORS).toContain(result.mirrorUsed);
  });
});
