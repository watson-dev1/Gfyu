
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Normalize a plugin export into one or more command objects.
 * Supports:
 * - export default { command, run }
 * - export default [{ command, run }]
 * - export const commands = [...]
 * - command arrays
 */
function normalizePlugin(plugin, filename) {
  if (!plugin || typeof plugin !== 'object') {
    return [];
  }

  const run =
    typeof plugin.run === 'function'
      ? plugin.run
      : typeof plugin.execute === 'function'
        ? plugin.execute
        : null;

  if (!run) return [];

  const rawCommands = plugin.command ?? plugin.commands;

  const commands = Array.isArray(rawCommands)
    ? rawCommands
    : [rawCommands];

  const aliases = Array.isArray(plugin.aliases)
    ? plugin.aliases
    : [];

  return commands
    .filter(command =>
      typeof command === 'string' && command.trim()
    )
    .map(command => ({
      ...plugin,

      command: command.toLowerCase().trim(),

      aliases: [
        ...new Set(
          aliases
            .map(alias => String(alias).toLowerCase().trim())
            .filter(Boolean)
        )
      ],

      run,

      filename,

      category: plugin.category || 'misc',

      description:
        plugin.description || 'No description provided'
    }));
}

/**
 * Get usable plugin entries from different module formats.
 */
function getPluginEntries(module) {
  const exported =
    module.default ??
    module.commands ??
    module.plugins ??
    module;

  if (Array.isArray(exported)) {
    return exported;
  }

  if (exported && typeof exported === 'object') {
    return [exported];
  }

  return [];
}

/**
 * Load all plugins and build the global command registry.
 */
export async function loadPlugins() {
  const directory = path.resolve('./plugins');

  await fs.mkdir(directory, {
    recursive: true
  });

  const files = (await fs.readdir(directory))
    .filter(file =>
      file.endsWith('.js') &&
      !file.startsWith('_')
    )
    .sort();

  const loadedPlugins = [];
  const failedFiles = [];

  // IMPORT PLUGIN FILES
  for (const filename of files) {
    const filepath = path.join(directory, filename);

    try {
      const url =
        `${pathToFileURL(filepath).href}?version=${Date.now()}`;

      const module = await import(url);
      const entries = getPluginEntries(module);

      let fileCommandCount = 0;

      for (const entry of entries) {
        const normalized = normalizePlugin(entry, filename);

        loadedPlugins.push(...normalized);

        fileCommandCount += normalized.length;
      }

      console.log(
        `✓ Loaded ${filename} (${fileCommandCount} commands)`
      );

    } catch (error) {
      failedFiles.push(filename);

      console.error(
        `✗ Plugin load failed (${filename}):`,
        error
      );
    }
  }

  // REMOVE DUPLICATE PRIMARY COMMANDS
  const seenCommands = new Set();
  const uniquePlugins = [];

  for (const plugin of loadedPlugins) {
    if (seenCommands.has(plugin.command)) {
      console.warn(
        `⚠ Duplicate command ignored: ${plugin.command} (${plugin.filename})`
      );

      continue;
    }

    seenCommands.add(plugin.command);
    uniquePlugins.push(plugin);
  }

  // BUILD COMMAND MAP
  const commandMap = new Map();

  // Register primary commands first.
  for (const plugin of uniquePlugins) {
    commandMap.set(plugin.command, plugin);
  }

  // Register aliases without overwriting primary commands.
  for (const plugin of uniquePlugins) {
    const registeredAliases = [];

    for (const alias of plugin.aliases) {
      if (commandMap.has(alias)) {
        console.warn(
          `⚠ Alias ignored: ${alias} (${plugin.command})`
        );

        continue;
      }

      commandMap.set(alias, plugin);
      registeredAliases.push(alias);
    }

    // Keep only aliases that were successfully registered.
    plugin.aliases = registeredAliases;
  }

  // GLOBAL REGISTRIES
  globalThis.plugins = uniquePlugins;
  globalThis.commandMap = commandMap;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🤖 ${globalThis.config?.botName || 'PRECIOUS-MD'}`);
  console.log(`🧩 Plugin files: ${files.length}`);
  console.log(`✅ Loaded commands: ${uniquePlugins.length}`);
  console.log(`🔗 Commands + aliases: ${commandMap.size}`);
  console.log(`❌ Failed plugin files: ${failedFiles.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return uniquePlugins;
}

/**
 * Find a command by its name or alias.
 */
export function getPlugin(command) {
  if (!command) return null;

  return globalThis.commandMap?.get(
    String(command).toLowerCase().trim()
  ) || null;
}

/**
 * Reload plugins.
 */
export async function reloadPlugins() {
  return loadPlugins();
}
