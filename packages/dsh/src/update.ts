/**
 * Explicit update check + one-click upgrade for the DSH plugin.
 *
 * The check asks the public npm registry for the latest version. The apply path
 * only calls the host plugin manager with an exact `@agent_memory/dsh@x.y.z`
 * spec; it never downloads or executes a caller-supplied URL.
 */

export const PLUGIN_VERSION = '0.5.1';
const PACKAGE_NAME = '@agent_memory/dsh';
const REGISTRY_LATEST = [
  'https://registry.npmjs.org/@agent_memory%2Fdsh/latest',
  'https://registry.npmmirror.com/@agent_memory%2Fdsh/latest',
];

export interface UpdateInfo {
  readonly current: string;
  readonly latest: string;
  readonly update_available: boolean;
  readonly tarball?: string;
}

export interface UpdateApplyResult {
  readonly ok: boolean;
  readonly version: string;
  readonly restart_required: boolean;
  readonly manual?: boolean;
  readonly error?: string;
  readonly result?: unknown;
}

interface BundleManager {
  installBundle(spec: string, options?: { enabled?: boolean }): Promise<unknown>;
}

export interface UpdateService {
  check(): Promise<UpdateInfo>;
  apply(version: string): Promise<UpdateApplyResult>;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value);
    return match === null ? [0, 0, 0] : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] as number) !== (b[index] as number)) return (a[index] as number) > (b[index] as number) ? 1 : -1;
  }
  return 0;
}

export function createUpdateService(manager: BundleManager | undefined, fetcher: typeof fetch = fetch): UpdateService {
  return {
    async check(): Promise<UpdateInfo> {
      let lastError: unknown;
      for (const endpoint of REGISTRY_LATEST) {
        try {
          const response = await fetcher(endpoint, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`);
          const body = (await response.json()) as { version?: unknown; dist?: { tarball?: unknown } };
          if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+/.test(body.version)) {
            throw new Error('registry response has no valid version');
          }
          return {
            current: PLUGIN_VERSION,
            latest: body.version,
            update_available: compareVersions(body.version, PLUGIN_VERSION) > 0,
            ...(typeof body.dist?.tarball === 'string' ? { tarball: body.dist.tarball } : {}),
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },

    async apply(version: string): Promise<UpdateApplyResult> {
      if (!/^\d+\.\d+\.\d+$/.test(version) || compareVersions(version, PLUGIN_VERSION) <= 0) {
        return { ok: false, version, restart_required: false, error: 'invalid upgrade version' };
      }
      if (manager === undefined) {
        return {
          ok: false,
          version,
          restart_required: false,
          manual: true,
          error: '宿主未提供插件管理服务，请在 设置 → 插件 中更新',
        };
      }
      try {
        const result = await manager.installBundle(`${PACKAGE_NAME}@${version}`, { enabled: true });
        return { ok: true, version, restart_required: true, result };
      } catch (error) {
        return {
          ok: false,
          version,
          restart_required: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
