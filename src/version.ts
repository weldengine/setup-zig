export type Version = {
  major: number;
  minor: number;
  patch: number;
  dev: number | null;
};

const VERSION_RE = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-dev\.(?<dev>\d+)\+[0-9a-f]*)?$/;

export function parseVersion(str: string): Version | null {
  const match = VERSION_RE.exec(str);
  if (match === null || !match.groups) return null;
  const groups = match.groups;
  const major = groups['major'];
  const minor = groups['minor'];
  const patch = groups['patch'];
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    dev: groups['dev'] === undefined ? null : parseInt(groups['dev'], 10),
  };
}

export function versionLessThan(curVer: string, minVer: string): boolean {
  const cur = parseVersion(curVer);
  const min = parseVersion(minVer);
  if (cur === null || min === null) return false;
  const curDev = cur.dev === null ? Infinity : cur.dev;
  const minDev = min.dev === null ? Infinity : min.dev;

  if (cur.major !== min.major) return cur.major < min.major;
  if (cur.minor !== min.minor) return cur.minor < min.minor;
  if (cur.patch !== min.patch) return cur.patch < min.patch;
  return curDev < minDev;
}

const ARCH_MAP: Readonly<Record<string, string>> = {
  arm: 'arm',
  arm64: 'aarch64',
  loong64: 'loongarch64',
  mips: 'mips',
  mipsel: 'mipsel',
  mips64: 'mips64',
  mips64el: 'mips64el',
  ppc64: 'powerpc64',
  riscv64: 'riscv64',
  s390x: 's390x',
  ia32: 'x86',
  x64: 'x86_64',
};

const PLATFORM_MAP: Readonly<Record<string, string>> = {
  android: 'android',
  freebsd: 'freebsd',
  sunos: 'illumos',
  linux: 'linux',
  darwin: 'macos',
  netbsd: 'netbsd',
  openbsd: 'openbsd',
  win32: 'windows',
};

export function getZigArch(nodeArch: string, endianness: 'BE' | 'LE', version: string): string {
  let arch = ARCH_MAP[nodeArch];
  if (arch === undefined) {
    throw new Error(`Unsupported architecture: ${nodeArch}`);
  }
  if (arch === 'powerpc64' && endianness === 'LE') {
    arch = 'powerpc64le';
  }
  if (arch === 'arm' && versionLessThan(version, '0.15.1')) {
    arch = 'armv7a';
  }
  return arch;
}

export function getZigPlatform(nodePlatform: string): string {
  const platform = PLATFORM_MAP[nodePlatform];
  if (platform === undefined) {
    throw new Error(`Unsupported platform: ${nodePlatform}`);
  }
  return platform;
}

export function getTarballName(version: string, zigArch: string, zigPlatform: string): string {
  if (versionLessThan(version, '0.15.0-dev.631+9a3540d61') && versionLessThan(version, '0.14.1')) {
    return `zig-${zigPlatform}-${zigArch}-${version}`;
  }
  return `zig-${zigArch}-${zigPlatform}-${version}`;
}

export function getTarballExt(nodePlatform: string): '.zip' | '.tar.xz' {
  return nodePlatform === 'win32' ? '.zip' : '.tar.xz';
}
