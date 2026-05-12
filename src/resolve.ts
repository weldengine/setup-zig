import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseVersion } from './version.js';

export const VERSIONS_JSON = 'https://ziglang.org/download/index.json';
export const MACH_VERSIONS_JSON = 'https://pkg.machengine.org/zig/index.json';

const MACH_RE = /\.\s*mach_zig_version\s*=\s*"(.*?)"/;
const MIN_RE = /\.\s*minimum_zig_version\s*=\s*"(.*?)"/;

export type ResolveInputs = {
  version: string;
  versionFile: string;
  enforceVersionRange: string;
};

export type ResolveOptions = {
  cwd?: string;
};

export async function resolveVersion(
  inputs: ResolveInputs,
  opts: ResolveOptions = {},
): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const explicit = inputs.version.trim();
  const versionFile = inputs.versionFile.trim();

  let resolved: string;
  if (explicit !== '') {
    resolved = await resolveAlias(explicit);
  } else if (versionFile !== '') {
    const abs = path.isAbsolute(versionFile) ? versionFile : path.join(cwd, versionFile);
    const fromZon = await readZonFromFile(abs, true);
    if (fromZon === null) {
      throw new Error(`No mach_zig_version or minimum_zig_version found in '${versionFile}'`);
    }
    resolved = fromZon;
  } else {
    const fromZon = await readZonFromFile(path.join(cwd, 'build.zig.zon'), false);
    resolved = fromZon ?? (await getLatestVersion());
  }

  const range = inputs.enforceVersionRange.trim();
  if (range !== '') {
    enforceVersionPrefix(resolved, range);
  }
  return resolved;
}

async function resolveAlias(value: string): Promise<string> {
  if (value === 'master') return getMasterVersion();
  if (value === 'latest') return getLatestVersion();
  if (value.endsWith('-mach')) return getMachVersion(value);
  return value;
}

async function readZonFromFile(filePath: string, strict: boolean): Promise<string | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (e) {
    if (strict) {
      throw new Error(`Cannot read version-file '${filePath}': ${String(e)}`);
    }
    return null;
  }

  const machMatch = MACH_RE.exec(content);
  const machName = machMatch?.[1];
  if (machName !== undefined) {
    return await getMachVersion(machName);
  }

  const minMatch = MIN_RE.exec(content);
  const minVersion = minMatch?.[1];
  if (minVersion !== undefined) {
    return minVersion;
  }

  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status.toString()}`);
  }
  return await resp.json();
}

export async function getMasterVersion(): Promise<string> {
  const versions = await fetchJson(VERSIONS_JSON);
  if (!isObjectMap(versions)) {
    throw new Error(`Malformed index.json from ${VERSIONS_JSON}`);
  }
  const master = versions.master;
  if (master === undefined) {
    throw new Error(`No 'master' entry in ${VERSIONS_JSON}`);
  }
  const v = (master as { version?: unknown }).version;
  if (typeof v !== 'string') {
    throw new Error(`'master' entry in ${VERSIONS_JSON} has no string 'version' field`);
  }
  return v;
}

export async function getLatestVersion(): Promise<string> {
  const versions = await fetchJson(VERSIONS_JSON);
  if (!isObjectMap(versions)) {
    throw new Error(`Malformed index.json from ${VERSIONS_JSON}`);
  }
  let latestName: string | null = null;
  let latestParsed: NonNullable<ReturnType<typeof parseVersion>> | null = null;

  for (const name of Object.keys(versions)) {
    if (name === 'master') continue;
    const parsed = parseVersion(name);
    if (parsed === null) continue;
    if (latestParsed === null || isStrictlyNewer(parsed, latestParsed)) {
      latestName = name;
      latestParsed = parsed;
    }
  }

  if (latestName === null) {
    throw new Error(`No tagged versions in ${VERSIONS_JSON}`);
  }
  return latestName;
}

export async function getMachVersion(name: string): Promise<string> {
  const versions = await fetchJson(MACH_VERSIONS_JSON);
  if (!isObjectMap(versions)) {
    throw new Error(`Malformed index.json from ${MACH_VERSIONS_JSON}`);
  }
  const entry = versions[name];
  if (entry === undefined) {
    throw new Error(`Mach nominated version '${name}' not found`);
  }
  const v = (entry as { version?: unknown }).version;
  if (typeof v !== 'string') {
    throw new Error(`Mach entry '${name}' in ${MACH_VERSIONS_JSON} has no string 'version' field`);
  }
  return v;
}

function isStrictlyNewer(
  a: NonNullable<ReturnType<typeof parseVersion>>,
  b: NonNullable<ReturnType<typeof parseVersion>>,
): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  return false;
}

function isObjectMap(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'object' || v === null) return false;
  }
  return true;
}

export function enforceVersionPrefix(version: string, prefix: string): void {
  const stable = version.split('-')[0] ?? version;
  const versionTokens = stable.split('.');
  const prefixTokens = prefix.split('.');

  for (let i = 0; i < prefixTokens.length; i++) {
    if (versionTokens[i] !== prefixTokens[i]) {
      throw new Error(
        `Resolved Zig version '${version}' does not match enforce-version-range '${prefix}'`,
      );
    }
  }
}
