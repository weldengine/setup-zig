import { Buffer } from 'node:buffer';
import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseKey, parseSignature, verifySignature } from '../src/minisign.ts';

type TestVector = {
  publicKeyB64: string;
  signatureFile: Buffer;
  payload: Buffer;
  trustedComment: string;
};

function buildTestVector(payload: Buffer, trustedComment: string): TestVector {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyRaw = publicKeyDer.subarray(publicKeyDer.length - 32);

  const keyAlgo = Buffer.from([0x45, 0x64]);
  const keyId = randomBytes(8);
  const publicKeyBlob = Buffer.concat([keyAlgo, keyId, publicKeyRaw]);
  const publicKeyB64 = publicKeyBlob.toString('base64');

  const sigAlgo = Buffer.from([0x45, 0x44]);
  const hash = createHash('BLAKE2b512').update(payload).digest();
  const signatureRaw = nodeSign(null, hash, privateKey);

  const sigInfo = Buffer.concat([sigAlgo, keyId, signatureRaw]);

  const globalSignedContent = Buffer.concat([signatureRaw, Buffer.from(trustedComment)]);
  const globalSignatureRaw = nodeSign(null, globalSignedContent, privateKey);

  const signatureFile = Buffer.concat([
    Buffer.from('untrusted comment: signature from minisign\n'),
    Buffer.from(`${sigInfo.toString('base64')}\n`),
    Buffer.from(`trusted comment: ${trustedComment}\n`),
    Buffer.from(`${globalSignatureRaw.toString('base64')}\n`),
  ]);

  return { publicKeyB64, signatureFile, payload, trustedComment };
}

describe('minisign verification', () => {
  it('returns true for a valid signature over the original payload', async () => {
    const payload = Buffer.from('hello zig tarball content');
    const tc = `timestamp:1700000000\tfile:zig-x86_64-linux-0.16.0.tar.xz\thashed`;
    const vec = buildTestVector(payload, tc);

    const key = await parseKey(vec.publicKeyB64);
    const sig = parseSignature(vec.signatureFile);

    expect(await verifySignature(key, sig, vec.payload)).toBe(true);
  });

  it('returns false when the payload is corrupted', async () => {
    const payload = Buffer.from('original content');
    const tc = `timestamp:1700000000\tfile:zig-x86_64-linux-0.16.0.tar.xz\thashed`;
    const vec = buildTestVector(payload, tc);

    const key = await parseKey(vec.publicKeyB64);
    const sig = parseSignature(vec.signatureFile);

    const corrupted = Buffer.from('corrupted content');
    expect(await verifySignature(key, sig, corrupted)).toBe(false);
  });

  it('returns false when the trusted comment has been altered', async () => {
    const payload = Buffer.from('hello zig tarball content');
    const tc = `timestamp:1700000000\tfile:zig-x86_64-linux-0.16.0.tar.xz\thashed`;
    const vec = buildTestVector(payload, tc);

    const tampered = Buffer.from(
      vec.signatureFile
        .toString('utf-8')
        .replace('zig-x86_64-linux-0.16.0.tar.xz', 'zig-evil-payload-99.tar.xz'),
    );

    const key = await parseKey(vec.publicKeyB64);
    const sig = parseSignature(tampered);

    expect(await verifySignature(key, sig, vec.payload)).toBe(false);
  });

  it('returns false when the signature was made with a different key', async () => {
    const payload = Buffer.from('zig tarball');
    const tc = `timestamp:1700000000\tfile:zig.tar.xz\thashed`;
    const vec1 = buildTestVector(payload, tc);
    const vec2 = buildTestVector(payload, tc);

    const key2 = await parseKey(vec2.publicKeyB64);
    const sig1 = parseSignature(vec1.signatureFile);

    expect(await verifySignature(key2, sig1, vec1.payload)).toBe(false);
  });

  it('rejects a key whose decoded body is not 32 bytes', async () => {
    const tooShort = Buffer.concat([Buffer.from([0x45, 0x64]), randomBytes(8), randomBytes(16)]);
    await expect(parseKey(tooShort.toString('base64'))).rejects.toThrow(/invalid public key/);
  });

  it('rejects a signature missing the untrusted comment header', () => {
    const bad = Buffer.from('something else: hi\n\n\n\n');
    expect(() => parseSignature(bad)).toThrow(/bad untrusted comment header/);
  });
});
