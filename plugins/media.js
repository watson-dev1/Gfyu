
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import config from '../config.js';

import { fileTypeFromBuffer } from 'file-type';

import {
  downloadMediaMessage
} from '@whiskeysockets/baileys';

import { formatBytes } from '../lib/utils.js';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const MEDIA_TYPES = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage'
];

function getMaxMediaSize() {
  const size = Number(config.maxMediaMb);

  return Number.isFinite(size) && size > 0
    ? size * 1024 * 1024
    : 45 * 1024 * 1024;
}

// --------------------------------------------------
// MESSAGE HELPERS
// --------------------------------------------------

function unwrapMessage(message) {
  let current = message;

  while (current && typeof current === 'object') {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;

    if (!next) break;

    current = next;
  }

  return current || {};
}

function getMediaNode(message) {
  const unwrapped = unwrapMessage(message);

  for (const type of MEDIA_TYPES) {
    if (unwrapped[type]) {
      return {
        type,
        media: unwrapped[type]
      };
    }
  }

  return null;
}

function getQuotedMessage(message) {
  const unwrapped = unwrapMessage(message);

  const context =
    unwrapped.extendedTextMessage?.contextInfo ||
    unwrapped.imageMessage?.contextInfo ||
    unwrapped.videoMessage?.contextInfo ||
    unwrapped.documentMessage?.contextInfo ||
    unwrapped.audioMessage?.contextInfo ||
    unwrapped.stickerMessage?.contextInfo;

  if (!context?.quotedMessage) {
    return null;
  }

  return {
    message: context.quotedMessage,
    participant: context.participant,
    stanzaId: context.stanzaId
  };
}

function buildQuotedWAMessage(ctx, quoted) {
  const originalKey = ctx.msg.key || {};

  return {
    key: {
      remoteJid: ctx.chat || originalKey.remoteJid,
      fromMe: false,
      id: quoted.stanzaId,
      participant: quoted.participant
    },
    message: quoted.message
  };
}

function getDownloadMessage(ctx) {
  // First, check whether the command message itself contains media.
  if (getMediaNode(ctx.msg.message)) {
    return ctx.msg;
  }

  // Otherwise, download the quoted media.
  const quoted = getQuotedMessage(ctx.msg.message);

  if (!quoted || !getMediaNode(quoted.message)) {
    return null;
  }

  return buildQuotedWAMessage(ctx, quoted);
}

// --------------------------------------------------
// MEDIA DOWNLOAD
// --------------------------------------------------

async function downloadMedia(ctx, message) {
  const mediaNode = getMediaNode(message?.message);

  if (!mediaNode) {
    throw new Error('Unsupported or missing media.');
  }

  const declaredSize = Number(
    mediaNode.media.fileLength || 0
  );

  const maxSize = getMaxMediaSize();

  // Check the advertised size before downloading.
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > maxSize
  ) {
    throw new Error(
      `Media exceeds the ${config.maxMediaMb || 45} MB size limit.`
    );
  }

  const buffer = await downloadMediaMessage(
    message,
    'buffer',
    {},
    {
      logger: ctx.sock.logger,
      reuploadRequest: ctx.sock.updateMediaMessage
    }
  );

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Unable to download this media.');
  }

  // Verify the actual downloaded size.
  if (buffer.length > maxSize) {
    throw new Error(
      `Downloaded media exceeds the ${config.maxMediaMb || 45} MB limit.`
    );
  }

  return {
    buffer,
    media: mediaNode.media,
    mediaType: mediaNode.type
  };
}

// --------------------------------------------------
// FILE STORAGE
// --------------------------------------------------

async function saveMediaFile(buffer, type) {
  const directory = path.resolve(config.mediaDir);

  await fs.mkdir(directory, {
    recursive: true
  });

  const filename =
    `precious-${Date.now()}-${randomUUID()}.${type.ext}`;

  const destination = path.join(
    directory,
    filename
  );

  await fs.writeFile(destination, buffer, {
    flag: 'wx',
    mode: 0o600
  });

  return {
    filename,
    destination,
    directory
  };
}

// --------------------------------------------------
// MEDIA INFORMATION
// --------------------------------------------------

function getMediaInformation(media, type) {
  const fileLength = Number(media.fileLength || 0);

  return (
    `📁 *PRECIOUS-MD MEDIA INFORMATION*\n\n` +
    `Type: ${type.replace('Message', '')}\n` +
    `MIME: ${media.mimetype || 'Unknown'}\n` +
    `File name: ${media.fileName || 'Not provided'}\n` +
    `Size: ${fileLength > 0 ? formatBytes(fileLength) : 'Unknown'}\n` +
    `Width: ${media.width || 'N/A'}\n` +
    `Height: ${media.height || 'N/A'}\n` +
    `Duration: ${media.seconds ? `${media.seconds}s` : 'N/A'}`
  );
}

// --------------------------------------------------
// MEDIA PLUGINS
// --------------------------------------------------

export default [

  // ------------------------------------------------
  // MEDIA INFORMATION
  // ------------------------------------------------

  {
    command: 'mediainfo',
    aliases: ['fileinfo'],
    category: 'media',
    description: 'Inspect an image, video, audio or document',

    run: async ctx => {
      const current = getMediaNode(ctx.msg.message);

      const quoted = getQuotedMessage(ctx.msg.message);

      const selected = current
        ? current
        : quoted
          ? getMediaNode(quoted.message)
          : null;

      if (!selected) {
        return ctx.reply(
          'Send media with .mediainfo or reply to a media message with .mediainfo.'
        );
      }

      await ctx.reply(
        getMediaInformation(
          selected.media,
          selected.type
        )
      );
    }
  },

  // ------------------------------------------------
  // SAVE MEDIA
  // ------------------------------------------------

  {
    command: 'save',
    aliases: ['savemedia'],
    category: 'media',
    description: 'Save replied media temporarily',
    cooldown: 5,

    run: async ctx => {
      const message = getDownloadMessage(ctx);

      if (!message) {
        return ctx.reply(
          'Reply to an image, video, audio or document with .save.'
        );
      }

      try {
        await ctx.reply(
          '⏳ Downloading media...'
        );

        const {
          buffer,
          media,
          mediaType
        } = await downloadMedia(ctx, message);

        const detectedType = await fileTypeFromBuffer(buffer);

        if (!detectedType) {
          return ctx.reply(
            '❌ Unknown or unsupported media format.'
          );
        }

        const saved = await saveMediaFile(
          buffer,
          detectedType
        );

        await ctx.reply(
          `✅ *MEDIA SAVED TEMPORARILY*\n\n` +
          `File: ${saved.filename}\n` +
          `Category: ${mediaType.replace('Message', '')}\n` +
          `MIME: ${detectedType.mime}\n` +
          `Size: ${formatBytes(buffer.length)}\n\n` +
          `📂 Directory: ${saved.directory}\n\n` +
          `_Temporary files are automatically cleaned by maintenance._`
        );

      } catch (error) {
        console.error('[MEDIA SAVE]', error);

        await ctx.reply(
          `❌ Media save failed:\n${error.message}`
        );
      }
    }
  },

  // ------------------------------------------------
  // MEDIA HELP
  // ------------------------------------------------

  {
    command: 'mediatools',
    aliases: ['mediahelp'],
    category: 'media',
    description: 'Show available media commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD MEDIA TOOLS* 〕━━╮\n` +
        `┃\n` +
        `┃ 📁 .mediainfo\n` +
        `┃    Inspect media information\n` +
        `┃\n` +
        `┃ 💾 .save\n` +
        `┃    Save replied media temporarily\n` +
        `┃\n` +
        `┃ 🎨 .sticker\n` +
        `┃    Create a sticker from an image\n` +
        `┃\n` +
        `┃ 🏷️ .take\n` +
        `┃    Recreate a sticker with custom metadata\n` +
        `┃\n` +
        `┃ 🎵 .play\n` +
        `┃    Search and download audio\n` +
        `┃\n` +
        `┃ 🎧 .ytmp3\n` +
        `┃    Download audio from a supported URL\n` +
        `┃\n` +
        `┃ 🎬 .ytmp4\n` +
        `┃    Download video from a supported URL\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  }

];
