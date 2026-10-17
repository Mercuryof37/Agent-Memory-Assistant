import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { StartupError } from '../errors.ts';
import type { EnvLike } from '../paths.ts';
import { parseConfigDocument, type Config } from './config.ts';

export interface LoadedConfig {
  readonly config: Config;
  /** Path actually read, or null when built-in defaults are in use. */
  readonly configPath: string | null;
  readonly warnings: readonly string[];
}

/**
 * Load config.toml.
 *
 * Resolution: explicit path → AGENT_MEMORY_CONFIG → <home>/config.toml.
 * A missing default file means "all defaults"; a missing explicit file is an
 * error, because the caller asked for that specific file.
 */
export function loadConfig(options: {
  home: string;
  configPath?: string;
  env?: EnvLike;
  cwd?: string;
}): LoadedConfig {
  const cwd = options.cwd ?? process.cwd();
  const fromEnv = options.env?.AGENT_MEMORY_CONFIG;
  const explicit = options.configPath ?? (fromEnv === undefined || fromEnv.trim() === '' ? undefined : fromEnv);
  const configPath =
    explicit === undefined
      ? join(options.home, 'config.toml')
      : isAbsolute(explicit)
        ? explicit
        : resolve(cwd, explicit);

  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && explicit === undefined) {
      return {
        config: parseConfigDocument('', configPath).config,
        configPath: null,
        warnings: [`${configPath} not found; built-in defaults are in use`],
      };
    }
    if (code === 'ENOENT') {
      throw new StartupError('CONFIG_UNREADABLE', 'the config file does not exist', {
        sourcePath: configPath,
        hint: 'create it with `mem init`, or drop --config / AGENT_MEMORY_CONFIG',
      });
    }
    throw new StartupError('CONFIG_UNREADABLE', 'the config file cannot be read', {
      sourcePath: configPath,
      details: [error instanceof Error ? error.message : String(error)],
    });
  }

  const { config } = parseConfigDocument(text, configPath);
  return { config, configPath, warnings: [] };
}
