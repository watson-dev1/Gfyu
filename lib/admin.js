
import {
  getMentioned,
  getQuotedParticipant,
  normalizeJid,
  isOwnerOrSudo
} from './utils.js';

export async function getGroupMetadata(ctx) {
  if (!ctx.isGroup) {
    await ctx.reply('This command only works in groups.');
    return null;
  }

  try {
    return await ctx.sock.groupMetadata(ctx.chat);
  } catch (error) {
    console.error('Group metadata error:', error);
    await ctx.reply('Unable to retrieve group information. Try again.');
    return null;
  }
}

export async function requireBotAdmin(ctx, metadata = null) {
  const meta = metadata || await getGroupMetadata(ctx);
  if (!meta) return false;

  const botJid = normalizeJid(ctx.sock.user?.id || '');

  const bot = meta.participants?.find(
    participant => normalizeJid(participant.id) === botJid
  );

  if (!bot?.admin && !bot?.isAdmin && !bot?.isSuperAdmin) {
    await ctx.reply('⚠️ Make PRECIOUS-MD a group admin first.');
    return false;
  }

  return meta;
}

export async function requireSenderAdmin(ctx, metadata = null) {
  const meta = metadata || await getGroupMetadata(ctx);
  if (!meta) return false;

  if (isOwnerOrSudo(ctx.sender)) return true;

  const senderJid = normalizeJid(ctx.sender);

  const sender = meta.participants?.find(
    participant => normalizeJid(participant.id) === senderJid
  );

  if (!sender?.admin && !sender?.isAdmin && !sender?.isSuperAdmin) {
    await ctx.reply('⛔ Only group admins can use this command.');
    return false;
  }

  return true;
}

export async function requireGroupAdmin(ctx) {
  const meta = await getGroupMetadata(ctx);
  if (!meta) return false;

  if (!await requireSenderAdmin(ctx, meta)) return false;
  if (!await requireBotAdmin(ctx, meta)) return false;

  return meta;
}

export async function groupTarget(ctx, options = {}) {
  const target =
    getMentioned(ctx.msg) ||
    getQuotedParticipant(ctx.msg);

  if (!target) {
    await ctx.reply('Tag a member or reply to their message.');
    return null;
  }

  const normalized = normalizeJid(target);

  if (!normalized.endsWith('@s.whatsapp.net')) {
    await ctx.reply('Invalid member account.');
    return null;
  }

  if (!options.allowBot && normalized === normalizeJid(ctx.sock.user?.id || '')) {
    await ctx.reply('You cannot target the bot itself.');
    return null;
  }

  return normalized;
}
