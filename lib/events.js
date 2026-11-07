
import {
  getGroup,
  saveDatabase
} from './database.js';

import { normalizeJid } from './utils.js';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const installedSockets = new WeakSet();
const socketCaches = new WeakMap();

const MAX_MESSAGE_LENGTH = 3000;
const MAX_GROUP_NAME_LENGTH = 100;
const MAX_CACHED_MESSAGES = 1000;
const MESSAGE_CACHE_TTL = 24 * 60 * 60 * 1000;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getNumber(jid = '') {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0];
}

function getParticipantJid(participant) {
  if (typeof participant === 'string') {
    return normalizeJid(participant);
  }

  if (!participant || typeof participant !== 'object') {
    return '';
  }

  return normalizeJid(
    participant.id ||
    participant.jid ||
    participant.lid ||
    ''
  );
}

function uniqueParticipants(participants = []) {
  const seen = new Set();
  const result = [];

  for (const participant of participants) {
    const jid = getParticipantJid(participant);

    if (!jid || !jid.includes('@') || seen.has(jid)) {
      continue;
    }

    seen.add(jid);
    result.push(jid);
  }

  return result;
}

function replacePlaceholders(message, {
  user = '',
  group = '',
  subject = '',
  desc = ''
} = {}) {
  return String(message || '')
    .replace(/@user/gi, `@${getNumber(user)}`)
    .replace(/@group/gi, group)
    .replace(/@subject/gi, subject)
    .replace(/@desc/gi, desc)
    .slice(0, MAX_MESSAGE_LENGTH);
}

async function safeSend(sock, jid, content, label) {
  try {
    await sock.sendMessage(jid, content);
    return true;
  } catch (error) {
    console.error(`[${label}]`, error.message);
    return false;
  }
}

function getDefaultWelcome(jid, groupName) {
  return (
    `👋 Welcome @${getNumber(jid)} to ${groupName}!\n\n` +
    `Please read the group rules and enjoy your stay.`
  );
}

function getDefaultGoodbye(jid) {
  return (
    `👋 Goodbye @${getNumber(jid)}.\n\n` +
    `We wish you well!`
  );
}

// --------------------------------------------------
// ANTI-DELETE SETTINGS
// --------------------------------------------------

function getAntiDeleteSettings() {
  const settings = globalThis.db?.settings || {};

  const value =
    settings.antiDelete ??
    settings.antidelete ??
    settings.anti_delete ??
    settings.automation?.antiDelete ??
    settings.automation?.antidelete ??
    false;

  if (typeof value === 'boolean') {
    return {
      enabled: value,
      mode: settings.antiDeleteMode || 'all'
    };
  }

  if (value && typeof value === 'object') {
    return {
      enabled: value.enabled === true,
      mode: value.mode || settings.antiDeleteMode || 'all'
    };
  }

  return {
    enabled: false,
    mode: 'all'
  };
}

function isAntiDeleteAllowed(jid, settings) {
  if (!settings.enabled) return false;

  if (settings.mode === 'all') return true;

  if (settings.mode === 'group') {
    return jid.endsWith('@g.us');
  }

  if (settings.mode === 'private') {
    return jid.endsWith('@s.whatsapp.net') ||
      jid.endsWith('@lid');
  }

  return false;
}

// --------------------------------------------------
// MESSAGE CACHE
// --------------------------------------------------

function getMessageCache(sock) {
  if (!socketCaches.has(sock)) {
    socketCaches.set(sock, {
      messages: new Map(),
      deleted: new Map()
    });
  }

  return socketCaches.get(sock);
}

function getMessageKey(key = {}) {
  if (!key?.remoteJid || !key?.id) return '';

  return [
    key.remoteJid,
    key.id,
    key.participant || '',
    key.fromMe ? '1' : '0'
  ].join('|');
}

function cleanMessageCache(cache) {
  const now = Date.now();

  for (const [key, item] of cache.messages) {
    if (now - item.time > MESSAGE_CACHE_TTL) {
      cache.messages.delete(key);
    }
  }

  for (const [key, time] of cache.deleted) {
    if (now - time > 60000) {
      cache.deleted.delete(key);
    }
  }

  while (cache.messages.size > MAX_CACHED_MESSAGES) {
    const oldestKey = cache.messages.keys().next().value;
    cache.messages.delete(oldestKey);
  }
}

function unwrapMessage(message) {
  let current = message;

  for (let i = 0; i < 8 && current; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }

    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }

    break;
  }

  return current || {};
}

function getMessageText(message) {
  const content = unwrapMessage(message);

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

function cacheIncomingMessages(sock, messages = []) {
  const cache = getMessageCache(sock);

  for (const msg of messages) {
    const key = getMessageKey(msg?.key);

    if (!key || !msg.message) continue;

    // Do not cache protocol/revoke messages.
    const content = unwrapMessage(msg.message);

    if (content.protocolMessage) continue;

    cache.messages.set(key, {
      message: msg,
      time: Date.now()
    });
  }

  cleanMessageCache(cache);
}

// --------------------------------------------------
// ANTI-DELETE RESTORATION
// --------------------------------------------------

async function restoreDeletedMessage(
  sock,
  deletedKey,
  deletionActor = ''
) {
  try {
    const cache = getMessageCache(sock);
    const key = getMessageKey(deletedKey);

    if (!key) return false;

    const cached = cache.messages.get(key);

    if (!cached) {
      console.log(
        '[ANTI-DELETE] Original message not found in cache:',
        deletedKey.id
      );
      return false;
    }

    // Prevent duplicate restoration.
    if (cache.deleted.has(key)) return false;

    cache.deleted.set(key, Date.now());

    const original = cached.message;
    const chat = deletedKey.remoteJid;

    const sender =
      deletedKey.participant ||
      original.key?.participant ||
      original.key?.remoteJid ||
      'Unknown';

    const senderNumber = getNumber(sender);
    const actorNumber = deletionActor
      ? getNumber(deletionActor)
      : 'Unknown';

    const settings = getAntiDeleteSettings();

    if (!isAntiDeleteAllowed(chat, settings)) {
      return false;
    }

    const text = getMessageText(original.message);

    const header =
      `🗑️ *PRECIOUS-MD ANTI-DELETE*\n\n` +
      `👤 *Sender:* @${senderNumber}\n` +
      `🚫 *Deleted by:* @${actorNumber}\n` +
      `📍 *Chat:* ${chat.endsWith('@g.us') ? 'Group' : 'Private'}\n\n`;

    const content = unwrapMessage(original.message);

    const mentions = [sender];

    if (deletionActor) {
      mentions.push(deletionActor);
    }

    // Text messages and captions.
    if (text) {
      await sock.sendMessage(chat, {
        text:
          header +
          `💬 *Message:*\n${String(text).slice(0, MAX_MESSAGE_LENGTH)}`,
        mentions
      });

      console.log('[ANTI-DELETE] Text message restored.');
      return true;
    }

    // Media cannot be reconstructed from a message key alone.
    // This fallback identifies the deleted media type.
    const mediaType =
      content.imageMessage ? 'Image' :
      content.videoMessage ? 'Video' :
      content.audioMessage ? 'Audio' :
      content.documentMessage ? 'Document' :
      content.stickerMessage ? 'Sticker' :
      content.contactMessage ? 'Contact' :
      content.locationMessage ? 'Location' :
      'Unsupported message';

    await sock.sendMessage(chat, {
      text:
        header +
        `📎 *Deleted content:* ${mediaType}\n` +
        `⚠️ The original media could not be reconstructed by this text-only cache.`,
      mentions
    });

    console.log('[ANTI-DELETE] Deleted media detected:', mediaType);
    return true;

  } catch (error) {
    console.error('[ANTI-DELETE]', error.message);
    return false;
  }
}

// --------------------------------------------------
// DETECT REVOKED MESSAGES
// --------------------------------------------------

async function handleProtocolMessage(sock, msg) {
  try {
    const content = unwrapMessage(msg?.message);
    const protocol = content.protocolMessage;

    if (!protocol) return;

    // Baileys protocol revoke type.
    // WAMessageProtocolType.REVOKE is normally 0.
    if (protocol.type !== 0) return;

    const deletedKey = protocol.key;

    if (!deletedKey?.id || !deletedKey?.remoteJid) {
      return;
    }

    const actor =
      msg.key?.participant ||
      msg.key?.remoteJid ||
      '';

    await restoreDeletedMessage(
      sock,
      deletedKey,
      actor
    );

  } catch (error) {
    console.error('[ANTI-DELETE PROTOCOL]', error.message);
  }
}

async function handleMessageUpdate(sock, updates = []) {
  if (!Array.isArray(updates)) return;

  for (const item of updates) {
    try {
      if (!item?.key) continue;

      // Baileys WAMessageStubType.REVOKE.
      if (item.update?.messageStubType !== 1) {
        continue;
      }

      const actor =
        item.update?.messageStubParameters?.[0] ||
        item.key?.participant ||
        item.key?.remoteJid ||
        '';

      await restoreDeletedMessage(
        sock,
        item.key,
        actor
      );

    } catch (error) {
      console.error('[ANTI-DELETE UPDATE]', error.message);
    }
  }
}

// --------------------------------------------------
// WELCOME / GOODBYE
// --------------------------------------------------

async function handleParticipantsUpdate(sock, update) {
  const {
    id,
    participants = [],
    action
  } = update || {};

  if (
    !id ||
    !Array.isArray(participants) ||
    !['add', 'remove', 'leave'].includes(action)
  ) {
    return;
  }

  let group;

  try {
    group = getGroup(id);
  } catch (error) {
    console.error('[GROUP EVENTS]', error.message);
    return;
  }

  const isWelcome =
    action === 'add' &&
    group.welcome === true;

  const isGoodbye =
    ['remove', 'leave'].includes(action) &&
    group.goodbye === true;

  if (!isWelcome && !isGoodbye) return;

  let groupName = 'this group';

  try {
    const metadata = await sock.groupMetadata(id);

    if (metadata?.subject) {
      groupName = String(metadata.subject)
        .slice(0, MAX_GROUP_NAME_LENGTH);
    }
  } catch (error) {
    console.error('[GROUP METADATA]', error.message);
  }

  const members = uniqueParticipants(participants);

  for (const jid of members) {
    const customMessage = isWelcome
      ? group.welcomeMessage
      : group.goodbyeMessage;

    const defaultMessage = isWelcome
      ? getDefaultWelcome(jid, groupName)
      : getDefaultGoodbye(jid);

    const message = replacePlaceholders(
      customMessage || defaultMessage,
      {
        user: jid,
        group: groupName,
        subject: groupName
      }
    );

    await safeSend(
      sock,
      id,
      {
        text: message,
        mentions: [jid]
      },
      isWelcome ? 'WELCOME' : 'GOODBYE'
    );
  }
}

// --------------------------------------------------
// GROUP SUBJECT / DESCRIPTION UPDATES
// --------------------------------------------------

async function handleGroupsUpdate(sock, updates) {
  if (!Array.isArray(updates)) return;

  for (const update of updates) {
    if (!update?.id) continue;

    try {
      const group = getGroup(update.id);

      if (
        typeof update.subject === 'string' &&
        group.notifySubjectChanges === true
      ) {
        const subject = update.subject
          .slice(0, MAX_GROUP_NAME_LENGTH);

        await safeSend(
          sock,
          update.id,
          {
            text:
              `📝 *GROUP NAME UPDATED*\n\n` +
              `New name: *${subject}*`
          },
          'GROUP SUBJECT'
        );
      }

      if (
        typeof update.desc === 'string' &&
        group.notifyDescriptionChanges === true
      ) {
        await safeSend(
          sock,
          update.id,
          {
            text:
              `📌 *GROUP DESCRIPTION UPDATED*\n\n` +
              `The group description has been changed.`
          },
          'GROUP DESCRIPTION'
        );
      }
    } catch (error) {
      console.error('[GROUP UPDATE]', error.message);
    }
  }
}

// --------------------------------------------------
// INSTALL EVENT HANDLERS
// --------------------------------------------------

export function installEventHandlers(sock) {
  if (!sock?.ev) {
    throw new Error(
      'A valid Baileys socket is required.'
    );
  }

  if (installedSockets.has(sock)) {
    return false;
  }

  installedSockets.add(sock);

  // Cache messages before they are deleted.
  sock.ev.on('messages.upsert', async event => {
    try {
      const messages = event?.messages || [];

      cacheIncomingMessages(sock, messages);

      // Detect protocol-message deletion events.
      for (const msg of messages) {
        await handleProtocolMessage(sock, msg);
      }
    } catch (error) {
      console.error('[MESSAGE CACHE]', error.message);
    }
  });

  // Detect deletion through message update events.
  sock.ev.on('messages.update', async updates => {
    await handleMessageUpdate(sock, updates);
  });

  // New member / member leaving.
  sock.ev.on(
    'group-participants.update',
    async update => {
      try {
        await handleParticipantsUpdate(sock, update);
      } catch (error) {
        console.error(
          '[GROUP PARTICIPANTS]',
          error.message
        );
      }
    }
  );

  // Group name / description changes.
  sock.ev.on(
    'groups.update',
    async updates => {
      try {
        await handleGroupsUpdate(sock, updates);
      } catch (error) {
        console.error(
          '[GROUP UPDATE]',
          error.message
        );
      }
    }
  );

  console.log(
    '[PRECIOUS-MD] Group and anti-delete event handlers installed.'
  );

  return true;
}
