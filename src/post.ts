import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getZigCacheSaveKey } from './cache.ts';
import { maybeGc, parseSizeLimit } from './gc.ts';

async function post(): Promise<void> {
  try {
    const useCacheState = core.getState('use-cache');
    if (useCacheState !== 'true') {
      core.info('use-cache is false; nothing to save');
      return;
    }

    const zigCachePath = core.getState('zig-cache-path');
    const cachePrefix = core.getState('cache-prefix');
    if (zigCachePath === '' || cachePrefix === '') {
      core.info('No Zig cache state recorded; nothing to save');
      return;
    }

    const sizeLimitInput = core.getInput('cache-size-limit');
    const sizeLimit = parseSizeLimit(sizeLimitInput);

    const gcResult = await maybeGc(zigCachePath, sizeLimit);
    if (gcResult.purged) {
      core.info(
        `Zig cache exceeded ${String(gcResult.limit)} bytes (was ${String(gcResult.size)}); ` +
          `purged contents before save`,
      );
    } else if (gcResult.limit !== null) {
      core.info(
        `Zig cache size ${String(gcResult.size)} bytes (limit ${String(gcResult.limit)}); ` +
          `keeping contents intact`,
      );
    }

    const runId = github.context.runId;
    const runAttempt = parseInt(process.env['GITHUB_RUN_ATTEMPT'] ?? '1', 10);
    const saveKey = getZigCacheSaveKey(cachePrefix, runId, runAttempt);

    core.info(`Saving Zig cache with key '${saveKey}'`);
    try {
      await cache.saveCache([zigCachePath], saveKey);
    } catch (e) {
      core.warning(`Failed to save Zig cache: ${String(e)}`);
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

post().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
