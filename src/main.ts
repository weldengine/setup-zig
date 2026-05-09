import * as os from 'node:os';
import * as path from 'node:path';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import {
  getTarballCacheKey,
  getZigCachePrefix,
  getZigCacheRestoreKeys,
} from './cache.js';
import { downloadTarball } from './download.js';
import { resolveVersion } from './resolve.js';
import { getTarballExt, getTarballName, getZigArch, getZigPlatform } from './version.js';

const DEFAULT_SOURCE = 'github-weldengine-setup-zig';

async function main(): Promise<void> {
  try {
    const version = core.getInput('version');
    const versionFile = core.getInput('version-file');
    const enforceVersionRange = core.getInput('enforce-version-range');
    const mirrorOverride = core.getInput('mirror');
    const sourceInput = core.getInput('source');
    const source = sourceInput === '' ? DEFAULT_SOURCE : sourceInput;
    const useCache = core.getBooleanInput('use-cache');
    const cacheKey = core.getInput('cache-key');

    const resolvedVersion = await resolveVersion({
      version,
      versionFile,
      enforceVersionRange,
    });
    core.info(`Resolved Zig version: ${resolvedVersion}`);

    const zigArch = getZigArch(os.arch(), os.endianness(), resolvedVersion);
    const zigPlatform = getZigPlatform(os.platform());
    const tarballName = getTarballName(resolvedVersion, zigArch, zigPlatform);
    const tarballExt = getTarballExt(os.platform());
    const tarballFilename = `${tarballName}${tarballExt}`;

    const tarballCacheKey = getTarballCacheKey(tarballFilename);
    const runnerTemp = process.env['RUNNER_TEMP'] ?? os.tmpdir();
    const tarballPath = path.join(runnerTemp, tarballFilename);

    let usedTarballPath: string;
    const tarballHit = await cache.restoreCache([tarballPath], tarballCacheKey);
    if (tarballHit !== undefined) {
      core.info(`Tarball cache hit: ${tarballCacheKey}`);
      usedTarballPath = tarballPath;
    } else {
      core.info(`Tarball cache miss; downloading ${tarballFilename} (source=${source})`);
      core.debug(`download source query string: ${source}`);
      const dlResult = await downloadTarball({
        version: resolvedVersion,
        tarballFilename,
        source,
        mirrorOverride,
        destDir: runnerTemp,
      });
      core.info(`Downloaded from ${dlResult.mirrorUsed}`);
      usedTarballPath = dlResult.tarballPath;

      try {
        await cache.saveCache([usedTarballPath], tarballCacheKey);
      } catch (e) {
        core.warning(`Failed to save tarball cache: ${String(e)}`);
      }
    }

    core.info(`Extracting ${tarballFilename}`);
    const extractedParent =
      tarballExt === '.zip'
        ? await tc.extractZip(usedTarballPath)
        : await tc.extractTar(usedTarballPath, undefined, 'xJ');
    const zigDir = path.join(extractedParent, tarballName);

    core.addPath(zigDir);

    const versionResult = await exec.getExecOutput('zig', ['version']);
    const installedVersion = versionResult.stdout.trim();
    core.info(`Installed Zig version: ${installedVersion}`);
    core.setOutput('zig-version', installedVersion);

    const zigCachePath = path.join(
      process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
      '.zig-cache',
    );
    core.exportVariable('ZIG_GLOBAL_CACHE_DIR', zigCachePath);
    core.exportVariable('ZIG_LOCAL_CACHE_DIR', zigCachePath);

    core.saveState('use-cache', useCache.toString());
    core.saveState('zig-cache-path', zigCachePath);
    core.saveState('cache-prefix', '');

    if (useCache) {
      const jobName = process.env['GITHUB_JOB'] ?? 'job';
      const cachePrefix = getZigCachePrefix(jobName, tarballName, cacheKey);
      core.info(`Restoring Zig cache with prefix '${cachePrefix}'`);
      const hit = await cache.restoreCache(
        [zigCachePath],
        cachePrefix,
        getZigCacheRestoreKeys(cachePrefix).slice(),
      );
      if (hit === undefined) {
        core.info('No Zig cache found; starting fresh');
      } else {
        core.info(`Zig cache restored from key '${hit}'`);
      }
      core.saveState('cache-prefix', cachePrefix);
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

main().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
