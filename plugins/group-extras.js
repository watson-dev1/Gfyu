import { requireGroupAdmin } from '../lib/admin.js';

function quotedOrMentioned(ctx) {
  const info = ctx.msg?.message?.extendedTextMessage?.contextInfo;
  return info?.mentionedJid?.[0] || info?.participant || null;
}

export default [
  {
    command: 'kickme', aliases: ['leaveme'], category: 'group', group: true,
    description: 'Request removal of your own account from the group',
    run: async ctx => {
      try {
        const metadata = await ctx.sock.groupMetadata(ctx.chat);
        const botJid = String(ctx.sock.user?.id || '').split(':')[0];
        const bot = metadata.participants?.find(p => String(p.id || '').split(':')[0] === botJid);
        if (!(bot?.admin === 'admin' || bot?.admin === 'superadmin' || bot?.admin === true)) {
          return ctx.reply('⚠️ Make the bot an admin before using kickme.');
        }
        await ctx.sock.groupParticipantsUpdate(ctx.chat, [ctx.sender], 'remove');
      } catch (error) {
        await ctx.reply(`❌ Could not remove you: ${error.message}`);
      }
    }
  },
  {
    command: 'kick1', aliases: ['remove1'], category: 'group', group: true, admin: true,
    description: 'Remove the mentioned or quoted member from the group',
    run: async ctx => {
      const target = quotedOrMentioned(ctx);
      if (!target) return ctx.reply(`Tag or reply to a member. Usage: ${ctx.prefix}kick1 @member`);
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'remove');
        await ctx.reply(`🚫 Removal request sent for @${String(target).split('@')[0]}.`, { mentions: [target] });
      } catch (error) {
        await ctx.reply(`❌ Could not remove member: ${error.message}`);
      }
    }
  },
  {
    command: 'admin', aliases: ['makeadmin'], category: 'group', group: true, admin: true,
    description: 'Promote a mentioned or quoted member to group admin',
    run: async ctx => {
      const target = quotedOrMentioned(ctx);
      if (!target) return ctx.reply(`Tag or reply to a member. Usage: ${ctx.prefix}admin @member`);
      try {
        await ctx.sock.groupParticipantsUpdate(ctx.chat, [target], 'promote');
        await ctx.reply(`🛡️ Promotion request sent for @${String(target).split('@')[0]}.`, { mentions: [target] });
      } catch (error) {
        await ctx.reply(`❌ Could not promote member: ${error.message}`);
      }
    }
  }
];
