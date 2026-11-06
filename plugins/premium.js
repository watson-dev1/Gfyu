import { getUser, saveDatabase } from '../lib/database.js';
import { normalizeJid } from '../lib/utils.js';

function targetJid(ctx) {
  const mentioned = Array.isArray(ctx.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid)
    ? ctx.msg.message.extendedTextMessage.contextInfo.mentionedJid[0] : null;
  const quoted = ctx.msg?.message?.extendedTextMessage?.contextInfo?.participant;
  const raw = mentioned || quoted || ctx.q.split(/\s+/)[0];
  if (!raw) return null;
  if (String(raw).includes('@')) return normalizeJid(String(raw));
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 ? `${digits}@s.whatsapp.net` : null;
}

function ownerOnly(ctx) {
  if (ctx.isOwnerOrSudo) return true;
  ctx.reply('This command is restricted to the bot owner.').catch(() => {});
  return false;
}

export default [
  {
    command: 'addpremium', aliases: ['makepremium'], category: 'owner', owner: true,
    description: 'Grant premium access (duration in days; default 30)',
    run: async ctx => {
      if (!ownerOnly(ctx)) return;
      const jid = targetJid(ctx);
      if (!jid) return ctx.reply(`Tag/reply to a user or use ${ctx.prefix}addpremium 2637XXXXXXX 30`);
      const daysArg = ctx.q.split(/\s+/).find((x, i) => i > 0 && /^\d+$/.test(x));
      const days = Math.min(3650, Math.max(1, Number(daysArg || 30)));
      const user = getUser(jid);
      user.premium = true;
      user.premiumUntil = Date.now() + days * 86400000;
      await saveDatabase();
      await ctx.reply(`💎 Premium activated for @${jid.split('@')[0]}\nDuration: ${days} days\nExpires: ${new Date(user.premiumUntil).toISOString()}`, { mentions: [jid] });
    }
  },
  {
    command: 'delpremium', aliases: ['remove-premium'], category: 'owner', owner: true,
    description: 'Remove premium access',
    run: async ctx => {
      if (!ownerOnly(ctx)) return;
      const jid = targetJid(ctx);
      if (!jid) return ctx.reply(`Tag/reply to a user or use ${ctx.prefix}delpremium 2637XXXXXXX`);
      const user = getUser(jid);
      user.premium = false;
      user.premiumUntil = null;
      await saveDatabase();
      await ctx.reply(`✅ Premium removed from @${jid.split('@')[0]}.`, { mentions: [jid] });
    }
  },
  {
    command: 'listpremium', aliases: ['premiumlist'], category: 'owner', owner: true,
    description: 'List users with active premium access',
    run: async ctx => {
      if (!ownerOnly(ctx)) return;
      const users = Object.entries(globalThis.db?.users || {}).filter(([, u]) => u?.premium && (!u.premiumUntil || Number(u.premiumUntil) > Date.now()));
      if (!users.length) return ctx.reply('No active premium users.');
      const lines = users.slice(0, 100).map(([jid, u], i) => `${i + 1}. @${jid.split('@')[0]} — ${u.premiumUntil ? new Date(u.premiumUntil).toLocaleDateString() : 'No expiry'}`);
      await ctx.send({ text: `💎 *PREMIUM USERS (${users.length})*\n\n${lines.join('\n')}`, mentions: users.slice(0, 100).map(([jid]) => jid) });
    }
  }
];
