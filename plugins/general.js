
import config from '../config.js';

import {
  runtime,
  cleanNumber,
  getQuotedMessage,
  unwrapMessage
} from '../lib/utils.js';

import { groupTarget } from '../lib/admin.js';

// --------------------------------------------------
// SAFE CALCULATOR
// --------------------------------------------------

function safeCalculate(expression) {
  if (
    typeof expression !== 'string' ||
    !expression.trim() ||
    expression.length > 150
  ) {
    throw new Error('Enter an expression under 150 characters.');
  }

  const source = expression.replace(/\s+/g, '');

  const tokens = source.match(
    /(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%^]/g
  );

  if (
    !tokens ||
    tokens.join('') !== source
  ) {
    throw new Error('Only arithmetic expressions are allowed.');
  }

  let position = 0;

  const peek = () => tokens[position];

  const take = () => tokens[position++];

  function number() {
    const token = take();

    if (token === '(') {
      const result = addition();

      if (take() !== ')') {
        throw new Error('Missing closing bracket.');
      }

      return result;
    }

    if (token === undefined) {
      throw new Error('Unexpected end of expression.');
    }

    const value = Number(token);

    if (!Number.isFinite(value)) {
      throw new Error('Invalid number.');
    }

    return value;
  }

  // Exponentiation is right-associative.
  function power() {
    let value;

    if (peek() === '+') {
      take();
      value = unary();
    } else if (peek() === '-') {
      take();
      value = -unary();
    } else {
      value = number();
    }

    if (peek() === '^') {
      take();

      // Handle exponentiation without recursive stack growth.
      const exponent = unary();
      value = value ** exponent;
    }

    return value;
  }

  function unary() {
    if (peek() === '+') {
      take();
      return unary();
    }

    if (peek() === '-') {
      take();
      return -unary();
    }

    return power();
  }

  function multiply() {
    let value = unary();

    while (
      ['*', '/', '%'].includes(peek())
    ) {
      const operator = take();
      const right = unary();

      if (
        (operator === '/' || operator === '%') &&
        right === 0
      ) {
        throw new Error('Cannot divide by zero.');
      }

      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;

      if (!Number.isFinite(value)) {
        throw new Error('Calculation result is too large.');
      }
    }

    return value;
  }

  function addition() {
    let value = multiply();

    while (['+', '-'].includes(peek())) {
      const operator = take();
      const right = multiply();

      value = operator === '+'
        ? value + right
        : value - right;

      if (!Number.isFinite(value)) {
        throw new Error('Calculation result is too large.');
      }
    }

    return value;
  }

  const result = addition();

  if (
    position !== tokens.length ||
    !Number.isFinite(result)
  ) {
    throw new Error('Invalid arithmetic expression.');
  }

  return result;
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getPluginCount() {
  return Array.isArray(globalThis.plugins)
    ? globalThis.plugins.length
    : 0;
}

function getCommandCount() {
  return globalThis.commandMap instanceof Map
    ? globalThis.commandMap.size
    : getPluginCount();
}

function getDatabase() {
  if (!globalThis.db) {
    throw new Error('Database is not initialized.');
  }

  return globalThis.db;
}

function getParticipantJid(participant) {
  return participant?.id ||
    participant?.jid ||
    participant?.lid ||
    null;
}

function getParticipants(meta) {
  return Array.isArray(meta?.participants)
    ? meta.participants
    : [];
}

function getQuotedText(message) {
  if (!message) return null;

  const content = unwrapMessage(message);

  if (!content) return null;

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.audioMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    null
  );
}

async function getGroupMetadata(ctx) {
  if (!ctx.isGroup) {
    await ctx.reply('This command only works in groups.');
    return null;
  }

  try {
    return await ctx.sock.groupMetadata(ctx.chat);
  } catch (error) {
    console.error('[GENERAL] Group metadata error:', error.message);
    await ctx.reply('Unable to retrieve group information.');
    return null;
  }
}

function getMentionList(meta, limit = 100) {
  return getParticipants(meta)
    .map(getParticipantJid)
    .filter(jid => typeof jid === 'string' && jid.includes('@'))
    .slice(0, limit);
}

function getPrefix() {
  return config.prefix || '.';
}

// --------------------------------------------------
// GENERAL PLUGINS
// --------------------------------------------------

export default [

  // PING
  {
    command: 'ping',
    aliases: ['speed'],
    category: 'general',
    description: 'Check bot response speed',

    run: async ctx => {
      const start = Date.now();

      await ctx.react('⚡');

      const elapsed = Date.now() - start;

      await ctx.reply(
        `🏓 *PONG!*\n\n` +
        `⚡ Response: *${elapsed} ms*\n` +
        `🤖 ${config.botName || 'PRECIOUS-MD'}`
      );
    }
  },

  // ALIVE
  {
    command: 'alive',
    aliases: ['status'],
    category: 'general',
    description: 'Check bot status',

    run: async ctx => {
      await ctx.reply(
        `✅ *${config.botName || 'PRECIOUS-MD'} ONLINE*\n\n` +
        `⏱ Runtime: ${runtime()}\n` +
        `🧩 Plugins: ${getPluginCount()}\n` +
        `⚡ Commands: ${getCommandCount()}\n` +
        `👑 Creator: ${config.ownerName || 'Watson Fourpence'}\n\n` +
        `_Powered by Watson XD_`
      );
    }
  },

  // OWNER
  {
    command: 'owner',
    aliases: ['creator'],
    category: 'general',
    description: 'Show bot owner information',

    run: async ctx => {
      await ctx.reply(
        `👑 *BOT CREATOR*\n\n` +
        `Name: ${config.ownerName || 'Watson Fourpence'}\n` +
        `Number: ${config.ownerNumber || 'Not configured'}\n` +
        `Bot: ${config.botName || 'PRECIOUS-MD'}`
      );
    }
  },

  // RUNTIME
  {
    command: 'runtime',
    aliases: ['uptime'],
    category: 'general',
    description: 'Show bot uptime',

    run: async ctx => {
      await ctx.reply(
        `⏱ *BOT RUNTIME*\n\n${runtime()}`
      );
    }
  },

  // BOT STATISTICS
  {
    command: 'stats',
    aliases: ['botstats'],
    category: 'general',
    description: 'Show bot usage statistics',

    run: async ctx => {
      try {
        const db = getDatabase();

        const stats = db.stats || {};

        await ctx.reply(
          `📊 *PRECIOUS-MD STATISTICS*\n\n` +
          `📨 Messages: ${stats.messages || 0}\n` +
          `⚡ Commands: ${stats.commands || 0}\n` +
          `❌ Errors: ${stats.errors || 0}\n` +
          `👥 Users: ${Object.keys(db.users || {}).length}\n` +
          `👨‍👩‍👧‍👦 Groups: ${Object.keys(db.groups || {}).length}\n` +
          `🧩 Plugins: ${getPluginCount()}\n` +
          `📌 Commands loaded: ${getCommandCount()}\n` +
          `⏱ Runtime: ${runtime()}`
        );
      } catch (error) {
        console.error('[GENERAL] Stats error:', error.message);
        await ctx.reply('Unable to retrieve bot statistics.');
      }
    }
  },

  // JID
  {
    command: 'jid',
    aliases: ['id'],
    category: 'general',
    description: 'Show chat and sender JIDs',

    run: async ctx => {
      await ctx.reply(
        `🆔 *JID INFORMATION*\n\n` +
        `Chat: ${ctx.chat || 'Unknown'}\n` +
        `Sender: ${ctx.sender || 'Unknown'}\n` +
        `Number: ${cleanNumber(ctx.sender || '') || 'Unavailable'}`
      );
    }
  },

  // PLUGIN LIST
  {
    command: 'pluginlist',
    aliases: ['plugins'],
    category: 'general',
    description: 'List loaded plugins',

    run: async ctx => {
      const plugins = globalThis.plugins || [];

      if (!plugins.length) {
        return ctx.reply('No plugins are currently loaded.');
      }

      const list = plugins
        .map((plugin, index) => {
          const command = plugin.command || 'unknown';
          const category = plugin.category || 'general';

          return `${index + 1}. ${getPrefix()}${command} (${category})`;
        })
        .join('\n');

      const output =
        `🧩 *LOADED PLUGINS: ${plugins.length}*\n\n${list}`;

      if (output.length <= 3500) {
        return ctx.reply(output);
      }

      const chunks = [];
      let current = `🧩 *LOADED PLUGINS: ${plugins.length}*\n\n`;

      for (const line of list.split('\n')) {
        if (current.length + line.length > 3000) {
          chunks.push(current);
          current = '';
        }

        current += `${line}\n`;
      }

      if (current) chunks.push(current);

      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    }
  },

  // CALCULATOR
  {
    command: 'calc',
    aliases: ['math'],
    category: 'tools',
    description: 'Calculate arithmetic expressions',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          `🧮 *CALCULATOR*\n\n` +
          `Usage: ${getPrefix()}calc (10 + 5) * 2\n\n` +
          `Operators: + - * / % ^`
        );
      }

      try {
        const result = safeCalculate(ctx.q);

        await ctx.reply(
          `🧮 *CALCULATOR*\n\n` +
          `${ctx.q} = *${Number(result.toPrecision(12))}*`
        );
      } catch (error) {
        await ctx.reply(`❌ ${error.message}`);
      }
    }
  },

  // QUOTED MESSAGE
  {
    command: 'quoted',
    aliases: ['q'],
    category: 'general',
    description: 'Show replied message text',

    run: async ctx => {
      const quoted = getQuotedMessage(ctx.msg);

      if (!quoted) {
        return ctx.reply('Reply to a message first.');
      }

      const text = getQuotedText(quoted);

      await ctx.reply(
        `📝 *QUOTED MESSAGE*\n\n${text || '[Media or unsupported message]'}`
      );
    }
  },

  // TAG ALL
  {
    command: 'tagall',
    aliases: ['everyone'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Mention group members',
    cooldown: 10,

    run: async ctx => {
      const meta = await getGroupMetadata(ctx);
      if (!meta) return;

      const mentions = getMentionList(meta, 100);

      if (!mentions.length) {
        return ctx.reply('No group participants were found.');
      }

      const body = mentions
        .map(jid => `┃ @${jid.split('@')[0]}`)
        .join('\n');

      const message =
        `📢 *GROUP ANNOUNCEMENT*\n\n` +
        `${ctx.q ? `${ctx.q}\n\n` : ''}` +
        `${body}`;

      await ctx.send({
        text: message,
        mentions
      });
    }
  },

  // HIDETAG
  {
    command: 'hidetag',
    aliases: ['notify'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Notify group members without displaying their names',

    run: async ctx => {
      const meta = await getGroupMetadata(ctx);
      if (!meta) return;

      const mentions = getMentionList(meta, 100);

      if (!mentions.length) {
        return ctx.reply('No group participants were found.');
      }

      await ctx.send({
        text: ctx.q || '📢 Attention everyone.',
        mentions
      });
    }
  },

  // GROUP LINK
  {
    command: 'link',
    aliases: ['grouplink'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Get the group invite link',

    run: async ctx => {
      try {
        const code = await ctx.sock.groupInviteCode(ctx.chat);

        if (!code) {
          return ctx.reply('WhatsApp did not return an invite code.');
        }

        await ctx.reply(
          `🔗 *GROUP INVITE LINK*\n\n` +
          `https://chat.whatsapp.com/${code}`
        );
      } catch (error) {
        console.error('[GENERAL] Group link error:', error.message);
        await ctx.reply('Unable to retrieve the group invite link.');
      }
    }
  },

  // OPEN / CLOSE GROUP
  {
    command: 'group',
    aliases: ['gc'],
    group: true,
    admin: true,
    category: 'group',
    description: 'Open or close group messaging',

    run: async ctx => {
      const mode = String(ctx.q || '').trim().toLowerCase();

      if (!['open', 'close'].includes(mode)) {
        return ctx.reply(
          `Usage:\n${getPrefix()}group open\n${getPrefix()}group close`
        );
      }

      try {
        await ctx.sock.groupSettingUpdate(
          ctx.chat,
          mode === 'open'
            ? 'not_announcement'
            : 'announcement'
        );

        await ctx.reply(
          mode === 'open'
            ? '🔓 Group messaging is now open.'
            : '🔒 Group messaging is now restricted to admins.'
        );
      } catch (error) {
        console.error('[GENERAL] Group setting error:', error.message);
        await ctx.reply('Unable to update group settings.');
      }
    }
  },

  // PROMOTE
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

      try {
        await ctx.sock.groupParticipantsUpdate(
          ctx.chat,
          [target],
          'promote'
        );

        await ctx.reply('✅ Promotion request sent.');
      } catch (error) {
        console.error('[GENERAL] Promote error:', error.message);
        await ctx.reply('Unable to promote this participant.');
      }
    }
  },

  // DEMOTE
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

      try {
        await ctx.sock.groupParticipantsUpdate(
          ctx.chat,
          [target],
          'demote'
        );

        await ctx.reply('✅ Demotion request sent.');
      } catch (error) {
        console.error('[GENERAL] Demote error:', error.message);
        await ctx.reply('Unable to remove admin privileges.');
      }
    }
  },

  // KICK
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

      try {
        await ctx.sock.groupParticipantsUpdate(
          ctx.chat,
          [target],
          'remove'
        );

        await ctx.reply('✅ Removal request sent.');
      } catch (error) {
        console.error('[GENERAL] Kick error:', error.message);
        await ctx.reply('Unable to remove this participant.');
      }
    }
  },

  // ADD
  {
    command: 'add',
    aliases: [],
    group: true,
    admin: true,
    category: 'group',
    description: 'Add a participant to the group',

    run: async ctx => {
      const number = String(ctx.q || '').replace(/\D/g, '');

      if (number.length < 7 || number.length > 15) {
        return ctx.reply(
          `Usage: ${getPrefix()}add 2637XXXXXXXX`
        );
      }

      const target = `${number}@s.whatsapp.net`;

      try {
        await ctx.sock.groupParticipantsUpdate(
          ctx.chat,
          [target],
          'add'
        );

        await ctx.reply(
          '✅ Add request submitted. WhatsApp may require an invitation.'
        );
      } catch (error) {
        console.error('[GENERAL] Add error:', error.message);
        await ctx.reply(
          'Unable to add this number. The participant may need an invitation.'
        );
      }
    }
  },

  // OWNER INFORMATION
  {
    command: 'ownerinfo',
    aliases: [],
    category: 'general',
    description: 'Show creator and bot information',

    run: async ctx => {
      await ctx.reply(
        `👑 *CREATOR INFORMATION*\n\n` +
        `Creator: ${config.ownerName || 'Watson Fourpence'}\n` +
        `Bot: ${config.botName || 'PRECIOUS-MD'}\n` +
        `Powered by: Watson XD`
      );
    }
  }

];
