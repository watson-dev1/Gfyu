
import { getGroup, saveDatabase } from '../lib/database.js';
import { requireGroupAdmin, groupTarget } from '../lib/admin.js';

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getPrefix() {
  return globalThis.config?.prefix || '.';
}

function getParticipants(meta) {
  return Array.isArray(meta?.participants)
    ? meta.participants
    : [];
}

function getParticipantJid(participant) {
  return participant?.id || participant?.jid || null;
}

function isAdmin(participant) {
  return Boolean(participant?.admin);
}

async function groupOnly(ctx) {
  if (!ctx.isGroup) {
    await ctx.reply('❌ This command only works in groups.');
    return false;
  }

  return true;
}

async function adminRequired(ctx) {
  if (!await groupOnly(ctx)) return false;

  try {
    const result = await requireGroupAdmin(ctx);
    return result !== false;
  } catch (error) {
    console.error('[GROUP] Admin check:', error.message);
    await ctx.reply('❌ Unable to verify group administrator permissions.');
    return false;
  }
}

async function getMetadata(ctx) {
  if (!await groupOnly(ctx)) return null;

  try {
    return await ctx.sock.groupMetadata(ctx.chat);
  } catch (error) {
    console.error('[GROUP] Metadata:', error.message);
    await ctx.reply('❌ Unable to retrieve group information.');
    return null;
  }
}

function getGroupSettings(ctx) {
  const group = getGroup(ctx.chat);

  group.welcome ??= false;
  group.goodbye ??= false;
  group.antiLink ??= false;
  group.antiSpam ??= false;
  group.antiBad ??= false;
  group.aiChat ??= false;
  group.badWords ??= [];
  group.disabledCommands ??= [];
  group.warnings ??= {};
  group.welcomeMessage ??= '';
  group.goodbyeMessage ??= '';
  group.notifySubjectChanges ??= false;
  group.notifyDescriptionChanges ??= false;

  return group;
}

async function setFlag(ctx, key, value) {
  if (!await adminRequired(ctx)) return;

  const group = getGroupSettings(ctx);

  group[key] = value;

  await saveDatabase();

  await ctx.reply(
    `${value ? '✅ Enabled' : '❌ Disabled'} *${key}* successfully.`
  );
}

async function setNotification(ctx, key, value, label) {
  if (!await adminRequired(ctx)) return;

  const group = getGroupSettings(ctx);

  group[key] = value;

  await saveDatabase();

  await ctx.reply(
    `${value ? '✅' : '❌'} ${label} notifications ${value ? 'enabled' : 'disabled'}.`
  );
}

function parseToggle(value) {
  const mode = String(value || '').trim().toLowerCase();

  if (['on', 'enable', 'enabled', 'yes', 'true'].includes(mode)) {
    return true;
  }

  if (['off', 'disable', 'disabled', 'no', 'false'].includes(mode)) {
    return false;
  }

  return null;
}

function formatParticipants(participants, limit = 100) {
  return participants
    .map(getParticipantJid)
    .filter(jid => typeof jid === 'string' && jid.includes('@'))
    .slice(0, limit);
}

function replacePlaceholders(text, ctx, meta) {
  return String(text || '')
    .replace(/@user/gi, `@${String(ctx.sender || '').split('@')[0]}`)
    .replace(/@group/gi, meta?.subject || 'Group')
    .replace(/@subject/gi, meta?.subject || 'Group');
}

async function sendGroupMessage(ctx, text, mentions = []) {
  return ctx.send({
    text,
    mentions
  });
}

// --------------------------------------------------
// COMMANDS
// --------------------------------------------------

export default [

  // ------------------------------------------------
  // GROUP INFORMATION
  // ------------------------------------------------

  {
    command: 'groupinfo',
    aliases: ['gcinfo'],
    category: 'group',
    group: true,
    description: 'Show group information',

    run: async ctx => {
      const meta = await getMetadata(ctx);
      if (!meta) return;

      const participants = getParticipants(meta);
      const admins = participants.filter(isAdmin);

      await ctx.reply(
        `📋 *GROUP INFORMATION*\n\n` +
        `🏷️ Name: ${meta.subject || 'Unknown'}\n` +
        `🆔 Group ID: ${ctx.chat}\n` +
        `👥 Members: ${participants.length}\n` +
        `🛡️ Admins: ${admins.length}\n` +
        `👑 Owner: ${meta.owner || 'Unknown'}\n` +
        `📝 Description: ${meta.desc || 'No description'}`
      );
    }
  },

  {
    command: 'admins',
    aliases: ['listadmins', 'groupadmins'],
    category: 'group',
    group: true,
    description: 'List group administrators',

    run: async ctx => {
      const meta = await getMetadata(ctx);
      if (!meta) return;

      const admins = getParticipants(meta).filter(isAdmin);

      if (!admins.length) {
        return ctx.reply('🛡️ No group administrators were found.');
      }

      const mentions = formatParticipants(admins);

      const lines = admins.map((participant, index) => {
        const jid = getParticipantJid(participant);

        if (!jid) return `${index + 1}. Administrator`;

        const role = participant.admin === 'superadmin'
          ? ' 👑'
          : ' 🛡️';

        return `${index + 1}. @${jid.split('@')[0]}${role}`;
      });

      await sendGroupMessage(
        ctx,
        `🛡️ *GROUP ADMINISTRATORS (${admins.length})*\n\n${lines.join('\n')}`,
        mentions
      );
    }
  },

  {
    command: 'membercount',
    aliases: ['memberscount'],
    category: 'group',
    group: true,
    description: 'Count group members and administrators',

    run: async ctx => {
      const meta = await getMetadata(ctx);
      if (!meta) return;

      const participants = getParticipants(meta);
      const admins = participants.filter(isAdmin).length;

      await ctx.reply(
        `👥 *GROUP MEMBER STATISTICS*\n\n` +
        `📊 Total members: *${participants.length}*\n` +
        `🛡️ Administrators: *${admins}*\n` +
        `🙋 Other members: *${participants.length - admins}*`
      );
    }
  },

  // ------------------------------------------------
  // WELCOME AND GOODBYE
  // ------------------------------------------------

  {
    command: 'welcome',
    aliases: ['welcometoggle'],
    category: 'group',
    group: true,
    description: 'Enable or disable welcome messages',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `👋 *WELCOME SETTINGS*\n\n` +
          `Current: ${group.welcome ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}welcome on/off`
        );
      }

      await setFlag(ctx, 'welcome', value);
    }
  },

  {
    command: 'goodbye',
    aliases: ['goodbyetoggle'],
    category: 'group',
    group: true,
    description: 'Enable or disable goodbye messages',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `👋 *GOODBYE SETTINGS*\n\n` +
          `Current: ${group.goodbye ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}goodbye on/off`
        );
      }

      await setFlag(ctx, 'goodbye', value);
    }
  },

  {
    command: 'welcomemsg',
    aliases: ['setwelcome'],
    category: 'group',
    group: true,
    description: 'Set a custom welcome message',

    run: async ctx => {
      if (!await adminRequired(ctx)) return;

      const message = String(ctx.q || '').trim();

      if (!message) {
        return ctx.reply(
          `Usage: ${getPrefix()}welcomemsg Welcome @user to @group!`
        );
      }

      if (message.length > 1000) {
        return ctx.reply('Welcome message must be under 1000 characters.');
      }

      const group = getGroupSettings(ctx);
      group.welcomeMessage = message;

      await saveDatabase();

      await ctx.reply(
        '✅ Custom welcome message saved.\n\n' +
        'Available placeholders: @user, @group, @subject'
      );
    }
  },

  {
    command: 'goodbyemsg',
    aliases: ['setgoodbye'],
    category: 'group',
    group: true,
    description: 'Set a custom goodbye message',

    run: async ctx => {
      if (!await adminRequired(ctx)) return;

      const message = String(ctx.q || '').trim();

      if (!message) {
        return ctx.reply(
          `Usage: ${getPrefix()}goodbyemsg Goodbye @user!`
        );
      }

      if (message.length > 1000) {
        return ctx.reply('Goodbye message must be under 1000 characters.');
      }

      const group = getGroupSettings(ctx);
      group.goodbyeMessage = message;

      await saveDatabase();

      await ctx.reply(
        '✅ Custom goodbye message saved.\n\n' +
        'Available placeholders: @user, @group, @subject'
      );
    }
  },

  // ------------------------------------------------
  // GROUP MODERATION
  // ------------------------------------------------

  {
    command: 'antilink',
    aliases: ['antilinks'],
    category: 'group',
    group: true,
    description: 'Enable or disable anti-link protection',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `🔗 *ANTI-LINK SETTINGS*\n\n` +
          `Current: ${group.antiLink ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}antilink on/off`
        );
      }

      await setFlag(ctx, 'antiLink', value);
    }
  },

  {
    command: 'antispam',
    aliases: ['spamprotection'],
    category: 'group',
    group: true,
    description: 'Enable or disable anti-spam protection',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `🚫 *ANTI-SPAM SETTINGS*\n\n` +
          `Current: ${group.antiSpam ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}antispam on/off`
        );
      }

      await setFlag(ctx, 'antiSpam', value);
    }
  },

  {
    command: 'antibad',
    aliases: ['badwordfilter'],
    category: 'group',
    group: true,
    description: 'Enable or disable bad-word protection',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `🤬 *BAD-WORD FILTER*\n\n` +
          `Current: ${group.antiBad ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}antibad on/off`
        );
      }

      await setFlag(ctx, 'antiBad', value);
    }
  },

  {
    command: 'badword',
    aliases: ['badwords'],
    category: 'group',
    group: true,
    description: 'Manage the group bad-word list',

    run: async ctx => {
      if (!await adminRequired(ctx)) return;

      const group = getGroupSettings(ctx);
      const [action, ...rest] = String(ctx.q || '').trim().split(/\s+/);
      const word = rest.join(' ').trim();

      const mode = String(action || '').toLowerCase();

      if (mode === 'list') {
        if (!group.badWords.length) {
          return ctx.reply('📋 The bad-word list is empty.');
        }

        return ctx.reply(
          `🤬 *GROUP BAD-WORD LIST*\n\n` +
          group.badWords.map((item, index) => `${index + 1}. ${item}`).join('\n')
        );
      }

      if (mode === 'add') {
        if (!word || word.length > 80) {
          return ctx.reply(
            `Usage: ${getPrefix()}badword add word`
          );
        }

        if (
          group.badWords.some(
            item => String(item).toLowerCase() === word.toLowerCase()
          )
        ) {
          return ctx.reply('That word is already on the list.');
        }

        if (group.badWords.length >= 100) {
          return ctx.reply('The bad-word list is full (100 words maximum).');
        }

        group.badWords.push(word);

        await saveDatabase();

        return ctx.reply(`✅ Added *${word}* to the bad-word list.`);
      }

      if (mode === 'remove' || mode === 'delete') {
        if (!word) {
          return ctx.reply(
            `Usage: ${getPrefix()}badword remove word`
          );
        }

        const before = group.badWords.length;

        group.badWords = group.badWords.filter(
          item => String(item).toLowerCase() !== word.toLowerCase()
        );

        if (before === group.badWords.length) {
          return ctx.reply('That word was not found.');
        }

        await saveDatabase();

        return ctx.reply(`✅ Removed *${word}* from the bad-word list.`);
      }

      await ctx.reply(
        `🤬 *BAD-WORD MANAGEMENT*\n\n` +
        `${getPrefix()}badword add word\n` +
        `${getPrefix()}badword remove word\n` +
        `${getPrefix()}badword list`
      );
    }
  },

  // ------------------------------------------------
  // GROUP AI
  // ------------------------------------------------

  {
    command: 'groupai',
    aliases: [],
    category: 'group',
    group: true,
    description: 'Enable or disable AI replies in this group',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `🤖 *GROUP AI SETTINGS*\n\n` +
          `Current: ${group.aiChat ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}groupai on/off`
        );
      }

      await setFlag(ctx, 'aiChat', value);
    }
  },

  // ------------------------------------------------
  // GROUP SETTINGS
  // ------------------------------------------------

  {
    command: 'setsubject',
    aliases: ['setname'],
    category: 'group',
    group: true,
    description: 'Change the group name',

    run: async ctx => {
      if (!await adminRequired(ctx)) return;

      const subject = String(ctx.q || '').trim();

      if (!subject) {
        return ctx.reply(
          `Usage: ${getPrefix()}setsubject New group name`
        );
      }

      if (subject.length > 100) {
        return ctx.reply('Group name is too long.');
      }

      try {
        await ctx.sock.groupUpdateSubject(ctx.chat, subject);
        await ctx.reply('✅ Group name updated.');
      } catch (error) {
        console.error('[GROUP] Subject update:', error.message);
        await ctx.reply('Unable to change the group name.');
      }
    }
  },

  {
    command: 'setdesc',
    aliases: ['setdescription'],
    category: 'group',
    group: true,
    description: 'Change the group description',

    run: async ctx => {
      if (!await adminRequired(ctx)) return;

      const description = String(ctx.q || '').trim();

      if (!description) {
        return ctx.reply(
          `Usage: ${getPrefix()}setdesc New group description`
        );
      }

      if (description.length > 2048) {
        return ctx.reply('Group description is too long.');
      }

      try {
        await ctx.sock.groupUpdateDescription(ctx.chat, description);
        await ctx.reply('✅ Group description updated.');
      } catch (error) {
        console.error('[GROUP] Description update:', error.message);
        await ctx.reply('Unable to update the group description.');
      }
    }
  },

  {
    command: 'revoke',
    aliases: ['resetlink'],
    category: 'group',
    group: true,
    description: 'Reset the group invite link',

    run: async ctx => {
      if (!await adminRequired(ctx)) return;

      try {
        const code = await ctx.sock.groupRevokeInvite(ctx.chat);

        if (!code) {
          return ctx.reply('Unable to generate a new invite link.');
        }

        await ctx.reply(
          `🔗 *NEW GROUP INVITE LINK*\n\n` +
          `https://chat.whatsapp.com/${code}\n\n` +
          `⚠️ The previous invite link has been revoked.`
        );
      } catch (error) {
        console.error('[GROUP] Revoke:', error.message);
        await ctx.reply('Unable to reset the group invite link.');
      }
    }
  },

  {
    command: 'subjectnotify',
    aliases: ['namenotify'],
    category: 'group',
    group: true,
    description: 'Notify when the group name changes',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `Current subject notifications: ${group.notifySubjectChanges ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}subjectnotify on/off`
        );
      }

      await setNotification(
        ctx,
        'notifySubjectChanges',
        value,
        'Group name'
      );
    }
  },

  {
    command: 'descnotify',
    aliases: ['descriptionnotify'],
    category: 'group',
    group: true,
    description: 'Notify when the group description changes',

    run: async ctx => {
      const value = parseToggle(ctx.q);

      if (value === null) {
        const group = getGroupSettings(ctx);

        return ctx.reply(
          `Current description notifications: ${group.notifyDescriptionChanges ? 'ON' : 'OFF'}\n\n` +
          `Usage: ${getPrefix()}descnotify on/off`
        );
      }

      await setNotification(
        ctx,
        'notifyDescriptionChanges',
        value,
        'Group description'
      );
    }
  },

  // ------------------------------------------------
  // PARTICIPANT MANAGEMENT
  // ------------------------------------------------

  {
    command: 'promote',
    aliases: [],
    category: 'group',
    group: true,
    admin: true,
    description: 'Promote a group member to admin',

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
        console.error('[GROUP] Promote:', error.message);
        await ctx.reply('Unable to promote this participant.');
      }
    }
  },

  {
    command: 'demote',
    aliases: [],
    category: 'group',
    group: true,
    admin: true,
    description: 'Remove a member from group administrators',

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
        console.error('[GROUP] Demote:', error.message);
        await ctx.reply('Unable to demote this participant.');
      }
    }
  },

  {
    command: 'kick',
    aliases: ['remove'],
    category: 'group',
    group: true,
    admin: true,
    description: 'Remove a member from the group',

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
        console.error('[GROUP] Kick:', error.message);
        await ctx.reply('Unable to remove this participant.');
      }
    }
  },

  {
    command: 'add',
    aliases: [],
    category: 'group',
    group: true,
    admin: true,
    description: 'Add a phone number to the group',

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
        console.error('[GROUP] Add:', error.message);
        await ctx.reply(
          'Unable to add this number. WhatsApp may require an invitation.'
        );
      }
    }
  },

  // ------------------------------------------------
  // GROUP COMMAND HELP
  // ------------------------------------------------

  {
    command: 'grouphelp',
    aliases: ['gchelp'],
    category: 'group',
    group: true,
    description: 'Show group commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━━〔 *PRECIOUS-MD GROUP* 〕━━━╮\n` +
        `┃\n` +
        `┃ *INFORMATION*\n` +
        `┃ ${getPrefix()}groupinfo\n` +
        `┃ ${getPrefix()}admins\n` +
        `┃ ${getPrefix()}membercount\n` +
        `┃\n` +
        `┃ *WELCOME SYSTEM*\n` +
        `┃ ${getPrefix()}welcome on/off\n` +
        `┃ ${getPrefix()}goodbye on/off\n` +
        `┃ ${getPrefix()}welcomemsg text\n` +
        `┃ ${getPrefix()}goodbyemsg text\n` +
        `┃\n` +
        `┃ *MODERATION*\n` +
        `┃ ${getPrefix()}antilink on/off\n` +
        `┃ ${getPrefix()}antispam on/off\n` +
        `┃ ${getPrefix()}antibad on/off\n` +
        `┃ ${getPrefix()}badword add word\n` +
        `┃ ${getPrefix()}badword remove word\n` +
        `┃ ${getPrefix()}badword list\n` +
        `┃\n` +
        `┃ *GROUP SETTINGS*\n` +
        `┃ ${getPrefix()}groupai on/off\n` +
        `┃ ${getPrefix()}setsubject name\n` +
        `┃ ${getPrefix()}setdesc description\n` +
        `┃ ${getPrefix()}revoke\n` +
        `┃ ${getPrefix()}subjectnotify on/off\n` +
        `┃ ${getPrefix()}descnotify on/off\n` +
        `┃\n` +
        `┃ *ADMIN ACTIONS*\n` +
        `┃ ${getPrefix()}promote @user\n` +
        `┃ ${getPrefix()}demote @user\n` +
        `┃ ${getPrefix()}kick @user\n` +
        `┃ ${getPrefix()}add number\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `_Some commands require you to be a group admin and the bot to be a group admin._`
      );
    }
  }

];
