
import { sendQuickButtons } from '../lib/buttons.js';

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

function makeMenu() {
  const plugins = globalThis.plugins || [];
  const grouped = new Map();

  for (const plugin of plugins) {
    const category = plugin.category || 'general';

    if (!grouped.has(category)) grouped.set(category, new Set());
    grouped.get(category).add(plugin.command);
  }

  const sections = [];

  for (const [category, commands] of grouped) {
    const title = categories[category] || category.toUpperCase();

    sections.push(
      `\n╭━━〔 *${title.toUpperCase()}* 〕━━╮\n` +
      [...commands].sort().map(command =>
        `┃ ${config.prefix}${command}`
      ).join('\n') +
      '\n╰━━━━━━━━━━━━━━━━━━╯'
    );
  }

  return sections.join('\n');
}

export default [
  {
    command: 'menu',
    aliases: ['help', 'commands', 'list'],
    category: 'general',
    description: 'Display all available commands',

    run: async ctx => {
      const total = globalThis.plugins?.length || 0;

      const message =
        `╭━━〔 *${config.botName}* 〕━━╮\n` +
        `┃ 👑 Creator: ${config.ownerName}\n` +
        `┃ ⚡ Prefix: ${config.prefix}\n` +
        `┃ ⏱ Runtime: ${Math.floor(process.uptime())} seconds\n` +
        `┃ 🧩 Commands: ${total}\n` +
        `┃ 🌐 Mode: ${config.publicMode ? 'PUBLIC' : 'PRIVATE'}\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n` +
        makeMenu() +
        `\n\n_Powered by Watson Fourpence_`;

      await ctx.reply(message.slice(0, 65000));

      await sendQuickButtons(ctx.sock, ctx.chat, {
        title: 'PRECIOUS-MD NAVIGATION',
        body: 'Choose a category to explore:',
        footer: 'Created by Watson Fourpence',
        quoted: ctx.msg,
        buttons: [
          { text: 'GENERAL', id: `${config.prefix}generalmenu` },
          { text: 'GROUP', id: `${config.prefix}groupmenu` },
          { text: 'TOOLS', id: `${config.prefix}toolsmenu` }
        ]
      });
    }
  },

  {
    command: 'helpme',
    aliases: ['commandhelp'],
    category: 'general',
    description: 'Explain how to use PRECIOUS-MD commands',

    run: async ctx => {
      await ctx.reply(
        `📚 *PRECIOUS-MD HELP*\n\n` +
        `1. Commands begin with ${config.prefix}\n` +
        `2. Use ${config.prefix}menu to view commands.\n` +
        `3. Use ${config.prefix}find <command> to search.\n` +
        `4. Reply to supported media with the relevant command.\n\n` +
        `Example:\n${config.prefix}ping\n${config.prefix}sticker\n${config.prefix}groupinfo\n\n` +
        `Bot creator: ${config.ownerName}`
      );
    }
  },

  {
    command: 'find',
    aliases: ['searchcmd'],
    category: 'general',
    description: 'Search for a command',

    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .find sticker');

      const query = ctx.q.toLowerCase();

      const matches = (globalThis.plugins || []).filter(plugin =>
        plugin.command.includes(query) ||
        plugin.description?.toLowerCase().includes(query) ||
        (plugin.aliases || []).some(alias =>
          alias.toLowerCase().includes(query)
        )
      );

      if (!matches.length) {
        return ctx.reply('No matching commands found.');
      }

      await ctx.reply(
        `🔎 *COMMAND SEARCH*\n\n` +
        matches.slice(0, 30).map(plugin =>
          `• ${config.prefix}${plugin.command}\n` +
          `  ${plugin.description || 'No description'}`
        ).join('\n\n')
      );
    }
  },

  {
    command: 'categories',
    aliases: ['cmdcategories'],
    category: 'general',
    description: 'List command categories',

    run: async ctx => {
      const counts = {};

      for (const plugin of globalThis.plugins || []) {
        const category = plugin.category || 'general';
        counts[category] = (counts[category] || 0) + 1;
      }

      const output = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, count]) =>
          `• ${categories[category] || category}: ${count} commands`
        );

      await ctx.reply(
        `📂 *COMMAND CATEGORIES*\n\n${output.join('\n')}`
      );
    }
  }
];
