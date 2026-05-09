import { describe, expect, it } from 'vitest';
import {
  getTarballExt,
  getTarballName,
  getZigArch,
  getZigPlatform,
  parseVersion,
  versionLessThan,
} from '../src/version.js';

describe('parseVersion', () => {
  it('parses a stable release', () => {
    expect(parseVersion('0.13.0')).toEqual({ major: 0, minor: 13, patch: 0, dev: null });
  });

  it('parses a dev version with hash', () => {
    expect(parseVersion('0.14.0-dev.351+64ef45eb0')).toEqual({
      major: 0,
      minor: 14,
      patch: 0,
      dev: 351,
    });
  });

  it('parses a multi-digit patch', () => {
    expect(parseVersion('1.20.123')).toEqual({ major: 1, minor: 20, patch: 123, dev: null });
  });

  it('returns null for malformed strings', () => {
    expect(parseVersion('master')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('2024.5.0-mach')).toBeNull();
  });
});

describe('versionLessThan', () => {
  it('compares stable vs stable on patch boundary', () => {
    expect(versionLessThan('0.14.0', '0.14.1')).toBe(true);
    expect(versionLessThan('0.14.1', '0.14.1')).toBe(false);
    expect(versionLessThan('0.14.2', '0.14.1')).toBe(false);
  });

  it('handles the 0.15.0-dev.631 dev boundary', () => {
    expect(versionLessThan('0.15.0-dev.500+aaaaaaaaa', '0.15.0-dev.631+9a3540d61')).toBe(true);
    expect(versionLessThan('0.15.0-dev.631+9a3540d61', '0.15.0-dev.631+9a3540d61')).toBe(false);
    expect(versionLessThan('0.15.0-dev.700+bbbbbbbbb', '0.15.0-dev.631+9a3540d61')).toBe(false);
  });

  it('handles the 0.15.1 boundary for arm rename', () => {
    expect(versionLessThan('0.15.0', '0.15.1')).toBe(true);
    expect(versionLessThan('0.15.1', '0.15.1')).toBe(false);
    expect(versionLessThan('0.16.0', '0.15.1')).toBe(false);
  });

  it('treats stable release as newer than its dev counterparts', () => {
    expect(versionLessThan('0.14.0-dev.999+aaaaaaaaa', '0.14.0')).toBe(true);
    expect(versionLessThan('0.14.0', '0.14.0-dev.999+aaaaaaaaa')).toBe(false);
  });

  it('returns false when either side is malformed', () => {
    expect(versionLessThan('master', '0.14.0')).toBe(false);
    expect(versionLessThan('0.14.0', 'latest')).toBe(false);
  });
});

describe('getTarballName', () => {
  it('uses arch-platform format on 0.14.1+', () => {
    expect(getTarballName('0.14.1', 'x86_64', 'linux')).toBe('zig-x86_64-linux-0.14.1');
    expect(getTarballName('0.16.0', 'aarch64', 'macos')).toBe('zig-aarch64-macos-0.16.0');
  });

  it('uses platform-arch format on 0.14.0 and earlier', () => {
    expect(getTarballName('0.14.0', 'x86_64', 'linux')).toBe('zig-linux-x86_64-0.14.0');
    expect(getTarballName('0.13.0', 'aarch64', 'macos')).toBe('zig-macos-aarch64-0.13.0');
  });

  it('uses platform-arch for 0.14.0-dev versions before format flip', () => {
    expect(getTarballName('0.14.0-dev.500+abcdef012', 'x86_64', 'linux')).toBe(
      'zig-linux-x86_64-0.14.0-dev.500+abcdef012',
    );
  });

  it('uses arch-platform for dev versions on the new master branch', () => {
    expect(getTarballName('0.15.0-dev.700+abcdef012', 'x86_64', 'linux')).toBe(
      'zig-x86_64-linux-0.15.0-dev.700+abcdef012',
    );
  });
});

describe('getZigArch', () => {
  it('renames arm to armv7a before 0.15.1', () => {
    expect(getZigArch('arm', 'LE', '0.15.0')).toBe('armv7a');
    expect(getZigArch('arm', 'LE', '0.15.1')).toBe('arm');
    expect(getZigArch('arm', 'LE', '0.16.0')).toBe('arm');
  });

  it('renames ppc64 to powerpc64le on little-endian', () => {
    expect(getZigArch('ppc64', 'LE', '0.16.0')).toBe('powerpc64le');
    expect(getZigArch('ppc64', 'BE', '0.16.0')).toBe('powerpc64');
  });

  it('maps common architectures', () => {
    expect(getZigArch('x64', 'LE', '0.16.0')).toBe('x86_64');
    expect(getZigArch('arm64', 'LE', '0.16.0')).toBe('aarch64');
    expect(getZigArch('ia32', 'LE', '0.16.0')).toBe('x86');
    expect(getZigArch('riscv64', 'LE', '0.16.0')).toBe('riscv64');
  });

  it('throws on unsupported architecture', () => {
    expect(() => getZigArch('alpha', 'LE', '0.16.0')).toThrow(/Unsupported architecture/);
  });
});

describe('getZigPlatform', () => {
  it('maps common platforms', () => {
    expect(getZigPlatform('linux')).toBe('linux');
    expect(getZigPlatform('darwin')).toBe('macos');
    expect(getZigPlatform('win32')).toBe('windows');
    expect(getZigPlatform('sunos')).toBe('illumos');
  });

  it('throws on unsupported platform', () => {
    expect(() => getZigPlatform('haiku')).toThrow(/Unsupported platform/);
  });
});

describe('getTarballExt', () => {
  it('returns .zip on Windows', () => {
    expect(getTarballExt('win32')).toBe('.zip');
  });

  it('returns .tar.xz on other platforms', () => {
    expect(getTarballExt('linux')).toBe('.tar.xz');
    expect(getTarballExt('darwin')).toBe('.tar.xz');
    expect(getTarballExt('freebsd')).toBe('.tar.xz');
  });
});
