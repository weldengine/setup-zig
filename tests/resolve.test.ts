import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enforceVersionPrefix,
  MACH_VERSIONS_JSON,
  resolveVersion,
  VERSIONS_JSON,
} from '../src/resolve.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveVersion', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-zig-resolve-'));
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns an explicit literal version unchanged', async () => {
    const result = await resolveVersion(
      { version: '0.13.0', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.13.0');
  });

  it("resolves the 'master' alias by fetching index.json", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      expect(url).toBe(VERSIONS_JSON);
      return jsonResponse({
        master: { version: '0.17.0-dev.42+abcdef012' },
        '0.16.0': { version: '0.16.0' },
      });
    });

    const result = await resolveVersion(
      { version: 'master', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.17.0-dev.42+abcdef012');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("resolves the 'latest' alias by picking the newest tagged release", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({
        master: { version: '0.17.0-dev.99' },
        '0.14.1': { version: '0.14.1' },
        '0.15.1': { version: '0.15.1' },
        '0.16.0': { version: '0.16.0' },
      });
    });

    const result = await resolveVersion(
      { version: 'latest', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.16.0');
  });

  it("resolves a Mach nominated version (e.g. '2024.5.0-mach')", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      expect(url).toBe(MACH_VERSIONS_JSON);
      return jsonResponse({
        '2024.5.0-mach': { version: '0.13.0' },
      });
    });

    const result = await resolveVersion(
      { version: '2024.5.0-mach', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.13.0');
  });

  it('infers version from build.zig.zon `minimum_zig_version`', async () => {
    const zonPath = path.join(tmpDir, 'pkg', 'build.zig.zon');
    await fs.mkdir(path.dirname(zonPath), { recursive: true });
    await fs.writeFile(
      zonPath,
      `.{ .name = "x", .minimum_zig_version = "0.15.1", .dependencies = .{} }`,
    );

    const result = await resolveVersion(
      { version: '', versionFile: 'pkg/build.zig.zon', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.15.1');
  });

  it('infers version from build.zig.zon `mach_zig_version` and resolves it via mach index', async () => {
    const zonPath = path.join(tmpDir, 'build.zig.zon');
    await fs.writeFile(
      zonPath,
      `.{ .name = "x", .mach_zig_version = "2024.5.0-mach", .dependencies = .{} }`,
    );

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({ '2024.5.0-mach': { version: '0.13.0' } });
    });

    const result = await resolveVersion(
      { version: '', versionFile: 'build.zig.zon', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.13.0');
  });

  it('throws when explicit version-file is missing', async () => {
    await expect(
      resolveVersion(
        { version: '', versionFile: 'does-not-exist.zon', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/Cannot read version-file/);
  });

  it('falls back to `latest` when no version, no version-file, and no build.zig.zon', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({
        master: { version: '0.17.0-dev.99' },
        '0.16.0': { version: '0.16.0' },
      });
    });

    const result = await resolveVersion(
      { version: '', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.16.0');
  });

  it('rejects when enforce-version-range does not match the resolved version', async () => {
    await expect(
      resolveVersion(
        { version: '0.15.1', versionFile: '', enforceVersionRange: '0.16' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/does not match enforce-version-range/);
  });

  it('accepts when enforce-version-range matches the major.minor of the resolved version', async () => {
    const result = await resolveVersion(
      { version: '0.16.0', versionFile: '', enforceVersionRange: '0.16' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.16.0');
  });

  it('skips unparseable version keys when computing latest', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({
        master: { version: '0.17.0-dev.1' },
        '0.16.0': { version: '0.16.0' },
        'not-a-version': { version: 'not-a-version' },
      });
    });
    const result = await resolveVersion(
      { version: 'latest', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.16.0');
  });

  it('picks the larger patch when major.minor are equal', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({
        master: { version: '0.17.0-dev.1' },
        '0.16.0': { version: '0.16.0' },
        '0.16.5': { version: '0.16.5' },
        '0.16.2': { version: '0.16.2' },
      });
    });
    const result = await resolveVersion(
      { version: 'latest', versionFile: '', enforceVersionRange: '' },
      { cwd: tmpDir },
    );
    expect(result).toBe('0.16.5');
  });

  it('throws when the index.json contains no tagged versions', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({ master: { version: '0.17.0-dev.1' } });
    });
    await expect(
      resolveVersion(
        { version: 'latest', versionFile: '', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/No tagged versions/);
  });

  it('throws when the mach index does not contain the requested name', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({ '2024.5.0-mach': { version: '0.13.0' } });
    });
    await expect(
      resolveVersion(
        { version: '2099.1.0-mach', versionFile: '', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/Mach nominated version .* not found/);
  });

  it('throws when index.json is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({ '0.16.0': 'not-an-object' });
    });
    await expect(
      resolveVersion(
        { version: 'latest', versionFile: '', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/Malformed index.json/);
  });

  it('throws when version-file is set but contains neither field', async () => {
    const zonPath = path.join(tmpDir, 'build.zig.zon');
    await fs.writeFile(zonPath, `.{ .name = "x", .dependencies = .{} }`);
    await expect(
      resolveVersion(
        { version: '', versionFile: 'build.zig.zon', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/No mach_zig_version or minimum_zig_version/);
  });

  it('returns "master" alias version when fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return jsonResponse({});
    });
    await expect(
      resolveVersion(
        { version: 'master', versionFile: '', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/No 'master' entry/);
  });

  it('rejects when getMasterVersion HTTP fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('boom', { status: 500 });
    });
    await expect(
      resolveVersion(
        { version: 'master', versionFile: '', enforceVersionRange: '' },
        { cwd: tmpDir },
      ),
    ).rejects.toThrow(/Failed to fetch.*HTTP 500/);
  });
});

describe('enforceVersionPrefix', () => {
  it('matches when prefix is the major.minor of the version', () => {
    expect(() => { enforceVersionPrefix('0.16.0', '0.16'); }).not.toThrow();
    expect(() => { enforceVersionPrefix('0.16.5', '0.16'); }).not.toThrow();
  });

  it('strips dev suffix before comparison', () => {
    expect(() => { enforceVersionPrefix('0.16.0-dev.500+abc', '0.16'); }).not.toThrow();
  });

  it('rejects mismatched minor', () => {
    expect(() => { enforceVersionPrefix('0.15.1', '0.16'); }).toThrow();
  });

  it('rejects mismatched major', () => {
    expect(() => { enforceVersionPrefix('1.0.0', '0.16'); }).toThrow();
  });
});
