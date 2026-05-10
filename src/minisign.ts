/**
 * Minisign signature verification (Ed25519 + BLAKE2b).
 *
 * Originally from mlugg/setup-zig (https://codeberg.org/mlugg/setup-zig)
 * Copyright (c) Matthew Lugg, MIT License.
 * Adapted for weldengine/setup-zig: TypeScript types and ESM imports.
 */
import { Buffer } from 'node:buffer';
import { createHash, subtle, type webcrypto } from 'node:crypto';

export type ParsedKey = {
  id: Buffer;
  key: webcrypto.CryptoKey;
};

export type ParsedSignature = {
  algorithm: Buffer;
  keyId: Buffer;
  signature: Buffer;
  trustedComment: Buffer;
  globalSignature: Buffer;
};

export async function parseKey(keyStr: string): Promise<ParsedKey> {
  const keyInfo = Buffer.from(keyStr, 'base64');
  const id = keyInfo.subarray(2, 10);
  const key = keyInfo.subarray(10);

  if (key.byteLength !== 32) {
    throw new Error('invalid public key given');
  }

  return {
    id,
    key: await subtle.importKey('raw', key, 'Ed25519', false, ['verify']),
  };
}

export function parseSignature(sigBufIn: Buffer): ParsedSignature {
  const untrustedHeader = Buffer.from('untrusted comment: ');
  const trustedHeader = Buffer.from('trusted comment: ');
  let sigBuf = sigBufIn;

  if (!sigBuf.subarray(0, untrustedHeader.byteLength).equals(untrustedHeader)) {
    throw new Error('invalid minisign signature: bad untrusted comment header');
  }
  sigBuf = sigBuf.subarray(untrustedHeader.byteLength);

  sigBuf = sigBuf.subarray(sigBuf.indexOf('\n') + 1);

  const sigInfoEnd = sigBuf.indexOf('\n');
  const sigInfo = Buffer.from(sigBuf.subarray(0, sigInfoEnd).toString(), 'base64');
  sigBuf = sigBuf.subarray(sigInfoEnd + 1);

  const algorithm = sigInfo.subarray(0, 2);
  const keyId = sigInfo.subarray(2, 10);
  const signature = sigInfo.subarray(10);

  if (!sigBuf.subarray(0, trustedHeader.byteLength).equals(trustedHeader)) {
    throw new Error('invalid minisign signature: bad trusted comment header');
  }
  sigBuf = sigBuf.subarray(trustedHeader.byteLength);

  const trustedCommentEnd = sigBuf.indexOf('\n');
  const trustedComment = sigBuf.subarray(0, trustedCommentEnd);
  sigBuf = sigBuf.subarray(trustedCommentEnd + 1);

  let globalSigEnd = sigBuf.indexOf('\n');
  if (globalSigEnd === -1) globalSigEnd = sigBuf.length;
  const globalSignature = Buffer.from(sigBuf.subarray(0, globalSigEnd).toString(), 'base64');
  sigBuf = sigBuf.subarray(sigInfoEnd + 1);

  if (sigBuf.length !== 0) {
    throw new Error('invalid minisign signature: trailing bytes');
  }

  return {
    algorithm,
    keyId,
    signature,
    trustedComment,
    globalSignature,
  };
}

export async function verifySignature(
  pubkey: ParsedKey,
  signature: ParsedSignature,
  fileContent: Buffer,
): Promise<boolean> {
  if (!signature.keyId.equals(pubkey.id)) {
    return false;
  }

  let signedContent: Buffer;
  if (signature.algorithm.equals(Buffer.from('ED'))) {
    const hash = createHash('BLAKE2b512');
    hash.update(fileContent);
    signedContent = hash.digest();
  } else if (signature.algorithm.equals(Buffer.from('Ed'))) {
    signedContent = fileContent;
  } else {
    return false;
  }

  if (!(await subtle.verify('Ed25519', pubkey.key, signature.signature, signedContent))) {
    return false;
  }

  const globalSignedContent = Buffer.concat([signature.signature, signature.trustedComment]);
  if (
    !(await subtle.verify('Ed25519', pubkey.key, signature.globalSignature, globalSignedContent))
  ) {
    return false;
  }

  return true;
}
