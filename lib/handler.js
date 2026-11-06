
import config from '../config.js';

import {
  getText,
  isOwnerOrSudo,
  isGroupJid,
  isStatusJid,
  normalizeJid,
  getContextInfo,
  unwrapMessage
} from './utils.js';

import {
  getUser,
  getGroup,
  getChat,
  saveDatabase
} from './database.js';

import { requireGroupAdmin } from './admin.js';
import { askAI } from './ai-client.js';
import { startProcessingPresence } from './automation.js';
import { handleAfk } from './afk.js';

// ==================================================
// STATE
// ==================================================

const cooldowns = new Map();
const spamTracker = new Map();
const aiInFlight = new Set();

const MAX_TRACKED_COOLDOWNS = 5000;
const MAX_TRACKED_SPAM = 3000;

const AI_COOLDOWN = 12000;

const URL_PATTERN =
  /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;

const AFK_COMMANDS = new Set([
  'afk',
  'away',
  'back',
  'unafk',
  'return'
]);

const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage'
];

// ==================================================
// GENERAL HELPERS
// ==================================================

function logError(label, error) {
  console.error(
    `[${label}]`,
    error?.stack || error?.message || error
  );
}

const now = () => Date.now();

function getDatabase() {
  if (!globalThis.db) {
    throw new Error('Database has not been loaded.');
  }

  return globalThis.db;
}

function ensureStats() {
  const db = getDatabase();

  db.stats ||= {};

  db.stats.messages = Math.max(
    0,
    Number(db.stats.messages) || 0
  );

  db.stats.commands = Math.max(
    0,
    Number(db.stats.commands) || 0
  );

  db.stats.errors = Math.max(
    0,
    Number(db.stats.errors) || 0
  );

  db.stats.startedAt =
    Number(db.stats.startedAt) || now();

  return db.stats;
}

// ==================================================
// JID NORMALIZATION
// ==================================================

function normalizeIdentity(value) {
  if (value == null) return '';

  const raw = String(value).trim();

  if (!raw) return '';

  if (raw.includes('@')) {
    return normalizeJid(raw);
  }

  const digits = raw.replace(/\D/g, '');

  return digits
    ? `${digits}@s.whatsapp.net`
    : '';
}

function addIdentity(set, value) {
  const jid = normalizeIdentity(value);

  if (jid && jid.includes('@')) {
    set.add(jid);
  }

  return jid;
}

// ==================================================
// BAILEYS V7 LID MAPPING
// ==================================================

async function expandJidIdentities(sock, values = []) {
  const identities = new Set();

  for (const value of values) {
    addIdentity(identities, value);
  }

  const mapping = sock?.signalRepository?.lidMapping;

  if (!mapping) {
    return identities;
  }

  // Resolve LID -> phone JID.
  if (typeof mapping.getPNForLID === 'function') {
    for (const jid of [...identities]) {
      if (!jid.endsWith('@lid')) continue;

      try {
        const phoneJid = await mapping.getPNForLID(jid);

        addIdentity(identities, phoneJid);
      } catch (error) {
        logError('LID TO PHONE RESOLUTION', error);
      }
    }
  }

  // Resolve phone JID -> LID when the mapping supports it.
  if (typeof mapping.getLIDForPN === 'function') {
    for (const jid of [...identities]) {
      if (!jid.endsWith('@s.whatsapp.net')) continue;

      try {
        const lid = await mapping.getLIDForPN(jid);

        addIdentity(identities, lid);
      } catch (error) {
        logError('PHONE TO LID RESOLUTION', error);
      }
    }
  }

  return identities;
}

// ==================================================
// BOT IDENTITY
// ==================================================

function getBotJids(sock) {
  const identities = new Set();

  addIdentity(identities, sock?.user?.id);
  addIdentity(identities, sock?.user?.jid);
  addIdentity(identities, sock?.user?.lid);
  addIdentity(identities, sock?.user?.phoneNumber);

  return identities;
}

function getBotJid(sock) {
  const identities = getBotJids(sock);

  return (
    normalizeIdentity(sock?.user?.id) ||
    identities.values().next().value ||
    ''
  );
}

async function isBotSelfChat(sock, msg, chat) {
  if (!msg?.key?.fromMe) return false;

  if (!chat || isGroupJid(chat)) {
    return false;
  }

  const botIdentities = await expandJidIdentities(
    sock,
    [...getBotJids(sock)]
  );

  const chatIdentities = await expandJidIdentities(
    sock,
    [
      chat,
      msg?.key?.remoteJidAlt
    ]
  );

  for (const jid of chatIdentities) {
    if (botIdentities.has(jid)) {
      return true;
    }
  }

  return false;
}

// ==================================================
// OWNER IDENTITY
// ==================================================

async function isOwnerMessage(
  sock,
  msg,
  sender,
  isSelfChat = false
) {
  if (isSelfChat) return true;

  const candidates = await expandJidIdentities(
    sock,
    [
      sender,
      msg?.key?.remoteJid,
      msg?.key?.remoteJidAlt,
      msg?.key?.participant,
      msg?.key?.participantAlt
    ]
  );

  // Include configured owner and sudo phone numbers.
  const configuredNumbers = [
    config.ownerNumber,
    ...(Array.isArray(config.sudoNumbers)
      ? config.sudoNumbers
      : String(config.sudoNumbers || '')
          .split(',')
    )
  ];

  for (const number of configuredNumbers) {
    const jid = normalizeIdentity(number);

    if (jid) {
      candidates.add(jid);
    }
  }

  for (const jid of candidates) {
    try {
      if (isOwnerOrSudo(jid)) {
        return true;
      }
    } catch (error) {
      logError('OWNER IDENTITY CHECK', error);
    }
  }

  return false;
}

// ==================================================
// MESSAGE VALIDATION
// ==================================================

function getMessageChat(msg) {
  return normalizeJid(
    msg?.key?.remoteJid || ''
  );
}

function getMessageSender(msg, chat) {
  const rawSender =
    msg?.key?.participant ||
    (isGroupJid(chat) ? '' : chat);

  return normalizeJid(rawSender);
}

function isValidMessage(msg) {
  return Boolean(
    msg?.message &&
    msg?.key &&
    msg.key.remoteJid
  );
}

// ==================================================
// MESSAGE UNWRAPPING
// ==================================================

function collectMessageNodes(message) {
  const nodes = [];
  const queue = [message];
  const visited = new Set();

  while (queue.length && nodes.length < 20) {
    const current = queue.shift();

    if (
      !current ||
      typeof current !== 'object' ||
      visited.has(current)
    ) {
      continue;
    }

    visited.add(current);
    nodes.push(current);

    for (const wrapper of MESSAGE_WRAPPERS) {
      const nested = current[wrapper]?.message;

      if (
        nested &&
        typeof nested === 'object'
      ) {
        queue.push(nested);
      }
    }
  }

  return nodes;
}

// ==================================================
// BUTTON RESPONSE EXTRACTION
// ==================================================

function extractButtonCommand(msg) {
  const nodes = collectMessageNodes(
    msg?.message
  );

  for (const message of nodes) {
    const params =
      message.interactiveResponseMessage
        ?.nativeFlowResponseMessage
        ?.paramsJson;

    if (typeof params === 'string') {
      try {
        const data = JSON.parse(params);

        if (
          data &&
          typeof data === 'object' &&
          !Array.isArray(data)
        ) {
          const ids = [
            data.id,
            data.selected_id,
            data.selectedId,
            data.buttonId,
            data.button_id,
            data.row_id,
            data.rowId,
            data.command
          ];

          const id = ids.find(value =>
            typeof value === 'string' &&
            value.trim()
          );

          if (id) return id.trim();
        }
      } catch (error) {
        logError('BUTTON RESPONSE', error);
      }
    }

    const legacy =
      message.buttonsResponseMessage?.selectedButtonId ||
      message.templateButtonReplyMessage?.selectedId ||
      message.listResponseMessage?.singleSelectReply?.selectedRowId;

    if (
      typeof legacy === 'string' &&
      legacy.trim()
    ) {
      return legacy.trim();
    }
  }

  return '';
}

function getIncomingText(msg) {
  const buttonCommand = extractButtonCommand(msg);

  if (buttonCommand) return buttonCommand;

  return String(getText(msg) || '').trim();
}

// ==================================================
// PREFIX SYSTEM
// ==================================================

function getPrefix(text) {
  const configured = [
    ...(Array.isArray(config.prefixes)
      ? config.prefixes
      : []),

    config.prefix
  ];

  const prefixes = [
    ...new Set(
      configured.filter(prefix =>
        typeof prefix === 'string' &&
        prefix.length > 0
      )
    )
  ];

  prefixes.sort(
    (a, b) => b.length - a.length
  );

  return prefixes.find(prefix =>
    text.startsWith(prefix)
  ) || null;
}

// ==================================================
// COMMAND PARSER
// ==================================================

function parseCommand(text, prefix) {
  if (!prefix || !text.startsWith(prefix)) {
    return null;
  }

  const input = text.slice(prefix.length).trim();

  if (!input) return null;

  const match = input.match(
    /^(\S+)(?:\s+([\s\S]*))?$/
  );

  if (!match) return null;

  const command = match[1].toLowerCase();
  const query = String(match[2] || '').trim();

  return {
    input,
    command,
    query,
    args: query ? query.split(/\s+/) : []
  };
}

// ==================================================
// PLUGIN LOOKUP
// ==================================================

function findPlugin(command) {
  const name = String(command || '')
    .toLowerCase()
    .trim();

  if (!name) return null;

  const commandMap = globalThis.commandMap;

  if (commandMap instanceof Map) {
    const plugin = commandMap.get(name);

    if (plugin) return plugin;
  }

  return (globalThis.plugins || []).find(plugin => {
    const primary = String(
      plugin.command || ''
    ).toLowerCase();

    const aliases = Array.isArray(plugin.aliases)
      ? plugin.aliases
      : [];

    return (
      primary === name ||
      aliases.some(alias =>
        String(alias).toLowerCase() === name
      )
    );
  }) || null;
}

// ==================================================
// SPAM PROTECTION
// ==================================================

function isSpam(sender, chat) {
  const key = `${chat}:${sender}`;
  const current = now();

  const windowMs = Math.max(
    1000,
    Number(config.spamWindow) || 8000
  );

  const limit = Math.max(
    2,
    Number(config.spamLimit) || 5
  );

  const previous = spamTracker.get(key) || [];

  const recent = previous.filter(
    timestamp => current - timestamp < windowMs
  );

  recent.push(current);

  spamTracker.delete(key);
  spamTracker.set(key, recent);

  if (spamTracker.size > MAX_TRACKED_SPAM) {
    for (const [entry, timestamps] of spamTracker) {
      const last = timestamps.at(-1) || 0;

      if (current - last > 60000) {
        spamTracker.delete(entry);
      }
    }

    while (spamTracker.size > MAX_TRACKED_SPAM) {
      const oldest = spamTracker.keys().next().value;

      if (!oldest) break;

      spamTracker.delete(oldest);
    }
  }

  return recent.length > limit;
}

// ==================================================
// GROUP ADMIN HELPERS
// ==================================================

function isParticipantAdmin(metadata, jid) {
  const normalized = normalizeJid(jid);

  if (!normalized) return false;

  return (
    metadata?.participants || []
  ).some(participant => {
    const participantJid = normalizeJid(
      participant.id ||
      participant.jid ||
      ''
    );

    return (
      participantJid === normalized &&
      Boolean(
        participant.admin ||
        participant.isAdmin ||
        participant.isSuperAdmin
      )
    );
  });
}

async function getMetadata(sock, chat) {
  try {
    return await sock.groupMetadata(chat);
  } catch (error) {
    logError('GROUP METADATA', error);
    return null;
  }
}

// ==================================================
// MESSAGE DELETION
// ==================================================

async function deleteMessage(sock, msg) {
  try {
    await sock.sendMessage(
      msg.key.remoteJid,
      {
        delete: msg.key
      }
    );

    return true;
  } catch (error) {
    logError('MESSAGE DELETE', error);
    return false;
  }
}

// ==================================================
// GROUP MODERATION
// ==================================================

async function moderateMessage(
  sock,
  msg,
  text,
  sender,
  chat,
  group,
  senderIsOwner = false
) {
  if (!isGroupJid(chat)) return false;

  if (
    !group.antiLink &&
    !group.antiBad &&
    !group.antiSpam
  ) {
    return false;
  }

  const metadata = await getMetadata(sock, chat);

  if (!metadata) return false;

  const senderIsAdmin =
    senderIsOwner ||
    isOwnerOrSudo(sender) ||
    isParticipantAdmin(metadata, sender);

  if (senderIsAdmin) return false;

  let reason = '';

  if (
    group.antiLink &&
    URL_PATTERN.test(text)
  ) {
    reason = 'Links are not allowed in this group.';
  }

  if (
    !reason &&
    group.antiBad &&
    Array.isArray(group.badWords)
  ) {
    const containsBadWord = group.badWords.some(word => {
      if (typeof word !== 'string') return false;

      const clean = word.trim();

      if (!clean) return false;

      const escaped = clean.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

      return new RegExp(
        `(^|[^a-z0-9])${escaped}($|[^a-z0-9])`,
        'i'
      ).test(text);
    });

    if (containsBadWord) {
      reason = 'Inappropriate language is not allowed.';
    }
  }

  if (
    !reason &&
    group.antiSpam &&
    isSpam(sender, chat)
  ) {
    reason = 'Please stop spamming the group.';
  }

  if (!reason) return false;

  const removed = await deleteMessage(sock, msg);

  const user = getUser(sender);

  user.warnings = Math.max(
    0,
    Number(user.warnings) || 0
  ) + 1;

  group.warnings ||= {};

  group.warnings[sender] = Math.max(
    0,
    Number(group.warnings[sender]) || 0
  ) + 1;

  await saveDatabase().catch(error => {
    logError('MODERATION DATABASE', error);
  });

  const maxWarnings = Math.max(
    1,
    Number(group.maxWarnings) || Number(config.maxWarnings) || 3
  );

  const warningCount = group.warnings[sender];

  let notice =
    `⚠️ @${String(sender).split('@')[0]}\n` +
    `${reason}\n` +
    `Warnings: ${warningCount}/${maxWarnings}`;

  if (!removed) {
    notice +=
      '\n\nThe bot could not delete the message. Check its group admin permissions.';
  }

  if (warningCount >= maxWarnings) {
    try {
      await sock.groupParticipantsUpdate(chat, [sender], 'remove');
      notice += `\n\n🚫 Warning limit reached (${maxWarnings}). Member removal requested.`;
      group.warnings[sender] = 0;
      user.warnings = 0;
      await saveDatabase().catch(error => logError('MODERATION DATABASE', error));
    } catch (error) {
      notice += '\n\n⚠️ Warning limit reached, but removal failed. Make the bot a group admin.';
      logError('MODERATION KICK', error);
    }
  }

  await sock.sendMessage(chat, {
    text: notice,
    mentions: [sender]
  }).catch(error => {
    logError('MODERATION NOTICE', error);
  });

  return true;
}

// ==================================================
// AI MENTION DETECTION
// ==================================================

function botWasMentionedOrQuoted(msg, sock) {
  const context = getContextInfo(msg);

  const mentioned = Array.isArray(context?.mentionedJid)
    ? context.mentionedJid
    : [];

  const botJids = getBotJids(sock);

  if (!botJids.size) return false;

  if (
    mentioned.some(jid =>
      botJids.has(normalizeIdentity(jid))
    )
  ) {
    return true;
  }

  return Boolean(
    context?.participant &&
    botJids.has(normalizeIdentity(context.participant))
  );
}

// ==================================================
// PRESENCE CLEANUP
// ==================================================

async function safelyStopPresence(stopPresence) {
  if (typeof stopPresence !== 'function') return;

  try {
    await Promise.resolve(stopPresence());
  } catch (error) {
    logError('PRESENCE CLEANUP', error);
  }
}

// ==================================================
// AUTOMATIC AI
// ==================================================

async function automaticAI(ctx) {
  if (config.aiEnabled === false) return;

  // Never automatically answer the bot's own self-chat messages.
  if (ctx.isSelfChat) return;

  const enabled = ctx.isGroup
    ? Boolean(ctx.group.aiChat)
    : Boolean(ctx.user.aiChat);

  const maxMessageLength = Math.max(
    1,
    Number(config.maxMessageLength) || 4000
  );

  if (
    !enabled ||
    !ctx.text ||
    ctx.text.length > maxMessageLength
  ) {
    return;
  }

  if (
    ctx.isGroup &&
    !botWasMentionedOrQuoted(ctx.msg, ctx.sock)
  ) {
    return;
  }

  const key = `ai:${ctx.chat}:${ctx.sender}`;

  if (aiInFlight.has(key)) return;

  const previous = cooldowns.get(key) || 0;

  if (now() - previous < AI_COOLDOWN) return;

  aiInFlight.add(key);

  let stopPresence = null;

  try {
    stopPresence = await startProcessingPresence(
      ctx.sock,
      ctx.chat,
      false
    );

    const historyOwner = ctx.isGroup
      ? ctx.group
      : ctx.user;

    const history = Array.isArray(historyOwner.aiHistory)
      ? historyOwner.aiHistory
      : [];

    const answer = await askAI(ctx.text, history);

    if (!answer) return;

    const historyLimit = Math.max(
      2,
      Math.min(30, Number(config.aiMaxHistory) || 10)
    );

    historyOwner.aiHistory = [
      ...history,
      {
        role: 'user',
        content: ctx.text
      },
      {
        role: 'assistant',
        content: answer
      }
    ].slice(-historyLimit);

    cooldowns.set(key, now());

    await saveDatabase();

    await ctx.reply(
      `🤖 *WATSON AI*\n\n${answer}`
    );

  } catch (error) {
    logError('AUTOMATIC AI', error);

    await ctx.reply(
      '⚠️ Watson AI is temporarily unavailable. Please try again later.'
    ).catch(() => {});

  } finally {
    aiInFlight.delete(key);

    await safelyStopPresence(stopPresence);
  }
}

// ==================================================
// COMMAND CONTEXT
// ==================================================

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
  prefix = '',
  query = '',
  isSelfChat = false,
  isOwnerIdentity = false
) {
  const isGroup = isGroupJid(chat);

  const owner =
    isSelfChat ||
    isOwnerIdentity ||
    isOwnerOrSudo(sender);

  return {
    sock,
    msg,
    chat,
    sender,
    text,

    command,
    args,
    q: query || args.join(' '),
    prefix,

    isGroup,
    isSelfChat,

    isOwner: owner,
    isSudo: owner,
    isOwnerOrSudo: owner,

    user,
    group,

    reply: (value, options = {}) =>
      sock.sendMessage(
        chat,
        {
          text: String(value),
          ...options
        },
        {
          quoted: msg
        }
      ),

    react: emoji =>
      sock.sendMessage(chat, {
        react: {
          text: String(emoji),
          key: msg.key
        }
      }),

    send: (content, options = {}) =>
      sock.sendMessage(
        chat,
        content,
        {
          quoted: msg,
          ...options
        }
      )
  };
}

// ==================================================
// DISABLED COMMANDS
// ==================================================

function isCommandDisabled(
  command,
  plugin,
  chatSettings,
  group
) {
  const disabled = [
    ...(Array.isArray(chatSettings?.disabledCommands)
      ? chatSettings.disabledCommands
      : []),

    ...(Array.isArray(group?.disabledCommands)
      ? group.disabledCommands
      : [])
  ].map(value => String(value).toLowerCase());

  const primary = String(
    plugin.command || ''
  ).toLowerCase();

  return (
    disabled.includes(command) ||
    disabled.includes(primary)
  );
}

// ==================================================
// COOLDOWN CLEANUP
// ==================================================

function cleanupCooldowns() {
  const current = now();

  for (const [key, timestamp] of cooldowns) {
    if (current - timestamp > 600000) {
      cooldowns.delete(key);
    }
  }

  while (cooldowns.size > MAX_TRACKED_COOLDOWNS) {
    const oldest = cooldowns.keys().next().value;

    if (!oldest) break;

    cooldowns.delete(oldest);
  }
}

// ==================================================
// COMMAND PERMISSIONS
// ==================================================

async function checkCommandPermissions(plugin, ctx) {
  if (
    plugin.owner &&
    !ctx.isOwnerOrSudo
  ) {
    await ctx.reply(
      '⛔ This command is restricted to the bot owner and sudo users.'
    );

    return false;
  }

  if (
    plugin.sudo &&
    !ctx.isOwnerOrSudo
  ) {
    await ctx.reply(
      '⛔ This command is restricted to owner and sudo users.'
    );

    return false;
  }

  if (plugin.group && !ctx.isGroup) {
    await ctx.reply(
      'This command only works in groups.'
    );

    return false;
  }

  if (plugin.private && ctx.isGroup) {
    await ctx.reply(
      'Use this command in a private chat.'
    );

    return false;
  }

  if (plugin.admin) {
    if (!ctx.isGroup) {
      await ctx.reply(
        'This command only works in groups.'
      );

      return false;
    }

    try {
      const result = await requireGroupAdmin(ctx);

      if (result === false || result == null) {
        return false;
      }

    } catch (error) {
      logError('COMMAND ADMIN CHECK', error);

      await ctx.reply(
        'Unable to verify group administrator permissions.'
      );

      return false;
    }
  }

  return true;
}

// ==================================================
// COMMAND EXECUTION
// ==================================================

async function executeCommand(
  sock,
  msg,
  chat,
  sender,
  text,
  user,
  group,
  chatSettings,
  parsed,
  plugin,
  isSelfChat = false,
  isOwnerIdentity = false
) {
  const {
    command,
    args,
    query,
    prefix
  } = parsed;

  if (typeof plugin.run !== 'function') {
    console.error(
      `[PLUGIN ERROR] ${command} has no run(ctx) function.`
    );

    return;
  }

  const owner =
    isSelfChat ||
    isOwnerIdentity ||
    isOwnerOrSudo(sender);

  if (
    config.publicMode === false &&
    !owner
  ) {
    return;
  }

  if (
    isCommandDisabled(
      command,
      plugin,
      chatSettings,
      group
    )
  ) {
    return sock.sendMessage(
      chat,
      {
        text: 'This command is disabled in this chat.'
      },
      {
        quoted: msg
      }
    );
  }

  const cooldownKey =
    `${chat}:${sender}:${plugin.command || command}`;

  const pluginCooldown = Math.max(
    0,
    Number(plugin.cooldown) || 0
  );

  const globalCooldown = Math.max(
    0,
    Number(config.commandCooldown) || 0
  );

  const cooldownTime =
    Math.max(pluginCooldown, globalCooldown) * 1000;

  const previous = cooldowns.get(cooldownKey) || 0;

  if (
    cooldownTime &&
    now() - previous < cooldownTime
  ) {
    const remaining = Math.ceil(
      (cooldownTime - (now() - previous)) / 1000
    );

    return sock.sendMessage(
      chat,
      {
        text:
          `⏳ Please wait ${remaining} seconds ` +
          `before using this command again.`
      },
      {
        quoted: msg
      }
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
    prefix,
    query,
    isSelfChat,
    isOwnerIdentity
  );

  const allowed = await checkCommandPermissions(
    plugin,
    ctx
  );

  if (!allowed) return;

  if (cooldownTime > 0) {
    cooldowns.set(cooldownKey, now());
  }

  cleanupCooldowns();

  const stats = ensureStats();

  stats.commands++;

  const messageContent = unwrapMessage(msg.message);

  const isAudio = Boolean(
    messageContent?.audioMessage
  );

  let stopPresence = null;

  try {
    stopPresence = await startProcessingPresence(
      sock,
      chat,
      isAudio
    );

    await plugin.run(ctx);

    await saveDatabase();

  } catch (error) {
    stats.errors++;

    logError(`COMMAND ${command}`, error);

    await saveDatabase().catch(saveError => {
      logError('DATABASE SAVE ERROR', saveError);
    });

    await ctx.reply(
      `❌ ${error.message || 'Command failed.'}`
    ).catch(() => {});

  } finally {
    await safelyStopPresence(stopPresence);
  }
}

// ==================================================
// MESSAGE PROCESSOR
// ==================================================

async function processMessage(sock, msg) {
  if (!isValidMessage(msg)) return;

  const chat = getMessageChat(msg);

  if (
    !chat ||
    isStatusJid(chat) ||
    chat.endsWith('@newsletter') ||
    chat.endsWith('@broadcast')
  ) {
    return;
  }

  const isGroup = isGroupJid(chat);

  // Detect the paired account's own private chat,
  // including phone-number JID and LID identities.
  const isSelfChat = await isBotSelfChat(
    sock,
    msg,
    chat
  );

  // Ignore outgoing messages sent by the bot to other
  // private chats and all outgoing group messages.
  if (
    msg.key.fromMe &&
    !isSelfChat
  ) {
    return;
  }

  const text = getIncomingText(msg);

  if (!text) return;

  const prefix = getPrefix(text);

  // Self-chat messages are accepted only as commands.
  if (isSelfChat && !prefix) {
    return;
  }

  const parsed = prefix
    ? parseCommand(text, prefix)
    : null;

  if (isSelfChat && !parsed) {
    return;
  }

  const sender = isSelfChat
    ? getBotJid(sock)
    : getMessageSender(msg, chat);

  if (!sender) return;

  // Resolve owner status before moderation and permissions.
  const owner = await isOwnerMessage(
    sock,
    msg,
    sender,
    isSelfChat
  );

  const db = getDatabase();
  const stats = ensureStats();

  const user = getUser(sender);

  const group = isGroup
    ? getGroup(chat)
    : {};

  const chatSettings = getChat(chat);

  user.lastSeen = now();

  stats.messages++;

  // Owner and self-chat identities are not blocked by
  // ordinary user bans.
  if (
    !owner &&
    (
      user.banned ||
      db.bans?.[sender]
    )
  ) {
    return;
  }

  const commandInput = parsed?.command || '';

  if (!AFK_COMMANDS.has(commandInput)) {
    await handleAfk(
      sock,
      msg,
      sender,
      user
    );
  }

  // Do not moderate self-chat commands.
  if (!isSelfChat) {
    const moderated = await moderateMessage(
      sock,
      msg,
      text,
      sender,
      chat,
      group,
      owner
    );

    if (moderated) {
      cleanupCooldowns();
      return;
    }
  }

  if (!prefix) {
    const ctx = createContext(
      sock,
      msg,
      chat,
      sender,
      text,
      user,
      group,
      '',
      [],
      '',
      '',
      isSelfChat,
      owner
    );

    await automaticAI(ctx);

    cleanupCooldowns();
    return;
  }

  if (!parsed) {
    cleanupCooldowns();
    return;
  }

  const plugin = findPlugin(parsed.command);

  if (!plugin) {
    cleanupCooldowns();
    return;
  }

  await executeCommand(
    sock,
    msg,
    chat,
    sender,
    text,
    user,
    group,
    chatSettings,
    parsed,
    plugin,
    isSelfChat,
    owner
  );

  cleanupCooldowns();
}

// ==================================================
// EXPORTED HANDLER
// ==================================================

export async function handleMessage(sock, msg) {
  try {
    await processMessage(sock, msg);
  } catch (error) {
    const db = globalThis.db;

    if (db?.stats) {
      db.stats.errors =
        Math.max(0, Number(db.stats.errors) || 0) + 1;
    }

    logError('MESSAGE HANDLER', error);
  }
}
