import { normalizeJid } from '../lib/utils.js';

function resolveTarget(ctx) {
  const info = ctx.msg?.message?.extendedTextMessage?.contextInfo;
  const mention = info?.mentionedJid?.[0];
  const raw = mention || info?.participant || ctx.q.split(/\s+/)[0];
  if (!raw) return null;
  if (String(raw).includes('@')) return normalizeJid(String(raw));
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 ? `${digits}@s.whatsapp.net` : null;
}

export default [
  {
    command: 'block', aliases: ['blockdm'], category: 'owner', owner: true,
    description: 'Block a WhatsApp account from contacting this bot',
    run: async ctx => {
      if (!ctx.isOwnerOrSudo) return ctx.reply('Owner only.');
      const jid = resolveTarget(ctx);
      if (!jid) return ctx.reply(`Tag/reply to a user or use ${ctx.prefix}block 2637XXXXXXX`);
      if (jid === ctx.sender || jid === ctx.sock.user?.id) return ctx.reply('You cannot block this account.');
      try {
        await ctx.sock.updateBlockStatus(jid, 'block');
        await ctx.reply(`🚫 Block request sent for @${jid.split('@')[0]}.`, { mentions: [jid] });
      } catch (error) {
        await ctx.reply(`Could not block this account: ${error.message}`);
      }
    }
  },
  {
    command: 'unblock', aliases: ['unblockdm'], category: 'owner', owner: true,
    description: 'Unblock a WhatsApp account',
    run: async ctx => {
      if (!ctx.isOwnerOrSudo) return ctx.reply('Owner only.');
      const jid = resolveTarget(ctx);
      if (!jid) return ctx.reply(`Tag/reply to a user or use ${ctx.prefix}unblock 2637XXXXXXX`);
      try {
        await ctx.sock.updateBlockStatus(jid, 'unblock');
        await ctx.reply(`✅ Unblock request sent for @${jid.split('@')[0]}.`, { mentions: [jid] });
      } catch (error) {
        await ctx.reply(`Could not unblock this account: ${error.message}`);
      }
    }
  }
];
