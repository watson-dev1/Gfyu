
import os from 'node:os';
import { runtime, formatBytes } from '../lib/utils.js';

const pick = items => items[Math.floor(Math.random() * items.length)];

export default [
  {
    command: 'time',
    aliases: ['clock'],
    category: 'utility',
    description: 'Show current server time',
    run: async ctx => {
      await ctx.reply(
        `🕒 *SERVER TIME*\n\n` +
        `${new Date().toLocaleString('en-GB', {
          timeZone: 'Africa/Harare',
          dateStyle: 'full',
          timeStyle: 'medium'
        })}\n\nTimezone: Africa/Harare`
      );
    }
  },

  {
    command: 'date',
    aliases: ['today'],
    category: 'utility',
    description: "Show today's date",
    run: async ctx => {
      await ctx.reply(
        new Date().toLocaleDateString('en-GB', {
          timeZone: 'Africa/Harare',
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      );
    }
  },

  {
    command: 'server',
    aliases: ['serverinfo'],
    category: 'utility',
    description: 'Show server information',
    run: async ctx => {
      await ctx.reply(
        `🖥️ *SERVER INFORMATION*\n\n` +
        `OS: ${os.type()} ${os.release()}\n` +
        `Platform: ${os.platform()}\n` +
        `Architecture: ${os.arch()}\n` +
        `CPUs: ${os.cpus().length}\n` +
        `Total RAM: ${formatBytes(os.totalmem())}\n` +
        `Free RAM: ${formatBytes(os.freemem())}\n` +
        `Uptime: ${runtime(os.uptime())}\n` +
        `Node.js: ${process.version}`
      );
    }
  },

  {
    command: 'memory',
    aliases: ['ram'],
    category: 'utility',
    description: 'Show bot memory usage',
    run: async ctx => {
      const memory = process.memoryUsage();

      await ctx.reply(
        `🧠 *BOT MEMORY*\n\n` +
        `RSS: ${formatBytes(memory.rss)}\n` +
        `Heap used: ${formatBytes(memory.heapUsed)}\n` +
        `Heap total: ${formatBytes(memory.heapTotal)}\n` +
        `External: ${formatBytes(memory.external)}`
      );
    }
  },

  {
    command: 'quote',
    aliases: ['inspire'],
    category: 'utility',
    description: 'Get a motivational quote',
    run: async ctx => {
      const quotes = [
        'Great things are done by a series of small things brought together.',
        'Success is the sum of small efforts repeated every day.',
        'The secret of getting ahead is getting started.',
        'Do something today that your future self will thank you for.',
        'It always seems impossible until it is done.'
      ];

      await ctx.reply(`✨ *DAILY QUOTE*\n\n_${pick(quotes)}_`);
    }
  },

  {
    command: 'emoji',
    aliases: ['emojify'],
    category: 'utility',
    description: 'Add spacing between characters',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .emoji Watson');

      await ctx.reply([...ctx.q].join(' '));
    }
  },

  {
    command: 'text',
    aliases: ['saytext'],
    category: 'utility',
    description: 'Repeat supplied text',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .text Hello everyone');

      await ctx.reply(ctx.q.slice(0, 3000));
    }
  },

  {
    command: 'profile',
    aliases: ['myprofile'],
    category: 'utility',
    description: 'Show your bot user profile',
    run: async ctx => {
      await ctx.reply(
        `👤 *YOUR PROFILE*\n\n` +
        `Number: ${ctx.sender.split('@')[0]}\n` +
        `Warnings: ${ctx.user.warnings || 0}\n` +
        `Premium: ${ctx.user.premium ? 'YES' : 'NO'}\n` +
        `Banned: ${ctx.user.banned ? 'YES' : 'NO'}\n` +
        `Joined: ${new Date(ctx.user.createdAt).toLocaleDateString()}`
      );
    }
  },

  {
    command: 'bot',
    aliases: ['aboutbot'],
    category: 'utility',
    description: 'Show bot credits',
    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *${config.botName}* 〕━━╮\n` +
        `┃ WhatsApp automation bot\n` +
        `┃ Creator: ${config.ownerName}\n` +
        `┃ Version: 3.0.0\n` +
        `┃ Database: JSON\n` +
        `┃ Runtime: ${runtime()}\n` +
        `╰━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  }
];
