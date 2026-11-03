
import config from '../config.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import fs from 'node:fs/promises';

// GENERAL HELPERS

export const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

export function runtime(seconds = process.uptime()) {
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// JID HELPERS

export function normalizeJid(jid = '') {
  if (!jid) return '';

  try {
    return jidNormalizedUser(String(jid));
  } catch {
    return String(jid);
  }
}

export function cleanNumber(jid = '') {
  return normalizeJid(jid)
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

export function isOwnerJid(jid = '') {
  const number = cleanNumber(jid);
  const ownerNumber = String(config.ownerNumber || '')
    .replace(/\D/g, '');

  return Boolean(
    number &&
    ownerNumber &&
    number === ownerNumber
  );
}

export function isSudoJid(jid = '') {
  const number = cleanNumber(jid);

  const sudoNumbers = (config.sudoNumbers || [])
    .map(item => String(item).replace(/\D/g, ''))
    .filter(Boolean);

  return Boolean(
    number &&
    sudoNumbers.includes(number)
  );
}

export function isOwnerOrSudo(jid = '') {
  return isOwnerJid(jid) || isSudoJid(jid);
}

export function isGroupJid(jid = '') {
  return String(jid).endsWith('@g.us');
}

export function isStatusJid(jid = '') {
  return jid === 'status@broadcast';
}

// MESSAGE UNWRAPPING

export function unwrapMessage(message = {}) {
  let content = message;

  for (let i = 0; i < 8; i++) {
    if (!content || typeof content !== 'object') break;

    const next =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.viewOnceMessageV2Extension?.message ||
      content.documentWithCaptionMessage?.message;

    if (!next || next === content) break;

    content = next;
  }

  return content || {};
}

// NATIVE-FLOW BUTTON RESPONSE

function getNativeFlowResponse(message) {
  const paramsJson =
    message.interactiveResponseMessage
      ?.nativeFlowResponseMessage
      ?.paramsJson;

  if (!paramsJson) return '';

  const parsed = safeJsonParse(paramsJson, {});

  return String(
    parsed.id ||
    parsed.selected_id ||
    parsed.row_id ||
    ''
  ).trim();
}

// EXTRACT MESSAGE TEXT

export function getText(msg = {}) {
  const message = unwrapMessage(msg.message || msg);

  const nativeFlowCommand =
    getNativeFlowResponse(message);

  if (nativeFlowCommand) {
    return nativeFlowCommand;
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    ''
  ).toString().trim();
}

// MESSAGE CONTEXT

export function getContextInfo(msg = {}) {
  const message = unwrapMessage(msg.message || msg);

  const directContext =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.audioMessage?.contextInfo ||
    message.stickerMessage?.contextInfo ||
    message.buttonsResponseMessage?.contextInfo ||
    message.listResponseMessage?.contextInfo ||
    message.templateButtonReplyMessage?.contextInfo ||
    message.interactiveResponseMessage?.contextInfo ||
    message.locationMessage?.contextInfo ||
    message.contactMessage?.contextInfo ||
    message.messageContextInfo?.contextInfo;

  if (directContext) return directContext;

  // Fallback for other message types containing contextInfo.
  for (const value of Object.values(message)) {
    if (
      value &&
      typeof value === 'object' &&
      value.contextInfo
    ) {
      return value.contextInfo;
    }
  }

  return {};
}

// MENTIONS AND QUOTED MESSAGES

export function getMentioned(msg = {}) {
  const context = getContextInfo(msg);

  return (
    context.mentionedJid?.[0] ||
    context.participant ||
    null
  );
}

export function getMentionedJids(msg = {}) {
  const context = getContextInfo(msg);

  return Array.isArray(context.mentionedJid)
    ? context.mentionedJid
    : [];
}

export function getQuotedMessage(msg = {}) {
  return getContextInfo(msg).quotedMessage || null;
}

export function getQuotedParticipant(msg = {}) {
  return getContextInfo(msg).participant || null;
}

// FILE HELPERS

export async function removeFile(file) {
  if (!file) return;

  await fs.rm(file, {
    force: true
  }).catch(() => {});
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(index ? 2 : 0)} ${units[index]}`;
}

// JSON HELPER

export function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string') return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
