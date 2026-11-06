
import {
  getUser,
  saveDatabase
} from './database.js';

import {
  isGroupJid,
  normalizeJid,
  unwrapMessage
} from './utils.js';

import { downloadMediaMessage } from '@whiskeysockets/baileys';

import * as nsfwjs from 'nsfwjs';
import * as tf from '@tensorflow/tfjs-node';

import pino from 'pino';

// ==================================================
// PRECIOUS-MD LOCAL SECURITY ENGINE
// ==================================================

const logger = pino({ level: 'silent' });

const spamTracker = new Map();
const MAX_SPAM_TRACKERS = 3000;

const URL_PATTERN =
  /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+/i;

const DEFAULT_MAX_WARNINGS = 3;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// NSFW classification thresholds.
// Values range from 0 to 1.
const PORN_THRESHOLD = 0.75;
const HENTAI_THRESHOLD = 0.75;
const SEXY_THRESHOLD = 0.90;

// ==================================================
// MODEL STATE
// ==================================================

let nsfwModel = null;
let modelLoading = null;

// Run one image classification at a time to help
// control memory usage on smaller hosting plans.
let classificationQueue = Promise.resolve();

// ==================================================
// ERROR HANDLING
// ==================================================

function logError(label, error) {
  console.error(
    `[SECURITY:${label}]`,
    error?.stack || error?.message || error
  );
}

// ==================================================
// LOCAL NSFW MODEL INITIALIZATION
// ==================================================

export async function loadSecurityModel() {
  if (nsfwModel) return nsfwModel;

  if (modelLoading) return modelLoading;

  modelLoading = (async () => {
    try {
      console.log('[SECURITY] Loading local NSFWJS model...');

      tf.enableProdMode();

      await tf.ready();

      // MobileNetV2 is the smaller default model.
      nsfwModel = await nsfwjs.load('MobileNetV2');

      console.log('[SECURITY] NSFWJS model loaded successfully.');

      return nsfwModel;

    } catch (error) {
      nsfwModel = null;

      logError('MODEL LOAD', error);

      throw error;

    } finally {
      modelLoading = null;
    }
  })();

  return modelLoading;
}

// ==================================================
// HELPERS
// ==================================================

function cleanJid(value) {
  if (!value) return '';

  try {
    return normalizeJid(String(value).trim());
  } catch {
    return String(value).trim().toLowerCase();
  }
}

function getPhoneNumber(jid) {
  const value = String(jid || '');

  // LID identities do not reliably expose phone numbers.
  if (!value.endsWith('@s.whatsapp.net')) {
    return '';
  }

  return value.split('@')[0].replace(/\D/g, '');
}

function isAdmin(metadata, jid) {
  const target = cleanJid(jid);

  if (!target) return false;

  return (metadata?.participants || []).some(item => {
    const ids = [
      item.id,
      item.jid
    ]
      .filter(Boolean)
      .map(cleanJid);

    return (
      ids.includes(target) &&
      Boolean(
        item.admin ||
        item.isAdmin ||
        item.isSuperAdmin
      )
    );
  });
}

async function getGroupMetadata(sock, chat) {
  try {
    return await sock.groupMetadata(chat);
  } catch (error) {
    logError('METADATA', error);
    return null;
  }
}

async function deleteIncomingMessage(sock, msg) {
  if (!msg?.key?.id || !msg?.key?.remoteJid) {
    return false;
  }

  try {
    await sock.sendMessage(
      msg.key.remoteJid,
      { delete: msg.key }
    );

    return true;

  } catch (error) {
    logError('DELETE', error);
    return false;
  }
}

function getMessageContent(msg) {
  try {
    return unwrapMessage(msg?.message || {});
  } catch {
    return msg?.message || {};
  }
}

function getImageMessage(msg) {
  const content = getMessageContent(msg);

  if (content?.imageMessage) {
    return content.imageMessage;
  }

  if (
    content?.documentMessage?.mimetype?.startsWith('image/')
  ) {
    return content.documentMessage;
  }

  return null;
}

function getMaximumWarnings(group) {
  const configured = Number(group?.maxWarnings);

  if (!Number.isFinite(configured) || configured < 1) {
    return DEFAULT_MAX_WARNINGS;
  }

  return Math.min(20, Math.floor(configured));
}

// ==================================================
// SPAM DETECTION
// ==================================================

function detectSpam(sender, chat) {
  const key = `${chat}:${sender}`;
  const current = Date.now();

  const windowMs = 8000;
  const limit = 5;

  const previous = spamTracker.get(key) || [];

  const recent = previous.filter(
    timestamp => current - timestamp < windowMs
  );

  recent.push(current);

  spamTracker.delete(key);
  spamTracker.set(key, recent);

  if (spamTracker.size > MAX_SPAM_TRACKERS) {
    const oldest = spamTracker.keys().next().value;

    if (oldest) spamTracker.delete(oldest);
  }

  return recent.length > limit;
}

// ==================================================
// ANTI-FOREIGN
// ==================================================

function checkForeignNumber(sender, group) {
  if (!group?.antiForeign) return false;

  const phone = getPhoneNumber(sender);

  // Do not guess the country of an unresolved LID.
  if (!phone) return false;

  const allowed = Array.isArray(group.allowedCountryCodes)
    ? group.allowedCountryCodes
    : [];

  // Empty list means no country restrictions.
  if (!allowed.length) return false;

  return !allowed.some(code => {
    const normalized = String(code)
      .replace(/\D/g, '');

    return normalized && phone.startsWith(normalized);
  });
}

// ==================================================
// ANTI-BOT
// ==================================================

function checkBotBlocklist(sender, group) {
  if (!group?.antiBot) return false;

  const blocked = Array.isArray(group.botBlocklist)
    ? group.botBlocklist
    : [];

  return blocked.some(value => {
    return cleanJid(value) === cleanJid(sender);
  });
}

// This is an administrator-maintained blocklist.
// WhatsApp does not provide a reliable universal
// property that identifies every automated account.

// ==================================================
// ANTI-BADWORD
// ==================================================

function checkBadWords(text, group) {
  if (!group?.antiBad) return false;

  const words = Array.isArray(group.badWords)
    ? group.badWords
    : [];

  return words.some(word => {
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
    ).test(String(text || ''));
  });
}

// ==================================================
// LOCAL NSFW IMAGE CLASSIFICATION
// ==================================================

async function classifyImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Invalid image buffer.');
  }

  if (buffer.length > MAX_IMAGE_SIZE) {
    throw new Error('Image exceeds the 10 MB limit.');
  }

  const model = await loadSecurityModel();

  let imageTensor = null;

  try {
    // Decode image into a 3-channel tensor.
    imageTensor = tf.node.decodeImage(buffer, 3);

    // Classify the image using the local model.
    const predictions = await model.classify(imageTensor);

    const scores = Object.fromEntries(
      predictions.map(item => [
        item.className,
        item.probability
      ])
    );

    const porn = Number(scores.Porn || 0);
    const hentai = Number(scores.Hentai || 0);
    const sexy = Number(scores.Sexy || 0);

    const flagged =
      porn >= PORN_THRESHOLD ||
      hentai >= HENTAI_THRESHOLD ||
      sexy >= SEXY_THRESHOLD;

    let category = 'Neutral';

    if (porn >= PORN_THRESHOLD) {
      category = 'Porn';
    } else if (hentai >= HENTAI_THRESHOLD) {
      category = 'Hentai';
    } else if (sexy >= SEXY_THRESHOLD) {
      category = 'Sexy';
    }

    return {
      flagged,
      category,
      scores
    };

  } finally {
    if (imageTensor) {
      imageTensor.dispose();
    }
  }
}

// ==================================================
// QUEUED IMAGE CLASSIFICATION
// ==================================================

function queueImageClassification(buffer) {
  const task = classificationQueue.then(
    () => classifyImage(buffer),
    () => classifyImage(buffer)
  );

  classificationQueue = task.catch(() => {});

  return task;
}

// ==================================================
// ANTI-PORN
// ==================================================

async function checkPornImage(sock, msg) {
  const image = getImageMessage(msg);

  if (!image) {
    return {
      configured: true,
      flagged: false
    };
  }

  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage
      }
    );

    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw new Error('Image download returned empty data.');
    }

    if (buffer.length > MAX_IMAGE_SIZE) {
      return {
        configured: true,
        flagged: false,
        error: 'Image exceeds the moderation size limit.'
      };
    }

    const result = await queueImageClassification(buffer);

    return {
      configured: true,
      flagged: result.flagged,
      category: result.category,
      scores: result.scores
    };

  } catch (error) {
    logError('LOCAL PORN MODERATION', error);

    // Fail open: classification failure must not
    // automatically punish a group member.
    return {
      configured: true,
      flagged: false,
      error: error.message
    };
  }
}

// ==================================================
// WARNING SYSTEM
// ==================================================

async function issueWarning(
  sock,
  msg,
  sender,
  chat,
  group,
  reason,
  options = {}
) {
  const {
    deleteMessage = true
  } = options;

  group.warnings ||= {};

  const warningKey = cleanJid(sender);

  const current = Math.max(
    0,
    Number(group.warnings[warningKey]) || 0
  );

  const warningCount = current + 1;

  group.warnings[warningKey] = warningCount;

  const user = getUser(sender);

  user.warnings = Math.max(
    0,
    Number(user.warnings) || 0
  ) + 1;

  const maxWarnings = getMaximumWarnings(group);

  await saveDatabase();

  let deleted = false;

  if (deleteMessage && msg?.key?.id) {
    deleted = await deleteIncomingMessage(sock, msg);
  }

  let notice =
    `⚠️ *PRECIOUS-MD MODERATION*\n\n` +
    `Member: @${String(sender).split('@')[0]}\n` +
    `Reason: ${reason}\n` +
    `Warning: ${warningCount}/${maxWarnings}`;

  if (deleteMessage && msg?.key?.id && !deleted) {
    notice +=
      '\n\n⚠️ I could not delete the message. Check my admin permissions.';
  }

  if (warningCount >= maxWarnings) {
    try {
      await sock.groupParticipantsUpdate(
        chat,
        [sender],
        'remove'
      );

      notice +=
        '\n\n🚫 Maximum warnings reached. Member removed.';

      group.warnings[warningKey] = 0;

      user.warnings = Math.max(
        0,
        Number(user.warnings) - warningCount
      );

    } catch (error) {
      logError('WARNING KICK', error);

      notice +=
        '\n\n❌ Maximum warnings reached, but removal failed. Check bot admin permissions.';
    }
  }

  await saveDatabase();

  await sock.sendMessage(chat, {
    text: notice,
    mentions: [sender]
  }).catch(error => {
    logError('WARNING NOTICE', error);
  });

  return true;
}

// ==================================================
// MAIN SECURITY MODERATOR
// ==================================================

export async function moderateSecurity({
  sock,
  msg,
  text = '',
  sender,
  chat,
  group,
  senderIsOwner = false
}) {
  if (!isGroupJid(chat)) return false;

  if (!sender || !group) return false;

  if (msg?.key?.fromMe || senderIsOwner) {
    return false;
  }

  const metadata = await getGroupMetadata(sock, chat);

  if (!metadata) return false;

  // Admins and group owners are exempt.
  if (isAdmin(metadata, sender)) {
    return false;
  }

  // ANTI-FOREIGN

  if (checkForeignNumber(sender, group)) {
    return issueWarning(
      sock,
      msg,
      sender,
      chat,
      group,
      'Your country code is not allowed in this group.'
    );
  }

  // ANTI-BOT

  if (checkBotBlocklist(sender, group)) {
    return issueWarning(
      sock,
      msg,
      sender,
      chat,
      group,
      'This account is on the group bot blocklist.'
    );
  }

  // ANTI-LINK

  if (
    group.antiLink &&
    URL_PATTERN.test(String(text || ''))
  ) {
    return issueWarning(
      sock,
      msg,
      sender,
      chat,
      group,
      'Links are not allowed in this group.'
    );
  }

  // ANTI-BADWORD

  if (checkBadWords(String(text || ''), group)) {
    return issueWarning(
      sock,
      msg,
      sender,
      chat,
      group,
      'Inappropriate language is not allowed.'
    );
  }

  // ANTI-SPAM

  if (group.antiSpam && detectSpam(sender, chat)) {
    return issueWarning(
      sock,
      msg,
      sender,
      chat,
      group,
      'Repeated messages and spam are not allowed.'
    );
  }

  // ANTI-PORN

  if (group.antiPorn && getImageMessage(msg)) {
    const result = await checkPornImage(sock, msg);

    if (result.flagged) {
      return issueWarning(
        sock,
        msg,
        sender,
        chat,
        group,
        `Prohibited image detected (${result.category}).`
      );
    }
  }

  return false;
}

// ==================================================
// MANUAL WARNING COMMAND SUPPORT
// ==================================================

export async function addManualWarning(
  sock,
  chat,
  sender,
  reason = 'Manual administrator warning'
) {
  const group = globalThis.db?.groups?.[chat];

  if (!group) {
    throw new Error('Group database record not found.');
  }

  // No fake message: manual warnings do not delete
  // a message that does not exist.
  return issueWarning(
    sock,
    null,
    sender,
    chat,
    group,
    reason,
    {
      deleteMessage: false
    }
  );
}

// ==================================================
// RESET WARNINGS
// ==================================================

export async function resetWarnings(chat, sender) {
  const group = globalThis.db?.groups?.[chat];

  if (!group) return false;

  group.warnings ||= {};

  const warningKey = cleanJid(sender);

  group.warnings[warningKey] = 0;

  const user = getUser(sender);

  user.warnings = 0;

  await saveDatabase();

  return true;
}
