
import { saveDatabase } from '../lib/database.js';
import { runtime } from '../lib/utils.js';
import { sendQuickButtons } from '../lib/buttons.js';

export default [
  {
    command: 'panel',
    aliases: ['ownerpanel'],
    category: 'owner',
    description: 'Open the owner control panel',
    owner: true,
    run: async ctx => {
      await sendQuickButtons(ctx.sock, ctx.chat, {
        title: 'PRECIOUS-MD OWNER PANEL',
        body:
          `👑 Owner: ${config.ownerName}\n` +
          `🤖 Bot: ${config.botName}\n` +
          `⏱ Runtime: ${runtime()}\n\n` +
          `Select a control:`,
        quoted: ctx.msg,
        buttons: [
          { text: 'BOT INFO', id: `${config.prefix}botinfo` },
          { text: 'PLUGIN LIST', id: `${config.prefix}pluginlist` },
          { text: 'OWNER HELP', id: `${config.prefix}ownerhelp` }
        ]
      });
    }
  },

  {
    command: 'setmode',
    aliases: ['mode'],
    category: 'owner',
    description: 'Change public or private mode',
    owner: true,
    run: async ctx => {
      const mode = (ctx.q || '').toLowerCase();

      if (!['public', 'private'].includes(mode)) {
        return ctx.reply(`Usage: ${config.prefix}setmode public/private`);
      }

      config.publicMode = mode === 'public';
      globalThis.db.settings.publicMode = config.publicMode;

      await saveDatabase();

      await ctx.reply(`✅ Bot mode changed to *${mode.toUpperCase()}*.`);
    }
  },

  {
    command: 'setprefix',
    aliases: [],
    category: 'owner',
    description: 'Change the command prefix',
    owner: true,
    run: async ctx => {
      const prefix = ctx.q.trim();

      if (!prefix || prefix.length > 3 || /\s/.test(prefix)) {
        return ctx.reply(`Usage: ${config.prefix}setprefix !`);
      }

      config.prefix = prefix;
      config.prefixes = [prefix];

      globalThis.db.settings.prefix = prefix;
      await saveDatabase();

      await ctx.reply(`✅ Prefix changed to *${prefix}*.`);
    }
  },

  {
    command: 'botinfo',
    aliases: ['systeminfo'],
    category: 'owner',
    description: 'Show bot system information',
    owner: true,
    run: async ctx => {
      const memory = process.memoryUsage();

      await ctx.reply(
        `🤖 *PRECIOUS-MD SYSTEM*\n\n` +
        `Name: ${config.botName}\n` +
        `Creator: ${config.ownerName}\n` +
        `Runtime: ${runtime()}\n` +
        `Node: ${process.version}\n` +
        `Platform: ${process.platform}\n` +
        `RAM: ${(memory.rss / 1024 / 1024).toFixed(1)} MB\n` +
        `Plugins: ${globalThis.plugins?.length || 0}\n` +
        `Commands: ${globalThis.commandMap?.size || 0}\n` +
        `Mode: ${config.publicMode ? 'PUBLIC' : 'PRIVATE'}`
      );
    }
  },

  {
    command: 'dbbackup',
    aliases: ['backupdb'],
    category: 'owner',
    description: 'Create a JSON database backup',
    owner: true,
    run: async ctx => {
      const backup = JSON.stringify(globalThis.db, null, 2);

      await ctx.sock.sendMessage(ctx.chat, {
        document: Buffer.from(backup),
        mimetype: 'application/json',
        fileName: `precious-md-backup-${Date.now()}.json`,
        caption: 'PRECIOUS-MD database backup'
      }, { quoted: ctx.msg });
    }
  },

  {
    command: 'ownerhelp',
    aliases: [],
    category: 'owner',
    description: 'Show owner commands',
    owner: true,
    run: async ctx => {
      await ctx.reply(
        `👑 *OWNER COMMANDS*\n\n` +
        `.panel — Owner panel\n` +
        `.setmode public/private — Bot mode\n` +
        `.setprefix ! — Change prefix\n` +
        `.botinfo — System information\n` +
        `.pluginreload — Reload plugins\n` +
        `.dbbackup — Download database backup\n` +
        `.restart — Restart bot through host`
      );
    }
  }
];
