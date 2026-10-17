/**
 * DSH adapter -configuration surface.
 *
 * `packages/dsh` never touches files: it calls core, and core owns every read
 * and write (CI-enforced discipline, ADR-0001). In S1 this module only exposes
 * the resolved settings that later stages (assemble, tools, closeout) consume.
 */

import { startup, type Config, type Runtime, type StartupOptions } from '../../core/src/index.ts';

export interface DshMemorySettings {
  readonly home: string;
  readonly config: Config;
  readonly runtime: Runtime;
}

export interface DshSettingsOptions extends StartupOptions {}

/**
 * Resolve the memory settings for the DSH host. Throws StartupError when the
 * store is missing, policy is tampered with, or config.toml has unknown keys - * the plugin must let that abort activation rather than run with defaults.
 */
export function loadDshMemorySettings(options: DshSettingsOptions = {}): DshMemorySettings {
  const runtime = startup(options);
  return { home: runtime.home, config: runtime.config, runtime };
}
