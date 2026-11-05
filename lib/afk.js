
import { saveDatabase } from './database.js';

import {
  getContextInfo,
  getQuotedParticipant,
  normalizeJid
} from './utils.js';

const notified = new Map();

const NOTIFICATION_COOLDOWN = 60_000;
const MAX_NOTIFICATION_CACHE = 2_000;

function getAwayMinutes(since) {
  const timestamp = Number(since);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 60_000)
  );
}

function getAfkUser(jid) {
  const normalized = normalizeJid(jid);

  if (!normalized || !globalThis.db?.users) {
    return null;
  }

  return globalThis.db.users[normalized] || null;
}

function cleanupNotificationCache() {
  if (notified.size <= MAX_NOTIFICATION_CACHE) {
    return;
  }

  const cutoff = Date.now() - NOTIFICATION_COOLDOWN;

  for (const [key, timestamp] of notified) {
    if (timestamp < cutoff) {
      notified.delete(key);
    }
  }
}

async function notifyAfkUser(sock, chat, msg, jid, afk) {
  const now = Date.now();
  const cacheKey = `${chat}:${jid}`;
  const lastNotice = notified.get(cacheKey) || 0;

  if (now - lastNotice < NOTIFICATION_COOLDOWN) {
    return;
  }

  // Update before sending to prevent duplicate notifications.
  notified.set(cacheKey, now);

  const minutes = getAwayMinutes(afk.since);

  const reason = String(
    afk.reason || 'No reason provided'
  ).slice(0, 300);

  await sock.sendMessage(
    chat,
    {
      text:
        `💤 *@${jid.split('@')[0]} is currently AFK.*\n\n` +
        `Reason: ${reason}\n` +
        `Away for: ${minutes} minute(s).`,
      mentions: [jid]
    },
    { quoted: msg }
  ).catch(error => {
    console.error(
      '[AFK] Notification failed:',
      error.message
    );
  });
}

export async function handleAfk(sock, msg, sender, user) {
  if (
    !sock ||
    !msg?.key?.remoteJid ||
    !sender ||
    !user
  ) {
    return;
  }

  const chat = msg.key.remoteJid;
  const normalizedSender = normalizeJid(sender);

  if (!normalizedSender) {
    return;
  }

  // --------------------------------------------------
  // AUTOMATICALLY CLEAR THE SENDER'S AFK STATUS
  // --------------------------------------------------

  if (user.afk?.active) {
    const minutes = getAwayMinutes(user.afk.since);

    delete user.afk;

    await saveDatabase();

    await sock.sendMessage(
      chat,
      {
        text:
          `👋 *WELCOME BACK!*\n\n` +
          `Your AFK status has been cleared.\n` +
          `You were away for ${minutes} minute(s).`
      },
      { quoted: msg }
    ).catch(error => {
      console.error(
        '[AFK] Welcome-back message failed:',
        error.message
      );
    });
  }

  // --------------------------------------------------
  // FIND MENTIONED AND QUOTED AFK USERS
  // --------------------------------------------------

  const context = getContextInfo(msg);

  const mentioned = Array.isArray(context?.mentionedJid)
    ? context.mentionedJid
    : [];

  const quotedParticipant = getQuotedParticipant(msg);

  const targets = new Set();

  for (const jid of mentioned) {
    const normalized = normalizeJid(jid);

    if (normalized) {
      targets.add(normalized);
    }
  }

  // Also check the person whose message was quoted.
  if (quotedParticipant) {
    const normalized = normalizeJid(quotedParticipant);

    if (normalized) {
      targets.add(normalized);
    }
  }

  // --------------------------------------------------
  // NOTIFY ABOUT AFK USERS
  // --------------------------------------------------

  for (const jid of targets) {
    if (jid === normalizedSender) {
      continue;
    }

    const mentionedUser = getAfkUser(jid);
    const afk = mentionedUser?.afk;

    if (!afk?.active) {
      continue;
    }

    await notifyAfkUser(
      sock,
      chat,
      msg,
      jid,
      afk
    );
  }

  cleanupNotificationCache();
}
