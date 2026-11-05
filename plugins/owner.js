
import fs from 'node:fs/promises';
import path from 'node:path';

import config from '../config.js';

import { saveDatabase } from '../lib/database.js';
import { loadPlugins } from '../lib/plugin-loader.js';
import { runtime } from '../lib/utils.js';

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function getCommandCount() {
  return globalThis.commandMap instanceof Map
    ? globalThis.commandMap.size
    : globalThis.plugins?.length || 0;
}

function getSavedDestinations() {
  const chats = globalThis.db?.chats || {};
  const groups = globalThis.db?.groups || {};

  return [
    ...new Set([
      ...Object.keys(chats),
      ...Object.keys(groups)
    ])
  ].filter(jid =>
    jid.endsWith('@s.whatsapp.net') ||
    jid.endsWith('@g.us')
  );
}

// --------------------------------------------------
// OWNER COMMANDS
// --------------------------------------------------

export default [

  // ------------------------------------------------
  // BOT MODE
  // ------------------------------------------------

  {
    command: 'mode',
    aliases: ['botmode'],
    owner: true,
    category: 'owner',
    description: 'Change bot public/private mode',

    run: async ctx => {
      const mode = ctx.q.trim().toLowerCase();

      if (!['public', 'private'].includes(mode)) {
        return ctx.reply(
          `Current mode: ${config.publicMode ? 'PUBLIC' : 'PRIVATE'}\n\n` +
          'Usage:\n' +
          '.mode public\n' +
          '.mode private'
        );
      }

      config.publicMode = mode === 'public';

      globalThis.db.settings ||= {};
      globalThis.db.settings.publicMode = config.publicMode;

      await saveDatabase();

      await ctx.reply(
        `✅ *BOT MODE UPDATED*\n\n` +
        `New mode: *${mode.toUpperCase()}*`
      );
    }
  },

  // ------------------------------------------------
  // SET PREFIX
  // ------------------------------------------------

  {
    command: 'setprefix',
    aliases: ['prefixset'],
    owner: true,
    category: 'owner',
    description: 'Change the command prefix',

    run: async ctx => {
      const prefix = ctx.q.trim();

      if (
        !prefix ||
        prefix.length > 5 ||
        /\s/.test(prefix)
      ) {
        return ctx.reply(
          'Usage: .setprefix !\n\n' +
          'Prefix must be 1-5 characters without spaces.'
        );
      }

      config.prefix = prefix;
      config.prefixes = [prefix];

      globalThis.db.settings ||= {};
      globalThis.db.settings.prefix = prefix;

      await saveDatabase();

      await ctx.reply(
        `✅ *PREFIX UPDATED*\n\n` +
        `New prefix: ${prefix}\n` +
        `Example: ${prefix}menu`
      );
    }
  },

  // ------------------------------------------------
  // BROADCAST
  // ------------------------------------------------

  {
    command: 'broadcast',
    aliases: ['bc', 'announceall'],
    owner: true,
    category: 'owner',
    description: 'Send an announcement to saved chats',
    cooldown: 30,

    run: async ctx => {
      const message = ctx.q.trim();

      if (!message) {
        return ctx.reply(
          'Usage: .broadcast Your announcement'
        );
      }

      if (message.length > 3000) {
        return ctx.reply(
          'Your announcement is too long. Maximum: 3000 characters.'
        );
      }

      const destinations = getSavedDestinations();

      if (!destinations.length) {
        return ctx.reply(
          'No saved chats are available.'
        );
      }

      await ctx.reply(
        `📢 *BROADCAST STARTED*\n\n` +
        `Destinations: ${destinations.length}\n` +
        `Please wait while messages are sent.`
      );

      let sent = 0;
      let failed = 0;

      for (const jid of destinations) {
        try {
          await ctx.sock.sendMessage(jid, {
            text:
              `📢 *${config.botName} ANNOUNCEMENT*\n\n` +
              `${message}\n\n` +
              `_ ${config.ownerName} _`
          });

          sent++;

        } catch (error) {
          failed++;

          console.error(
            `[BROADCAST] Failed for ${jid}:`,
            error.message
          );
        }

        // Avoid sending messages too rapidly.
        await sleep(1200);
      }

      await ctx.reply(
        `📢 *BROADCAST COMPLETED*\n\n` +
        `✅ Successfully sent: ${sent}\n` +
        `❌ Failed: ${failed}\n` +
        `📨 Total destinations: ${destinations.length}`
      );
    }
  },

  // ------------------------------------------------
  // RELOAD PLUGINS
  // ------------------------------------------------

  {
    command: 'pluginreload',
    aliases: ['reloadplugins', 'refreshplugins'],
    owner: true,
    category: 'owner',
    description: 'Reload all bot plugins',
    cooldown: 5,

    run: async ctx => {
      try {
        const plugins = await loadPlugins();

        await ctx.reply(
          `✅ *PLUGIN RELOAD COMPLETED*\n\n` +
          `Loaded plugins: ${plugins.length}\n` +
          `Registered commands: ${getCommandCount()}`
        );

      } catch (error) {
        console.error('[PLUGIN RELOAD]', error);

        await ctx.reply(
          `❌ Plugin reload failed.\n\n${error.message}`
        );
      }
    }
  },

  // ------------------------------------------------
  // RESTART BOT
  // ------------------------------------------------

  {
    command: 'restart',
    aliases: ['reboot'],
    owner: true,
    category: 'owner',
    description: 'Restart the bot process',

    run: async ctx => {
      await ctx.reply(
        '♻️ *PRECIOUS-MD RESTARTING*\n\n' +
        'The process will exit. Your hosting panel must restart it automatically.'
      );

      setTimeout(() => {
        process.exit(0);
      }, 1500);
    }
  },

  // ------------------------------------------------
  // BOT INFORMATION
  // ------------------------------------------------

  {
    command: 'botinfo',
    aliases: ['systeminfo'],
    owner: true,
    category: 'owner',
    description: 'Show bot system information',

    run: async ctx => {
      const memory = process.memoryUsage();

      const ram = (
        memory.rss / 1024 / 1024
      ).toFixed(2);

      const heap = (
        memory.heapUsed / 1024 / 1024
      ).toFixed(2);

      const commands = getCommandCount();

      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD SYSTEM* 〕━━╮\n` +
        `┃\n` +
        `┃ 🤖 Bot: ${config.botName}\n` +
        `┃ 👑 Creator: ${config.ownerName}\n` +
        `┃ 🔐 Mode: ${config.publicMode ? 'Public' : 'Private'}\n` +
        `┃ ⚡ Prefix: ${config.prefix}\n` +
        `┃ ⏱️ Runtime: ${runtime()}\n` +
        `┃ 📦 Node.js: ${process.version}\n` +
        `┃ 💻 Platform: ${process.platform}\n` +
        `┃ 🧠 RAM: ${ram} MB\n` +
        `┃ 📊 Heap: ${heap} MB\n` +
        `┃ 🧩 Commands: ${commands}\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  },

  // ------------------------------------------------
  // DATABASE BACKUP
  // ------------------------------------------------

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
          caption:
            '📦 *PRECIOUS-MD DATABASE BACKUP*\n\n' +
            `Created: ${new Date().toLocaleString()}`
        });

      } catch (error) {
        console.error('[DATABASE BACKUP]', error);

        await ctx.reply(
          `❌ Backup failed.\n\n${error.message}`
        );
      }
    }
  },

  // ------------------------------------------------
  // OWNER HELP
  // ------------------------------------------------

  {
    command: 'ownerhelp',
    aliases: ['ownercmds'],
    owner: true,
    category: 'owner',
    description: 'List owner commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD OWNER* 〕━━╮\n` +
        `┃\n` +
        `┃ .mode public/private\n` +
        `┃ .setprefix <symbol>\n` +
        `┃ .broadcast <message>\n` +
        `┃ .pluginreload\n` +
        `┃ .restart\n` +
        `┃ .botinfo\n` +
        `┃ .dbbackup\n` +
        `┃ .ownerhelp\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `👑 Created by ${config.ownerName}`
      );
    }
  }

];
