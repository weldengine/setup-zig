import { describe, expect, it } from 'vitest';
import {
  getTarballCacheKey,
  getZigCachePrefix,
  getZigCacheRestoreKeys,
  getZigCacheSaveKey,
  sanitizeJobName,
} from '../src/cache.js';

describe('getTarballCacheKey', () => {
  it('returns a deterministic namespaced key for the tarball basename', () => {
    expect(getTarballCacheKey('zig-x86_64-linux-0.16.0.tar.xz')).toBe(
      'weldengine-setup-zig-tarball-v1-zig-x86_64-linux-0.16.0.tar.xz',
    );
    expect(getTarballCacheKey('zig-aarch64-macos-0.15.1.tar.xz')).toBe(
      'weldengine-setup-zig-tarball-v1-zig-aarch64-macos-0.15.1.tar.xz',
    );
  });
});

describe('sanitizeJobName', () => {
  it('replaces non-word characters with underscores', () => {
    expect(sanitizeJobName('build (linux, x86_64)')).toBe('build__linux__x86_64_');
    expect(sanitizeJobName('test-matrix')).toBe('test_matrix');
    expect(sanitizeJobName('plain_job')).toBe('plain_job');
  });
});

describe('getZigCachePrefix', () => {
  it('builds a prefix containing job name, tarball name and user key', () => {
    const prefix = getZigCachePrefix('build', 'zig-x86_64-linux-0.16.0', 'matrix-1');
    expect(prefix).toBe('weldengine-setup-zig-zigcache-v1-build-zig-x86_64-linux-0.16.0-matrix-1-');
  });

  it('sanitizes the job name in the prefix', () => {
    const prefix = getZigCachePrefix('test (mac, arm)', 'zig-aarch64-macos-0.16.0', '');
    expect(prefix).toBe(
      'weldengine-setup-zig-zigcache-v1-test__mac__arm_-zig-aarch64-macos-0.16.0--',
    );
  });

  it('always ends with a trailing hyphen so restore-keys can prefix-match', () => {
    expect(getZigCachePrefix('j', 't', 'k')).toMatch(/-$/);
    expect(getZigCachePrefix('j', 't', '')).toMatch(/-$/);
  });
});

describe('getZigCacheSaveKey', () => {
  it('appends runId and runAttempt to the prefix', () => {
    const prefix = 'weldengine-setup-zig-zigcache-v1-build-zig-x86_64-linux-0.16.0--';
    expect(getZigCacheSaveKey(prefix, 12345, 1)).toBe(`${prefix}12345-1`);
    expect(getZigCacheSaveKey(prefix, 12345, 2)).toBe(`${prefix}12345-2`);
  });

  it('produces distinct keys for different attempts of the same run', () => {
    const prefix = 'p-';
    expect(getZigCacheSaveKey(prefix, 1, 1)).not.toBe(getZigCacheSaveKey(prefix, 1, 2));
  });
});

describe('getZigCacheRestoreKeys', () => {
  it('returns the prefix as the sole restore-key for prefix-matching', () => {
    const prefix = 'weldengine-setup-zig-zigcache-v1-build-tarball-key-';
    expect(getZigCacheRestoreKeys(prefix)).toEqual([prefix]);
  });

  it('uses an array so consumers can pass it directly to actions/cache', () => {
    expect(Array.isArray(getZigCacheRestoreKeys('p-'))).toBe(true);
  });
});
