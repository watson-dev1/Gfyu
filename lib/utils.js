
import config from '../config.js';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import fs from 'node:fs/promises';

// ==================================================
// GENERAL HELPERS
// ==================================================

export const sleep = ms =>
  new Promise(resolve =>
    setTimeout(resolve, Math.max(0, Number(ms) || 0))
  );

export function runtime(seconds = process.uptime()) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// ==================================================
// JID HELPERS
// ==================================================

export function normalizeJid(jid = '') {
  if (typeof jid !== 'string' || !jid.trim()) return '';

  try {
    return jidNormalizedUser(jid.trim());
  } catch {
    return jid.trim();
  }
}

export function cleanNumber(jid = '') {
  const value = String(jid || '').trim();

  if (!value || value.includes('@lid')) return '';

  return value
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

export function isOwnerJid(jid = '') {
  const number = cleanNumber(jid);
  const owner = String(config.ownerNumber || '').replace(/\D/g, '');

  return Boolean(number && owner && number === owner);
}

export function isSudoJid(jid = '') {
  const number = cleanNumber(jid);

  const sudoNumbers = Array.isArray(config.sudoNumbers)
    ? config.sudoNumbers
        .map(item => String(item).replace(/\D/g, ''))
        .filter(Boolean)
    : [];

  return Boolean(number && sudoNumbers.includes(number));
}

export function isOwnerOrSudo(jid = '') {
  return isOwnerJid(jid) || isSudoJid(jid);
}

export function isGroupJid(jid = '') {
  return String(jid || '').endsWith('@g.us');
}

export function isStatusJid(jid = '') {
  return String(jid || '') === 'status@broadcast';
}

export function isUserJid(jid = '') {
  const value = normalizeJid(jid);

  return (
    value.endsWith('@s.whatsapp.net') ||
    value.endsWith('@lid')
  );
}

// ==================================================
// MESSAGE UNWRAPPING
// ==================================================

export function unwrapMessage(message = {}) {
  let content = message;

  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage'
  ];

  for (let i = 0; i < 20; i++) {
    if (!content || typeof content !== 'object') break;

    let next = null;

    for (const wrapper of wrappers) {
      const candidate = content[wrapper]?.message;

      if (candidate && typeof candidate === 'object') {
        next = candidate;
        break;
      }
    }

    if (!next || next === content) break;

    content = next;
  }

  return content || {};
}

// ==================================================
// JSON HELPERS
// ==================================================

export function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string') return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// ==================================================
// NATIVE FLOW BUTTON RESPONSES
// ==================================================

export function getNativeFlowResponse(message = {}) {
  const response =
    message.interactiveResponseMessage
      ?.nativeFlowResponseMessage;

  if (!response?.paramsJson) return '';

  const parsed = safeJsonParse(response.paramsJson, {});

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return '';
  }

  const possibleCommands = [
    parsed.id,
    parsed.selected_id,
    parsed.selectedId,
    parsed.buttonId,
    parsed.button_id,
    parsed.row_id,
    parsed.rowId,
    parsed.command,
    parsed.display_text
  ];

  const command = possibleCommands.find(
    item => typeof item === 'string' && item.trim()
  );

  return command ? command.trim() : '';
}

// ==================================================
// MESSAGE TEXT EXTRACTION
// ==================================================

export function getText(msg = {}) {
  const message = unwrapMessage(msg.message || msg);

  const nativeFlowCommand = getNativeFlowResponse(message);

  if (nativeFlowCommand) return nativeFlowCommand;

  const text =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    message.interactiveResponseMessage?.body?.text ||
    message.messageContextInfo?.messageSecret ||
    message.pollUpdateMessage?.vote?.optionName ||
    '';

  return typeof text === 'string' ? text.trim() : '';
}

// ==================================================
// MESSAGE CONTEXT
// ==================================================

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

  for (const value of Object.values(message)) {
    if (
      value &&
      typeof value === 'object' &&
      value.contextInfo &&
      typeof value.contextInfo === 'object'
    ) {
      return value.contextInfo;
    }
  }

  return {};
}

// ==================================================
// MENTIONS
// ==================================================

export function getMentionedJids(msg = {}) {
  const context = getContextInfo(msg);

  if (!Array.isArray(context.mentionedJid)) return [];

  return [
    ...new Set(
      context.mentionedJid
        .filter(item => typeof item === 'string' && item.trim())
        .map(normalizeJid)
        .filter(Boolean)
    )
  ];
}

export function getMentioned(msg = {}) {
  return getMentionedJids(msg)[0] || null;
}

// ==================================================
// QUOTED MESSAGES
// ==================================================

export function getQuotedMessage(msg = {}) {
  return getContextInfo(msg).quotedMessage || null;
}

export function getQuotedParticipant(msg = {}) {
  const participant = getContextInfo(msg).participant;

  return typeof participant === 'string'
    ? normalizeJid(participant)
    : null;
}

export function getQuotedMessageId(msg = {}) {
  return getContextInfo(msg).stanzaId || null;
}

// ==================================================
// FILE HELPERS
// ==================================================

export async function removeFile(file) {
  if (!file) return;

  await fs.rm(file, { force: true }).catch(() => {});
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];

  let value = Number(bytes);
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(index ? 2 : 0)} ${units[index]}`;
}

// ==================================================
// TEXT HELPERS
// ==================================================

export function truncateText(value, maxLength = 4000) {
  const text = String(value ?? '');
  const limit = Math.max(0, Math.floor(Number(maxLength) || 0));

  return text.slice(0, limit);
}

export function capitalize(value = '') {
  const text = String(value ?? '');

  return text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : '';
}

export function randomItem(items = []) {
  if (!Array.isArray(items) || !items.length) return null;

  return items[Math.floor(Math.random() * items.length)];
}

export function formatDuration(milliseconds = 0) {
  const seconds = Math.max(
    0,
    Math.floor(Number(milliseconds) / 1000 || 0)
  );

  if (seconds < 60) return `${seconds}s`;

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================================================
// MESSAGE KEY
// ==================================================

export function getMessageKey(msg = {}) {
  const key = msg.key || {};

  return [
    key.remoteJid || '',
    key.participant || '',
    key.id || ''
  ].join(':');
}

// ==================================================
// MESSAGE SENDER
// ==================================================

export function getSenderJid(msg = {}) {
  const key = msg.key || {};

  return normalizeJid(
    key.participant ||
    key.remoteJid ||
    ''
  );
}

// ==================================================
// INPUT VALIDATION
// ==================================================

export function cleanInput(value, maxLength = 2000) {
  const limit = Math.max(
    0,
    Math.min(Number(maxLength) || 2000, 100000)
  );

  return String(value ?? '')
    .replace(/\0/g, '')
    .slice(0, limit)
    .trim();
}

// ==================================================
// URL VALIDATION
// ==================================================

export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    const url = new URL(value.trim());

    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

// ==================================================
// EXPORT COMPATIBILITY ALIASES
// ==================================================

export const getQuoted = getQuotedMessage;
export const getSender = getSenderJid;
export const getMessageText = getText;
