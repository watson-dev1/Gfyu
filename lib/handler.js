
import config from '../config.js';

import {
  getText,
  isOwnerJid,
  isOwnerOrSudo,
  isGroupJid,
  isStatusJid,
  normalizeJid,
  getContextInfo
} from './utils.js';

import {
  getUser,
  getGroup,
  getChat,
  saveDatabase
} from './database.js';

import { requireGroupAdmin } from './admin.js';
import { askAI } from './ai-client.js';
import {
  startProcessingPresence,
  isAutomationEnabled
} from './automation.js';
import { handleAfk } from './afk.js';

const cooldowns = new Map();
const spamTracker = new Map();

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;

function getPrefix(text) {
  const prefixes = [
    ...(Array.isArray(config.prefixes) ? config.prefixes : []),
    config.prefix
  ].filter(Boolean);

  return [...new Set(prefixes)]
    .sort((a, b) => b.length - a.length)
    .find(prefix => text.startsWith(prefix));
}

function isParticipantAdmin(metadata, jid) {
  const normalized = normalizeJid(jid);

  return (metadata?.participants || []).some(participant =>
    normalizeJid(participant.id) === normalized &&
    Boolean(participant.admin)
  );
}

async function getMetadata(sock, chat) {
  try {
    return await sock.groupMetadata(chat);
  } catch {
    return null;
  }
}

function isSpam(sender, chat) {
  const key = `${chat}:${sender}`;
  const now = Date.now();
  const windowMs = 8000;
  const limit = 5;

  const previous = spamTracker.get(key) || [];
  const recent = previous.filter(time => now - time < windowMs);

  recent.push(now);
  spamTracker.set(key, recent);

  if (spamTracker.size > 3000) {
    for (const [entry, times] of spamTracker) {
      if (!times.length || now - times[times.length - 1] > 60000) {
        spamTracker.delete(entry);
      }
    }
  }

  return recent.length > limit;
}

async function deleteMessage(sock, msg) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      delete: msg.key
    });
    return true;
  } catch {
    return false;
  }
}

async function moderateMessage(sock, msg, text, sender, chat, group) {
  if (!isGroupJid(chat)) return false;

  const needsModeration =
    group.antiLink ||
    group.antiBad ||
    group.antiSpam;

  if (!needsModeration) return false;

  const metadata = await getMetadata(sock, chat);

  const senderIsAdmin =
    isOwnerOrSudo(sender) ||
    isParticipantAdmin(metadata, sender);

  if (senderIsAdmin) return false;

  let reason = '';

  if (group.antiLink && URL_PATTERN.test(text)) {
    reason = 'Links are not allowed in this group.';
  }

  const badWords = Array.isArray(group.badWords)
    ? group.badWords
    : [];

  if (!reason && group.antiBad && badWords.length) {
    const lower = text.toLowerCase();

    if (badWords.some(word =>
      typeof word === 'string' &&
      word.trim() &&
      lower.includes(word.toLowerCase())
    )) {
      reason = 'Inappropriate language is not allowed.';
    }
  }

  if (!reason && group.antiSpam && isSpam(sender, chat)) {
    reason = 'Please stop spamming the group.';
  }

  if (!reason) return false;

  const removed = await deleteMessage(sock, msg);

  const user = getUser(sender);
  user.warnings = (user.warnings || 0) + 1;

  await saveDatabase().catch(console.error);

  const notice =
    `⚠️ @${sender.split('@')[0]}\n` +
    `${reason}\n` +
    `Warning: ${user.warnings}`;

  await sock.sendMessage(chat, {
    text: removed
      ? notice
      : `${notice}\n\nThe bot could not delete the message. Check that it is a group admin.`,
    mentions: [sender]
  }).catch(() => {});

  return true;
}

function botWasMentionedOrQuoted(msg, sock) {
  const context = getContextInfo(msg);
  const mentioned = context?.mentionedJid || [];

  const botJid = normalizeJid(sock.user?.id || '');

  if (mentioned.some(jid => normalizeJid(jid) === botJid)) {
    return true;
  }

  const quotedParticipant = context?.participant;

  return Boolean(
    quotedParticipant &&
    normalizeJid(quotedParticipant) === botJid
  );
}

async function automaticAI(ctx) {
  const enabled = ctx.isGroup
    ? Boolean(ctx.group.aiChat)
    : Boolean(ctx.user.aiChat);

  if (!enabled || !ctx.text || ctx.text.length > 4000) return;

  if (ctx.isGroup && !botWasMentionedOrQuoted(ctx.msg, ctx.sock)) {
    return;
  }

  const key = `ai:${ctx.chat}:${ctx.sender}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;

  if (now - last < 12000) return;

  cooldowns.set(key, now);

  const stopPresence = await startProcessingPresence(
    ctx.sock,
    ctx.chat,
    false
  );

  try {
    const history = ctx.user.aiHistory || [];
    const answer = await askAI(ctx.text, history);

    ctx.user.aiHistory = [
      ...history,
      { role: 'user', content: ctx.text },
      { role: 'assistant', content: answer }
    ].slice(-10);

    await saveDatabase();

    await ctx.reply(`🤖 *WATSON AI*\n\n${answer}`);
  } catch (error) {
    console.error('Automatic AI error:', error.message);
    await ctx.reply('⚠️ Watson AI is temporarily unavailable.');
  } finally {
    await stopPresence();
  }
}

function createContext(
  sock,
  msg,
  chat,
  sender,
  text,
  user,
  group,
  command = '',
  args = [],
  prefix = ''
) {
  return {
    sock,
    msg,
    chat,
    sender,
    text,
    command,
    args,
    q: args.join(' '),
    prefix,
    isGroup: isGroupJid(chat),
    isOwner: isOwnerJid(sender),
    isSudo: isOwnerOrSudo(sender),
    user,
    group,

    reply: value =>
      sock.sendMessage(
        chat,
        { text: String(value) },
        { quoted: msg }
      ),

    react: emoji =>
      sock.sendMessage(chat, {
        react: { text: emoji, key: msg.key }
      }),

    send: (content, options = {}) =>
      sock.sendMessage(
        chat,
        content,
        { quoted: msg, ...options }
      )
  };
}

export async function handleMessage(sock, msg) {
  if (!msg?.message || msg.key?.fromMe) return;

  const chat = msg.key?.remoteJid || '';

  if (
    !chat ||
    isStatusJid(chat) ||
    chat.endsWith('@newsletter') ||
    chat.endsWith('@broadcast')
  ) return;

  const sender = msg.key?.participant || chat;
  const text = getText(msg).trim();

  if (!text) return;

  const isGroup = isGroupJid(chat);
  const user = getUser(sender);
  const group = isGroup ? getGroup(chat) : {};
  const chatSettings = getChat(chat);

  user.lastSeen = Date.now();

  globalThis.db.stats.messages =
    (globalThis.db.stats.messages || 0) + 1;

  if (user.banned || globalThis.db.bans?.[sender]) return;

  if (isAutomationEnabled('autoread')) {
    await sock.readMessages([msg.key]).catch(() => {});
  }

  // AFK handling
  const prefix = getPrefix(text);

  const commandInput = prefix
    ? text.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase()
    : '';

  if (commandInput !== 'afk' && commandInput !== 'away') {
    await handleAfk(sock, msg, sender, user);
  }

  const moderated = await moderateMessage(
    sock,
    msg,
    text,
    sender,
    chat,
    group
  );

  if (moderated) return;

  if (!prefix) {
    const ctx = createContext(
      sock, msg, chat, sender, text, user, group
    );

    await automaticAI(ctx);
    return;
  }

  const input = text.slice(prefix.length).trim();

  if (!input) return;

  const [rawCommand, ...args] = input.split(/\s+/);
  const command = rawCommand.toLowerCase();

  const plugin = (globalThis.plugins || []).find(item =>
    String(item.command || '').toLowerCase() === command ||
    (item.aliases || []).some(alias =>
      String(alias).toLowerCase() === command
    )
  );

  if (!plugin) return;

  if (!config.publicMode && !isOwnerOrSudo(sender)) return;

  if ((chatSettings.disabledCommands || []).includes(command)) {
    return sock.sendMessage(
      chat,
      { text: 'This command is disabled in this chat.' },
      { quoted: msg }
    );
  }

  const cooldownKey = `${chat}:${sender}:${plugin.command}`;
  const cooldownTime = Number(plugin.cooldown || 0) * 1000;
  const previous = cooldowns.get(cooldownKey) || 0;

  if (cooldownTime && Date.now() - previous < cooldownTime) {
    const remaining = Math.ceil(
      (cooldownTime - (Date.now() - previous)) / 1000
    );

    return sock.sendMessage(
      chat,
      {
        text: `⏳ Please wait ${remaining} seconds before using this command again.`
      },
      { quoted: msg }
    );
  }

  const ctx = createContext(
    sock,
    msg,
    chat,
    sender,
    text,
    user,
    group,
    command,
    args,
    prefix
  );

  if (plugin.owner && !ctx.isOwner) {
    return ctx.reply('⛔ This command is restricted to the bot owner.');
  }

  if (plugin.sudo && !ctx.isSudo) {
    return ctx.reply('⛔ This command is restricted to owner and sudo users.');
  }

  if (plugin.group && !isGroup) {
    return ctx.reply('This command only works in groups.');
  }

  if (plugin.private && isGroup) {
    return ctx.reply('Use this command in a private chat.');
  }

  if (plugin.admin) {
    if (!isGroup) {
      return ctx.reply('This command only works in groups.');
    }

    const metadata = await requireGroupAdmin(ctx);
    if (!metadata) return;
  }

  cooldowns.set(cooldownKey, Date.now());

  globalThis.db.stats.commands =
    (globalThis.db.stats.commands || 0) + 1;

  const isAudio = Boolean(
    msg.message?.audioMessage ||
    msg.message?.viewOnceMessage?.message?.audioMessage ||
    msg.message?.viewOnceMessageV2?.message?.audioMessage
  );

  const stopPresence = await startProcessingPresence(
    sock,
    chat,
    isAudio
  );

  try {
    await plugin.run(ctx);
    await saveDatabase();
  } catch (error) {
    globalThis.db.stats.errors =
      (globalThis.db.stats.errors || 0) + 1;

    console.error(`Command ${command} failed:`, error);

    await saveDatabase().catch(console.error);
    await ctx.reply(`❌ ${error.message || 'Command failed.'}`);
  } finally {
    await stopPresence();
  }
}
