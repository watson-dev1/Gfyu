
import config from '../config.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { sendQuickButtons } from '../lib/buttons.js';

// ==================================================
// PRECIOUS-MD MENU CONFIGURATION
// ==================================================

const categories = {
  general: 'General',
  owner: 'Owner',
  group: 'Group',
  tools: 'Tools',
  sticker: 'Sticker',
  media: 'Media',
  ai: 'Artificial Intelligence',
  fun: 'Entertainment',
  games: 'Games',
  utility: 'Utilities'
};

const MENU_IMAGE = path.join(
  process.cwd(),
  'media',
  'watson.jpg'
);

// ==================================================
// PLUGIN HELPERS
// ==================================================

function getPlugins() {
  return (globalThis.plugins || []).filter(plugin =>
    plugin && typeof plugin.command === 'string'
  );
}

function normalizeCategory(category) {
  return String(category || 'general').toLowerCase();
}

function getCategoryPlugins(category) {
  return getPlugins()
    .filter(plugin =>
      normalizeCategory(plugin.category) === category
    )
    .sort((a, b) =>
      a.command.localeCompare(b.command)
    );
}

function getCommandCount() {
  return globalThis.commandMap instanceof Map
    ? globalThis.commandMap.size
    : getPlugins().reduce(
        (total, plugin) =>
          total + 1 + (plugin.aliases?.length || 0),
        0
      );
}

// ==================================================
// DYNAMIC COMMAND MENU
// ==================================================

function makeMenu() {
  const grouped = new Map();

  for (const plugin of getPlugins()) {
    const category = normalizeCategory(plugin.category);

    if (!grouped.has(category)) {
      grouped.set(category, new Set());
    }

    grouped.get(category).add(plugin.command);
  }

  const sections = [];

  for (const [category, commands] of grouped) {
    const title =
      categories[category] || category.toUpperCase();

    sections.push(
      `\n╭━━〔 *${title.toUpperCase()}* 〕━━╮\n` +
      [...commands]
        .sort()
        .map(command =>
          `┃ ${config.prefix}${command}`
        )
        .join('\n') +
      '\n╰━━━━━━━━━━━━━━━━━━╯'
    );
  }

  return sections.join('\n');
}

// ==================================================
// MENU IMAGE
// ==================================================

async function getMenuImage() {
  try {
    return await fs.readFile(MENU_IMAGE);
  } catch (error) {
    console.error(
      '[PRECIOUS MENU IMAGE]',
      error.message
    );

    return null;
  }
}

// ==================================================
// QUICK BUTTON NAVIGATION
// ==================================================

async function sendNavigation(ctx, buttons) {
  return sendQuickButtons(
    ctx.sock,
    ctx.chat,
    {
      title: 'PRECIOUS-MD NAVIGATION',
      body: 'Choose another section:',
      footer: 'Created by Watson Fourpence',
      quoted: ctx.msg,
      buttons
    }
  );
}

function categoryButtons() {
  return [
    {
      text: 'GENERAL',
      id: `${config.prefix}generalmenu`
    },
    {
      text: 'GROUP',
      id: `${config.prefix}groupmenu`
    },
    {
      text: 'TOOLS',
      id: `${config.prefix}toolsmenu`
    }
  ];
}

function allCategoryButtons() {
  return [
    { text: 'GENERAL', id: `${config.prefix}generalmenu` },
    { text: 'OWNER', id: `${config.prefix}ownermenu` },
    { text: 'GROUP', id: `${config.prefix}groupmenu` }
  ];
}

// ==================================================
// SHOW CATEGORY
// ==================================================

async function showCategory(ctx, category) {
  const plugins = getCategoryPlugins(category);

  const title =
    categories[category] || category.toUpperCase();

  if (!plugins.length) {
    return ctx.reply(
      `📂 *${title.toUpperCase()}*\n\n` +
      'No commands are currently registered in this category.'
    );
  }

  const output = plugins.map(plugin =>
    `┃ ${config.prefix}${plugin.command}\n` +
    `┃ ${plugin.description || 'No description available'}`
  );

  await ctx.reply(
    `╭━━〔 *${title.toUpperCase()}* 〕━━╮\n\n` +
    output.join('\n\n') +
    `\n\n╰━━━━━━━━━━━━━━━━━━╯\n` +
    `_Commands: ${plugins.length}_`
  );

  await sendNavigation(ctx, [
    {
      text: 'MAIN MENU',
      id: `${config.prefix}menu`
    },
    {
      text: 'GENERAL',
      id: `${config.prefix}generalmenu`
    },
    {
      text: 'TOOLS',
      id: `${config.prefix}toolsmenu`
    }
  ]);
}

// ==================================================
// CATEGORY COMMANDS
// ==================================================

const categoryCommands = [
  ['generalmenu', 'general', 'Show general commands'],
  ['ownermenu', 'owner', 'Show owner commands'],
  ['groupmenu', 'group', 'Show group commands'],
  ['toolsmenu', 'tools', 'Show tools commands'],
  ['stickermenu', 'sticker', 'Show sticker commands'],
  ['mediamenu', 'media', 'Show media commands'],
  ['aimenu', 'ai', 'Show artificial intelligence commands'],
  ['funmenu', 'fun', 'Show entertainment commands'],
  ['gamesmenu', 'games', 'Show games commands'],
  ['utilitymenu', 'utility', 'Show utility commands']
].map(([command, category, description]) => ({
  command,
  category: 'general',
  description,

  run: ctx =>
    showCategory(ctx, category)
}));

// ==================================================
// MAIN MENU CAPTION
// ==================================================

function makeMainMenu() {
  const total = getCommandCount();

  return (
    `╭━━〔 *${config.botName}* 〕━━╮\n` +
    `┃ 👑 Creator: ${config.ownerName}\n` +
    `┃ ⚡ Prefix: ${config.prefix}\n` +
    `┃ ⏱ Runtime: ${Math.floor(process.uptime())} seconds\n` +
    `┃ 🧩 Commands: ${total}\n` +
    `┃ 🌐 Mode: ${config.publicMode ? 'PUBLIC' : 'PRIVATE'}\n` +
    `╰━━━━━━━━━━━━━━━━━━╯\n` +
    makeMenu() +
    `\n\n_Powered by Watson Fourpence_`
  );
}

// ==================================================
// SEND MAIN MENU
// ==================================================

async function sendMainMenu(ctx) {
  const caption = makeMainMenu().slice(0, 65000);
  const image = await getMenuImage();

  if (image) {
    await ctx.sock.sendMessage(
      ctx.chat,
      {
        image,
        caption
      },
      {
        quoted: ctx.msg
      }
    );
  } else {
    await ctx.reply(caption);
  }

  await sendQuickButtons(
    ctx.sock,
    ctx.chat,
    {
      title: 'PRECIOUS-MD NAVIGATION',
      body: 'Choose a category to explore:',
      footer: 'Created by Watson Fourpence',
      quoted: ctx.msg,
      buttons: categoryButtons()
    }
  );
}

// ==================================================
// EXPORT MENU PLUGINS
// ==================================================

export default [

  // ==================================================
  // MAIN MENU
  // ==================================================

  {
    command: 'menu',
    aliases: ['help', 'commands', 'list'],
    category: 'general',
    description: 'Display all available commands',

    run: async ctx => {
      try {
        await sendMainMenu(ctx);
      } catch (error) {
        console.error('[PRECIOUS MAIN MENU]', error);

        await ctx.reply(
          makeMainMenu().slice(0, 65000)
        );
      }
    }
  },

  // ==================================================
  // HELP
  // ==================================================

  {
    command: 'helpme',
    aliases: ['commandhelp'],
    category: 'general',
    description: 'Explain how to use PRECIOUS-MD commands',

    run: async ctx => {
      await ctx.reply(
        `📚 *PRECIOUS-MD HELP*\n\n` +
        `1. Commands begin with ${config.prefix}.\n` +
        `2. Use ${config.prefix}menu to view commands.\n` +
        `3. Use ${config.prefix}find <command> to search.\n` +
        `4. Use ${config.prefix}categories to browse categories.\n` +
        `5. Reply to supported media with the relevant command.\n\n` +
        `*Examples:*\n` +
        `${config.prefix}ping\n` +
        `${config.prefix}sticker\n` +
        `${config.prefix}groupinfo\n\n` +
        `Creator: ${config.ownerName}`
      );
    }
  },

  // ==================================================
  // FIND COMMAND
  // ==================================================

  {
    command: 'find',
    aliases: ['searchcmd'],
    category: 'general',
    description: 'Search for a command',

    run: async ctx => {
      const query = String(ctx.q || '')
        .trim()
        .toLowerCase();

      if (!query) {
        return ctx.reply(
          `Usage: ${config.prefix}find sticker`
        );
      }

      const matches = getPlugins().filter(plugin =>
        plugin.command.toLowerCase().includes(query) ||
        plugin.description?.toLowerCase().includes(query) ||
        (plugin.aliases || []).some(alias =>
          alias.toLowerCase().includes(query)
        )
      );

      if (!matches.length) {
        return ctx.reply(
          'No matching commands found.'
        );
      }

      await ctx.reply(
        `🔎 *COMMAND SEARCH*\n\n` +
        matches.slice(0, 30).map(plugin =>
          `• ${config.prefix}${plugin.command}\n` +
          `  ${plugin.description || 'No description'}`
        ).join('\n\n') +
        `\n\nFound: ${matches.length}`
      );
    }
  },

  // ==================================================
  // CATEGORIES
  // ==================================================

  {
    command: 'categories',
    aliases: ['cmdcategories'],
    category: 'general',
    description: 'List command categories',

    run: async ctx => {
      const counts = {};

      for (const plugin of getPlugins()) {
        const category =
          normalizeCategory(plugin.category);

        counts[category] =
          (counts[category] || 0) + 1;
      }

      const output = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, count]) =>
          `• ${categories[category] || category}: ${count} commands`
        );

      await ctx.reply(
        `📂 *COMMAND CATEGORIES*\n\n` +
        (output.join('\n') || 'No commands registered.')
      );

      await sendNavigation(ctx, allCategoryButtons());
    }
  },

  // ==================================================
  // CATEGORY PLUGINS
  // ==================================================

  ...categoryCommands

];
