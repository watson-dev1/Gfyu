
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const MODULE_DIRECTORY = path.dirname(
  fileURLToPath(import.meta.url)
);

const DEFAULT_PLUGIN_DIRECTORY = path.resolve(
  MODULE_DIRECTORY,
  '../plugins'
);

let loadingPromise = null;
let registryVersion = 0;

// --------------------------------------------------
// COMMAND NORMALIZATION
// --------------------------------------------------

function normalizeCommand(command) {
  if (typeof command !== 'string') {
    return '';
  }

  return command
    .trim()
    .toLowerCase()
    .replace(/^[.!#/]+/, '');
}

function normalizeCategory(category) {
  return String(category || 'misc')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '') || 'misc';
}

// --------------------------------------------------
// PLUGIN NORMALIZATION
// --------------------------------------------------

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

  if (!run) {
    return [];
  }

  const rawCommands = plugin.command ?? plugin.commands;

  const commands = Array.isArray(rawCommands)
    ? rawCommands
    : [rawCommands];

  const rawAliases = Array.isArray(plugin.aliases)
    ? plugin.aliases
    : plugin.aliases
      ? [plugin.aliases]
      : [];

  const normalizedAliases = [
    ...new Set(
      rawAliases
        .map(normalizeCommand)
        .filter(Boolean)
    )
  ];

  const normalizedCommands = [
    ...new Set(
      commands
        .map(normalizeCommand)
        .filter(command =>
          command &&
          !/\s/.test(command)
        )
    )
  ];

  return normalizedCommands.map(command => ({
    ...plugin,

    command,

    aliases: normalizedAliases.filter(
      alias => alias !== command
    ),

    run,

    filename,

    category: normalizeCategory(plugin.category),

    description: String(
      plugin.description || 'No description provided'
    ),

    cooldown: Math.max(
      0,
      Math.min(
        Number.isFinite(Number(plugin.cooldown))
          ? Number(plugin.cooldown)
          : 0,
        3600
      )
    )
  }));
}

// --------------------------------------------------
// MODULE EXPORT EXTRACTION
// --------------------------------------------------

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

// --------------------------------------------------
// BUILD COMMAND REGISTRY
// --------------------------------------------------

function buildRegistry(plugins) {
  const commandMap = new Map();

  const uniquePlugins = [];

  const primaryCommands = new Set();

  const statistics = {
    primaryCommands: 0,
    aliases: 0,
    duplicateCommands: 0,
    duplicateAliases: 0,
    categories: {},
    files: new Set()
  };

  // ----------------------------------------------
  // REGISTER PRIMARY COMMANDS FIRST
  // ----------------------------------------------

  for (const plugin of plugins) {
    const command = normalizeCommand(plugin.command);

    if (!command) {
      continue;
    }

    if (primaryCommands.has(command)) {
      statistics.duplicateCommands++;

      console.warn(
        `[PLUGINS] Duplicate command ignored: ${command} (${plugin.filename})`
      );

      continue;
    }

    primaryCommands.add(command);

    const registeredPlugin = {
      ...plugin,
      command,
      aliases: [...plugin.aliases]
    };

    commandMap.set(command, registeredPlugin);

    uniquePlugins.push(registeredPlugin);

    statistics.primaryCommands++;

    statistics.categories[registeredPlugin.category] =
      (statistics.categories[registeredPlugin.category] || 0) + 1;

    statistics.files.add(registeredPlugin.filename);
  }

  // ----------------------------------------------
  // REGISTER ALIASES SECOND
  // ----------------------------------------------

  for (const plugin of uniquePlugins) {
    const registeredAliases = [];

    for (const rawAlias of plugin.aliases) {
      const alias = normalizeCommand(rawAlias);

      if (!alias || alias === plugin.command) {
        continue;
      }

      // Never allow aliases to replace primary commands.
      if (primaryCommands.has(alias)) {
        statistics.duplicateAliases++;

        console.warn(
          `[PLUGINS] Alias conflicts with primary command: ${alias}`
        );

        continue;
      }

      // Prevent two plugins from claiming the same alias.
      if (commandMap.has(alias)) {
        statistics.duplicateAliases++;

        console.warn(
          `[PLUGINS] Duplicate alias ignored: ${alias} (${plugin.command})`
        );

        continue;
      }

      commandMap.set(alias, plugin);

      registeredAliases.push(alias);

      statistics.aliases++;
    }

    plugin.aliases = registeredAliases;
  }

  return {
    plugins: uniquePlugins,
    commandMap,

    statistics: {
      primaryCommands: statistics.primaryCommands,
      aliases: statistics.aliases,
      duplicateCommands: statistics.duplicateCommands,
      duplicateAliases: statistics.duplicateAliases,
      categories: statistics.categories,
      files: statistics.files.size
    }
  };
}

// --------------------------------------------------
// PLUGIN DIRECTORY
// --------------------------------------------------

function getPluginDirectory() {
  return path.resolve(
    globalThis.config?.pluginsDir ||
    DEFAULT_PLUGIN_DIRECTORY
  );
}

// --------------------------------------------------
// LOAD PLUGINS
// --------------------------------------------------

async function performPluginLoad() {
  const directory = getPluginDirectory();

  await fs.mkdir(directory, {
    recursive: true
  });

  const files = (await fs.readdir(directory))
    .filter(filename =>
      filename.endsWith('.js') &&
      !filename.startsWith('_') &&
      !filename.startsWith('.')
    )
    .sort();

  const loadedPlugins = [];
  const failedFiles = [];

  // ----------------------------------------------
  // IMPORT PLUGIN FILES
  // ----------------------------------------------

  for (const filename of files) {
    const filepath = path.join(directory, filename);

    try {
      const cacheVersion =
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const url = pathToFileURL(filepath);

      url.searchParams.set('version', cacheVersion);

      const module = await import(url.href);

      const entries = getPluginEntries(module);

      let fileCommandCount = 0;

      for (const entry of entries) {
        const normalized = normalizePlugin(
          entry,
          filename
        );

        loadedPlugins.push(...normalized);

        fileCommandCount += normalized.length;
      }

      console.log(
        `[PLUGINS] Loaded ${filename} (${fileCommandCount} commands)`
      );

    } catch (error) {
      failedFiles.push({
        filename,
        error: error.message || String(error)
      });

      console.error(
        `[PLUGINS] Failed to load ${filename}:`,
        error
      );
    }
  }

  // ----------------------------------------------
  // PROTECT EXISTING REGISTRY ON FAILED RELOAD
  // ----------------------------------------------

  const previousRegistryExists =
    Number(globalThis.pluginStats?.version) > 0;

  if (failedFiles.length && previousRegistryExists) {
    console.error(
      '[PLUGINS] Reload incomplete. Keeping the previous working registry.'
    );

    globalThis.pluginStats = {
      ...globalThis.pluginStats,
      attemptedFiles: files.length,
      failedFiles: failedFiles.length,
      failed: failedFiles,
      lastReloadFailed: true,
      lastAttemptAt: Date.now()
    };

    return globalThis.plugins || [];
  }

  // ----------------------------------------------
  // BUILD NEW REGISTRY
  // ----------------------------------------------

  const registry = buildRegistry(loadedPlugins);

  // Publish the complete registry together.
  globalThis.plugins = registry.plugins;
  globalThis.commandMap = registry.commandMap;

  registryVersion++;

  globalThis.pluginStats = {
    ...registry.statistics,

    totalFiles: files.length,

    attemptedFiles: files.length,

    failedFiles: failedFiles.length,

    failed: failedFiles,

    version: registryVersion,

    loadedAt: Date.now(),

    lastReloadFailed: false
  };

  // ----------------------------------------------
  // LOADING SUMMARY
  // ----------------------------------------------

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(
    `🤖 ${globalThis.config?.botName || 'PRECIOUS-MD'}`
  );

  console.log(`📁 Plugin files: ${files.length}`);

  console.log(
    `🧩 Primary commands: ${registry.statistics.primaryCommands}`
  );

  console.log(
    `🔗 Commands + aliases: ${registry.commandMap.size}`
  );

  console.log(
    `📂 Categories: ${Object.keys(registry.statistics.categories).length}`
  );

  console.log(
    `⚠ Duplicate commands: ${registry.statistics.duplicateCommands}`
  );

  console.log(
    `⚠ Duplicate aliases: ${registry.statistics.duplicateAliases}`
  );

  console.log(`❌ Failed files: ${failedFiles.length}`);

  console.log(`🔄 Registry version: ${registryVersion}`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return registry.plugins;
}

// --------------------------------------------------
// PUBLIC PLUGIN LOADER
// --------------------------------------------------

export function loadPlugins() {
  // Concurrent calls share the same loading operation.
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = performPluginLoad()
    .catch(error => {
      console.error(
        '[PLUGINS] Plugin loading failed:',
        error
      );

      throw error;
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

// --------------------------------------------------
// COMMAND LOOKUP
// --------------------------------------------------

export function getPlugin(command) {
  const normalized = normalizeCommand(command);

  if (!normalized) {
    return null;
  }

  return globalThis.commandMap?.get(normalized) || null;
}

// --------------------------------------------------
// PLUGIN STATISTICS
// --------------------------------------------------

export function getPluginStats() {
  return globalThis.pluginStats || {
    primaryCommands: 0,
    aliases: 0,
    duplicateCommands: 0,
    duplicateAliases: 0,
    categories: {},
    files: 0,
    totalFiles: 0,
    attemptedFiles: 0,
    failedFiles: 0,
    failed: [],
    version: registryVersion,
    lastReloadFailed: false
  };
}

// --------------------------------------------------
// RELOAD PLUGINS
// --------------------------------------------------

export async function reloadPlugins() {
  console.log('[PLUGINS] Reloading plugins...');

  return loadPlugins();
}

// --------------------------------------------------
// PLUGIN STATUS
// --------------------------------------------------

export function isPluginLoading() {
  return loadingPromise !== null;
}
