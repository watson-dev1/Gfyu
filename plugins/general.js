
import {
  runtime,
  cleanNumber,
  getMentioned,
  getQuotedParticipant,
  getQuotedMessage,
  unwrapMessage
} from '../lib/utils.js';

import { saveDatabase } from '../lib/database.js';
import { groupTarget } from '../lib/admin.js';

function safeCalculate(expression) {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/%^]/g);

  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) {
    throw new Error('Only arithmetic expressions are allowed.');
  }

  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function primary() {
    const token = take();

    if (token === '+') return primary();
    if (token === '-') return -primary();

    if (token === '(') {
      const result = addition();
      if (take() !== ')') throw new Error('Missing closing bracket.');
      return result;
    }

    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('Invalid number.');

    return value;
  }

  function power() {
    const value = primary();
    if (peek() === '^') {
      take();
      return value ** power();
    }
    return value;
  }

  function multiply() {
    let value = power();

    while (['*', '/', '%'].includes(peek())) {
      const operator = take();
      const right = power();

      if (right === 0 && operator !== '*') {
        throw new Error('Cannot divide by zero.');
      }

      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;
    }

    return value;
  }

  function addition() {
    let value = multiply();

    while (['+', '-'].includes(peek())) {
      const operator = take();
      const right = multiply();

      value = operator === '+' ? value + right : value - right;
    }

    return value;
  }

  const result = addition();

  if (position !== tokens.length || !Number.isFinite(result)) {
    throw new Error('Invalid expression.');
  }

  return result;
}

export default [
  {
    command: 'ping',
    aliases: ['speed'],
    category: 'general',
    description: 'Check bot response speed',
    run: async ctx => {
      const start = Date.now();
      await ctx.react('⚡');
      await ctx.reply(`🏓 Pong: ${Date.now() - start} ms`);
    }
  },

  {
    command: 'alive',
    aliases: ['status'],
    category: 'general',
    description: 'Check bot status',
    run: async ctx => {
      await ctx.reply(
        `✅ *${config.botName} ONLINE*\n\n` +
        `⏱ Runtime: ${runtime()}\n` +
        `🧩 Commands: ${globalThis.plugins?.length || 0}\n` +
        `👑 Creator: ${config.ownerName}`
      );
    }
  },

  {
    command: 'owner',
    aliases: ['creator'],
    category: 'general',
    description: 'Show bot owner information',
    run: async ctx => {
      await ctx.reply(
        `👑 *${config.ownerName}*\n` +
        `📱 ${config.ownerNumber || 'Owner number not configured'}`
      );
    }
  },

  {
    command: 'runtime',
    aliases: ['uptime'],
    category: 'general',
    description: 'Show bot uptime',
    run: async ctx => ctx.reply(runtime())
  },

  {
    command: 'stats',
    aliases: ['botstats'],
    category: 'general',
    description: 'Show bot usage statistics',
    run: async ctx => {
      const stats = globalThis.db.stats;

      await ctx.reply(
        `📊 *BOT STATISTICS*\n\n` +
        `Messages: ${stats.messages}\n` +
        `Commands: ${stats.commands}\n` +
        `Errors: ${stats.errors || 0}\n` +
        `Users: ${Object.keys(db.users).length}\n` +
        `Groups: ${Object.keys(db.groups).length}\n` +
        `Plugins: ${globalThis.plugins?.length || 0}`
      );
    }
  },

  {
    command: 'jid',
    aliases: ['id'],
    category: 'general',
    description: 'Show chat and sender JIDs',
    run: async ctx => {
      await ctx.reply(
        `Chat: ${ctx.chat}\n` +
        `Sender: ${ctx.sender}\n` +
        `Number: ${cleanNumber(ctx.sender)}`
      );
    }
  },

  {
    command: 'pluginlist',
    aliases: ['plugins'],
    category: 'general',
    description: 'List loaded commands',
    run: async ctx => {
      const list = globalThis.plugins || [];

      await ctx.reply(
        `🧩 *LOADED COMMANDS: ${list.length}*\n\n` +
        list.map(plugin => `${config.prefix}${plugin.command}`).join(', ')
      );
    }
  },

  {
    command: 'calc',
    aliases: ['math'],
    category: 'tools',
    description: 'Calculate arithmetic expressions',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .calc (10 + 5) * 2');

      try {
        const result = safeCalculate(ctx.q);
        await ctx.reply(`🧮 ${ctx.q} = *${result}*`);
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  {
    command: 'quoted',
    aliases: ['q'],
    category: 'general',
    description: 'Show replied message text',
    run: async ctx => {
      const quoted = getQuotedMessage(ctx.msg);

      if (!quoted) return ctx.reply('Reply to a message first.');

      const text = (
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        quoted.documentMessage?.caption ||
        '[Media message]'
      );

      await ctx.reply(`📝 *QUOTED MESSAGE*\n\n${text}`);
    }
  },

  {
    command: 'tagall',
    aliases: ['everyone'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Mention all group members',
    cooldown: 10,
    run: async ctx => {
      const meta = await ctx.sock.groupMetadata(ctx.chat);
      const participants = (meta.participants || []).slice(0, 100);

      const mentions = participants.map(p => p.id);
      const body = mentions.map(jid => `┃ @${jid.split('@')[0]}`).join('\n');

      await ctx.send({
        text: `📢 *GROUP ANNOUNCEMENT*\n${ctx.q ? `${ctx.q}\n\n` : ''}${body}`,
        mentions
      });
    }
  },

  {
    command: 'hidetag',
    aliases: ['notify'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Mention all members without displaying their names',
    run: async ctx => {
      const meta = await ctx.sock.groupMetadata(ctx.chat);

      await ctx.send({
        text: ctx.q || '📢 Attention everyone.',
        mentions: (meta.participants || []).map(p => p.id)
      });
    }
  },

  {
    command: 'link',
    aliases: ['grouplink'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Get the group invite link',
    run: async ctx => {
      const code = await ctx.sock.groupInviteCode(ctx.chat);
      await ctx.reply(`🔗 https://chat.whatsapp.com/${code}`);
    }
  },

  {
    command: 'group',
    aliases: ['gc'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Open or close group messaging',
    run: async ctx => {
      const mode = ctx.q.toLowerCase();

      if (!['open', 'close'].includes(mode)) {
        return ctx.reply('Usage: .group open or .group close');
      }

      const setting = mode === 'open'
        ? 'not_announcement'
        : 'announcement';

      await ctx.sock.groupSettingUpdate(ctx.chat, setting);
      await ctx.reply(`✅ Group successfully ${mode === 'open' ? 'opened' : 'closed'}.`);
    }
  },

  {
    command: 'promote',
    aliases: [],
    group: true,
    admin: true,
    category: 'group',
    description: 'Promote a group member',
    run: async ctx => {
      const target = await groupTarget(ctx);
      if (!target) return;

      await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'promote');
      await ctx.reply('✅ Promotion request sent.');
    }
  },

  {
    command: 'demote',
    aliases: [],
    group: true,
    admin: true,
    category: 'group',
    description: 'Remove group admin privileges',
    run: async ctx => {
      const target = await groupTarget(ctx);
      if (!target) return;

      await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'demote');
      await ctx.reply('✅ Demotion request sent.');
    }
  },

  {
    command: 'kick',
    aliases: ['remove'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Remove a group member',
    run: async ctx => {
      const target = await groupTarget(ctx);
      if (!target) return;

      await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'remove');
      await ctx.reply('✅ Removal request sent.');
    }
  },

  {
    command: 'add',
    aliases: [],
    group: true,
    admin: true,
    category: 'group',
    description: 'Request to add a member',
    run: async ctx => {
      const number = ctx.q.replace(/\D/g, '');

      if (number.length < 7 || number.length > 15) {
        return ctx.reply('Usage: .add 2637XXXXXXXX');
      }

      const target = `${number}@s.whatsapp.net`;

      await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'add');
      await ctx.reply('Add request submitted. WhatsApp may require an invitation.');
    }
  },

  {
    command: 'ownerinfo',
    aliases: [],
    category: 'general',
    description: 'Show creator and bot information',
    run: async ctx => {
      await ctx.reply(
        `Creator: ${config.ownerName}\nBot: ${config.botName}`
      );
    }
  }
];
