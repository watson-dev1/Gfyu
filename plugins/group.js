
import { saveDatabase } from '../lib/database.js';

function parseMode(value) {
  const mode = (value || '').trim().toLowerCase();

  if (['on', 'enable', 'enabled'].includes(mode)) return true;
  if (['off', 'disable', 'disabled'].includes(mode)) return false;

  return null;
}

function groupRequired(ctx) {
  if (!ctx.isGroup) {
    ctx.reply('This command only works in groups.');
    return false;
  }
  return true;
}

async function setFlag(ctx, field, label) {
  if (!groupRequired(ctx)) return;

  const mode = parseMode(ctx.q);

  if (mode === null) {
    return ctx.reply(`Usage: ${config.prefix}${label} on/off`);
  }

  ctx.group[field] = mode;
  await saveDatabase();

  await ctx.reply(
    `✅ ${label} has been ${mode ? 'enabled' : 'disabled'}.`
  );
}

export default [
  {
    command: 'welcome',
    aliases: ['welcomemsg'],
    category: 'group',
    description: 'Enable or disable welcome messages',
    group: true,
    admin: true,
    run: async ctx => setFlag(ctx, 'welcome', 'welcome')
  },

  {
    command: 'goodbye',
    aliases: ['byemsg'],
    category: 'group',
    description: 'Enable or disable goodbye messages',
    group: true,
    admin: true,
    run: async ctx => setFlag(ctx, 'goodbye', 'goodbye')
  },

  {
    command: 'setwelcome',
    aliases: [],
    category: 'group',
    description: 'Set a custom welcome message',
    group: true,
    admin: true,
    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          `Usage: ${config.prefix}setwelcome Welcome @user to our group!`
        );
      }

      ctx.group.welcomeMessage = ctx.q.slice(0, 1000);
      await saveDatabase();
      await ctx.reply('✅ Welcome message saved.');
    }
  },

  {
    command: 'setgoodbye',
    aliases: [],
    category: 'group',
    description: 'Set a custom goodbye message',
    group: true,
    admin: true,
    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          `Usage: ${config.prefix}setgoodbye Goodbye @user!`
        );
      }

      ctx.group.goodbyeMessage = ctx.q.slice(0, 1000);
      await saveDatabase();
      await ctx.reply('✅ Goodbye message saved.');
    }
  },

  {
    command: 'antilink',
    aliases: ['antilinks'],
    category: 'group',
    description: 'Enable or disable link protection',
    group: true,
    admin: true,
    run: async ctx => setFlag(ctx, 'antiLink', 'antilink')
  },

  {
    command: 'antispam',
    aliases: [],
    category: 'group',
    description: 'Enable or disable spam protection',
    group: true,
    admin: true,
    run: async ctx => setFlag(ctx, 'antiSpam', 'antispam')
  },

  {
    command: 'antibad',
    aliases: ['antibadword'],
    category: 'group',
    description: 'Enable or disable bad-word protection',
    group: true,
    admin: true,
    run: async ctx => setFlag(ctx, 'antiBad', 'antibad')
  },

  {
    command: 'badword',
    aliases: ['badwords'],
    category: 'group',
    description: 'Manage blocked words',
    group: true,
    admin: true,
    run: async ctx => {
      const [action, ...rest] = ctx.args;
      const word = rest.join(' ').trim().toLowerCase();

      ctx.group.badWords ||= [];

      if (action === 'list') {
        return ctx.reply(
          `🚫 *BLOCKED WORDS*\n\n` +
          (ctx.group.badWords.length
            ? ctx.group.badWords.map((w, i) => `${i + 1}. ${w}`).join('\n')
            : 'No blocked words configured.')
        );
      }

      if (!['add', 'remove', 'delete'].includes(action) || !word) {
        return ctx.reply(
          `Usage:\n` +
          `${config.prefix}badword add word\n` +
          `${config.prefix}badword remove word\n` +
          `${config.prefix}badword list`
        );
      }

      if (word.length > 50) {
        return ctx.reply('A blocked word cannot exceed 50 characters.');
      }

      if (action === 'add') {
        if (ctx.group.badWords.includes(word)) {
          return ctx.reply('That word is already blocked.');
        }

        if (ctx.group.badWords.length >= 100) {
          return ctx.reply('The blocked-word list is full.');
        }

        ctx.group.badWords.push(word);
        await saveDatabase();
        return ctx.reply(`✅ Added "${word}" to the blocked-word list.`);
      }

      ctx.group.badWords = ctx.group.badWords.filter(w => w !== word);
      await saveDatabase();
      await ctx.reply(`✅ Removed "${word}" from the blocked-word list.`);
    }
  },

  {
    command: 'groupai',
    aliases: ['aigroup'],
    category: 'group',
    description: 'Enable or disable automatic AI replies in this group',
    group: true,
    admin: true,
    run: async ctx => setFlag(ctx, 'aiChat', 'groupai')
  },

  {
    command: 'groupinfo',
    aliases: ['gcinfo'],
    category: 'group',
    description: 'Show group information',
    group: true,
    run: async ctx => {
      const metadata = await ctx.sock.groupMetadata(ctx.chat);
      const admins = metadata.participants.filter(p => p.admin).length;

      await ctx.reply(
        `📋 *GROUP INFORMATION*\n\n` +
        `Name: ${metadata.subject || 'Unknown'}\n` +
        `Members: ${metadata.participants.length}\n` +
        `Admins: ${admins}\n` +
        `Welcome: ${ctx.group.welcome ? 'ON' : 'OFF'}\n` +
        `Goodbye: ${ctx.group.goodbye ? 'ON' : 'OFF'}\n` +
        `Anti-link: ${ctx.group.antiLink ? 'ON' : 'OFF'}\n` +
        `Anti-spam: ${ctx.group.antiSpam ? 'ON' : 'OFF'}\n` +
        `Anti-bad: ${ctx.group.antiBad ? 'ON' : 'OFF'}\n` +
        `Group AI: ${ctx.group.aiChat ? 'ON' : 'OFF'}`
      );
    }
  },

  {
    command: 'groupadmins',
    aliases: ['admins'],
    category: 'group',
    description: 'List group administrators',
    group: true,
    run: async ctx => {
      const metadata = await ctx.sock.groupMetadata(ctx.chat);
      const admins = metadata.participants.filter(p => p.admin);

      await ctx.reply(
        `👑 *GROUP ADMINS*\n\n` +
        admins.map((p, i) =>
          `${i + 1}. @${p.id.split('@')[0]}`
        ).join('\n'),
        { mentions: admins.map(p => p.id) }
      );
    }
  },

  {
    command: 'setsubject',
    aliases: ['setname'],
    category: 'group',
    description: 'Change the group name',
    group: true,
    admin: true,
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Enter a new group name.');

      await ctx.sock.groupUpdateSubject(ctx.chat, ctx.q.slice(0, 100));
      await ctx.reply('✅ Group name updated.');
    }
  },

  {
    command: 'setdesc',
    aliases: ['setdescription'],
    category: 'group',
    description: 'Change the group description',
    group: true,
    admin: true,
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Enter a group description.');

      await ctx.sock.groupUpdateDescription(ctx.chat, ctx.q.slice(0, 2048));
      await ctx.reply('✅ Group description updated.');
    }
  },

  {
    command: 'revoke',
    aliases: ['resetlink'],
    category: 'group',
    description: 'Reset the group invite link',
    group: true,
    admin: true,
    run: async ctx => {
      const code = await ctx.sock.groupRevokeInvite(ctx.chat);
      await ctx.reply(`✅ Group invite link reset.\nNew link:\nhttps://chat.whatsapp.com/${code}`);
    }
  }
];
