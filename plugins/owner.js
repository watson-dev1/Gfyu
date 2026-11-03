
import fs from 'node:fs/promises';
import path from 'node:path';

import { saveDatabase } from '../lib/database.js';
import { loadPlugins } from '../lib/plugin-loader.js';
import { runtime } from '../lib/utils.js';

export default [
  {
    command: 'mode',
    aliases: ['botmode'],
    owner: true,
    category: 'owner',
    description: 'Change bot public/private mode',
    run: async ctx => {
      const mode = ctx.q.toLowerCase();

      if (!['public', 'private'].includes(mode)) {
        return ctx.reply(
          `Current mode: ${config.publicMode ? 'PUBLIC' : 'PRIVATE'}\n` +
          'Usage: .mode public or .mode private'
        );
      }

      config.publicMode = mode === 'public';

      await ctx.reply(`✅ Bot mode changed to ${mode.toUpperCase()}.`);
    }
  },

  {
    command: 'setprefix',
    aliases: ['prefixset'],
    owner: true,
    category: 'owner',
    description: 'Change the command prefix',
    run: async ctx => {
      const prefix = ctx.q.trim();

      if (!prefix || prefix.length > 5 || /\s/.test(prefix)) {
        return ctx.reply('Usage: .setprefix !');
      }

      config.prefix = prefix;
      config.prefixes = [prefix];

      globalThis.db.settings.prefix = prefix;
      await saveDatabase();

      await ctx.reply(
        `✅ Prefix changed to: ${prefix}\n` +
        `Example: ${prefix}menu`
      );
    }
  },

  {
    command: 'broadcast',
    aliases: ['bc', 'announceall'],
    owner: true,
    category: 'owner',
    description: 'Send an announcement to saved chats',
    cooldown: 30,
    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply('Usage: .broadcast Your announcement');
      }

      const destinations = [
        ...new Set([
          ...Object.keys(globalThis.db.chats || {}),
          ...Object.keys(globalThis.db.groups || {})
        ])
      ].filter(jid =>
        jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us')
      );

      if (!destinations.length) {
        return ctx.reply('No saved chats are available.');
      }

      await ctx.reply(
        `📢 Sending announcement to ${destinations.length} saved chats...`
      );

      let sent = 0;
      let failed = 0;

      for (const jid of destinations) {
        try {
          await ctx.sock.sendMessage(jid, {
            text: `📢 *${config.botName} ANNOUNCEMENT*\n\n${ctx.q}\n\n_${config.ownerName}_`
          });

          sent++;
        } catch {
          failed++;
        }

        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      await ctx.reply(
        `📢 Broadcast finished.\n\n` +
        `✅ Sent: ${sent}\n` +
        `❌ Failed: ${failed}`
      );
    }
  },

  {
    command: 'pluginreload',
    aliases: ['reloadplugins', 'refreshplugins'],
    owner: true,
    category: 'owner',
    description: 'Reload all bot plugins',
    cooldown: 5,
    run: async ctx => {
      const plugins = await loadPlugins();

      await ctx.reply(
        `✅ Plugin reload complete.\n` +
        `Loaded commands: ${plugins.length}`
      );
    }
  },

  {
    command: 'restart',
    aliases: ['reboot'],
    owner: true,
    category: 'owner',
    description: 'Restart the bot process',
    run: async ctx => {
      await ctx.reply('♻️ PRECIOUS-MD is restarting...');

      setTimeout(() => process.exit(0), 1000);
    }
  },

  {
    command: 'botinfo',
    aliases: ['systeminfo'],
    owner: true,
    category: 'owner',
    description: 'Show bot system information',
    run: async ctx => {
      const memory = process.memoryUsage();

      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD SYSTEM* 〕━━╮\n` +
        `┃ Bot: ${config.botName}\n` +
        `┃ Creator: ${config.ownerName}\n` +
        `┃ Mode: ${config.publicMode ? 'Public' : 'Private'}\n` +
        `┃ Prefix: ${config.prefix}\n` +
        `┃ Runtime: ${runtime()}\n` +
        `┃ Node: ${process.version}\n` +
        `┃ Platform: ${process.platform}\n` +
        `┃ RAM: ${(memory.rss / 1024 / 1024).toFixed(2)} MB\n` +
        `┃ Commands: ${globalThis.plugins?.length || 0}\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  },

  {
    command: 'dbbackup',
    aliases: ['backupdb'],
    owner: true,
    category: 'owner',
    description: 'Send a JSON database backup',
    run: async ctx => {
      const file = path.resolve(config.databaseFile);

      try {
        const data = await fs.readFile(file);

        await ctx.send({
          document: data,
          mimetype: 'application/json',
          fileName: 'PRECIOUS-MD-database-backup.json',
          caption: '📦 PRECIOUS-MD JSON database backup'
        });
      } catch (error) {
        await ctx.reply(`Backup failed: ${error.message}`);
      }
    }
  },

  {
    command: 'ownerhelp',
    aliases: ['ownercmds'],
    owner: true,
    category: 'owner',
    description: 'List owner commands',
    run: async ctx => {
      await ctx.reply(
        `👑 *PRECIOUS-MD OWNER COMMANDS*\n\n` +
        `.mode public/private\n` +
        `.setprefix <symbol>\n` +
        `.broadcast <message>\n` +
        `.pluginreload\n` +
        `.restart\n` +
        `.botinfo\n` +
        `.dbbackup`
      );
    }
  }
];
