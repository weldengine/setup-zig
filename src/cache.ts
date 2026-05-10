const TARBALL_CACHE_NAMESPACE = 'weldengine-setup-zig-tarball-v1';
const ZIG_CACHE_NAMESPACE = 'weldengine-setup-zig-zigcache-v1';

export function getTarballCacheKey(tarballBaseName: string): string {
  return `${TARBALL_CACHE_NAMESPACE}-${tarballBaseName}`;
}

export function sanitizeJobName(jobName: string): string {
  return jobName.replaceAll(/[^\w]/g, '_');
}

export function getZigCachePrefix(jobName: string, tarballName: string, userKey: string): string {
  const sanitized = sanitizeJobName(jobName);
  return `${ZIG_CACHE_NAMESPACE}-${sanitized}-${tarballName}-${userKey}-`;
}

export function getZigCacheSaveKey(prefix: string, runId: number, runAttempt: number): string {
  return `${prefix}${runId.toString()}-${runAttempt.toString()}`;
}

export function getZigCacheRestoreKeys(prefix: string): readonly string[] {
  return [prefix];
}
