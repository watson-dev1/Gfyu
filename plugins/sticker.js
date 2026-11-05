
import {
  downloadMediaMessage
} from '@whiskeysockets/baileys';

import {
  Sticker,
  StickerTypes
} from 'wa-sticker-formatter';

import {
  fileTypeFromBuffer
} from 'file-type';

import config from '../config.js';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const DEFAULT_PACK = 'PRECIOUS-MD';
const DEFAULT_AUTHOR = 'Watson Fourpence';

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

  for (const type of [
    'imageMessage',
    'stickerMessage'
  ]) {
    if (unwrapped[type]) {
      return {
        type,
        media: unwrapped[type]
      };
    }
  }

  return null;
}

function getQuotedMedia(ctx) {
  const message = unwrapMessage(ctx.msg.message);

  const context =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (!context?.quotedMessage) {
    return null;
  }

  const quotedMessage = context.quotedMessage;

  if (!getMediaNode(quotedMessage)) {
    return null;
  }

  return {
    message: {
      key: {
        remoteJid: ctx.chat || ctx.msg.key?.remoteJid,
        fromMe: false,
        id: context.stanzaId,
        participant: context.participant
      },
      message: quotedMessage
    }
  };
}

function getSourceMessage(ctx, allowedTypes) {
  const current = getMediaNode(ctx.msg.message);

  if (current && allowedTypes.includes(current.type)) {
    return ctx.msg;
  }

  const quoted = getQuotedMedia(ctx);

  if (!quoted) return null;

  const quotedMedia = getMediaNode(
    quoted.message.message
  );

  if (
    !quotedMedia ||
    !allowedTypes.includes(quotedMedia.type)
  ) {
    return null;
  }

  return quoted.message;
}

// --------------------------------------------------
// DOWNLOAD MEDIA
// --------------------------------------------------

async function getMedia(ctx, message) {
  if (!message) {
    throw new Error('No supported media message was found.');
  }

  const mediaNode = getMediaNode(message.message);

  if (!mediaNode) {
    throw new Error('Unsupported media format.');
  }

  const maxSize = getMaxMediaSize();
  const declaredSize = Number(
    mediaNode.media.fileLength || 0
  );

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
    throw new Error('Media download failed.');
  }

  if (buffer.length > maxSize) {
    throw new Error('Downloaded media exceeds the size limit.');
  }

  return buffer;
}

// --------------------------------------------------
// STICKER CREATION
// --------------------------------------------------

async function makeSticker(
  ctx,
  buffer,
  {
    pack = DEFAULT_PACK,
    author = DEFAULT_AUTHOR,
    type = StickerTypes.FULL
  } = {}
) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Invalid media buffer.');
  }

  const sticker = new Sticker(buffer, {
    pack: String(pack).slice(0, 64),
    author: String(author).slice(0, 64),
    type,
    quality: 75
  });

  const output = await sticker.toBuffer();

  if (!output?.length) {
    throw new Error('Sticker generation returned an empty file.');
  }

  await ctx.send({
    sticker: output
  });

  return output;
}

// --------------------------------------------------
// REACT SAFELY
// --------------------------------------------------

async function react(ctx, emoji) {
  try {
    await ctx.react?.(emoji);
  } catch {
    // Reactions are optional; do not interrupt sticker creation.
  }
}

// --------------------------------------------------
// STICKER PLUGINS
// --------------------------------------------------

export default [

  // ------------------------------------------------
  // CREATE STICKER
  // ------------------------------------------------

  {
    command: 'sticker',
    aliases: ['s', 'stiker'],
    category: 'sticker',
    description: 'Convert an image into a WhatsApp sticker',
    cooldown: 5,

    run: async ctx => {
      const source = getSourceMessage(
        ctx,
        ['imageMessage']
      );

      if (!source) {
        return ctx.reply(
          '🖼️ Send an image or reply to an image with .sticker.'
        );
      }

      await react(ctx, '⏳');

      try {
        const buffer = await getMedia(ctx, source);
        const detected = await fileTypeFromBuffer(buffer);

        if (
          !detected ||
          !['jpg', 'jpeg', 'png', 'webp'].includes(detected.ext)
        ) {
          throw new Error('Please provide a supported image.');
        }

        await makeSticker(ctx, buffer);

        await react(ctx, '✅');

      } catch (error) {
        console.error('[STICKER]', error);

        await ctx.reply(
          `❌ Sticker conversion failed:\n${error.message}`
        );

        await react(ctx, '❌');
      }
    }
  },

  // ------------------------------------------------
  // STICKER INFORMATION
  // ------------------------------------------------

  {
    command: 'stickerinfo',
    aliases: ['sinfo', 'stickerhelp'],
    category: 'sticker',
    description: 'Show sticker command information',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD STICKER TOOLS* 〕━━╮\n` +
        `┃\n` +
        `┃ 🎨 .sticker\n` +
        `┃    Convert an image into a sticker\n` +
        `┃\n` +
        `┃ ⚡ .s\n` +
        `┃    Sticker shortcut\n` +
        `┃\n` +
        `┃ 🏷️ .take\n` +
        `┃    Change sticker pack metadata\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `Reply to an image or sticker with the command.`
      );
    }
  },

  // ------------------------------------------------
  // CUSTOM STICKER METADATA
  // ------------------------------------------------

  {
    command: 'take',
    aliases: ['steal'],
    category: 'sticker',
    description: 'Recreate a sticker with custom pack metadata',
    cooldown: 5,

    run: async ctx => {
      const source = getSourceMessage(
        ctx,
        ['stickerMessage']
      );

      if (!source) {
        return ctx.reply(
          'Reply to a WhatsApp sticker with .take.'
        );
      }

      await react(ctx, '⏳');

      try {
        const buffer = await getMedia(ctx, source);

        const detected = await fileTypeFromBuffer(buffer);

        if (!detected || detected.ext !== 'webp') {
          throw new Error('The downloaded file is not a valid WebP sticker.');
        }

        const pack = ctx.args?.[0] || DEFAULT_PACK;

        const author = ctx.args?.length > 1
          ? ctx.args.slice(1).join(' ')
          : DEFAULT_AUTHOR;

        await makeSticker(ctx, buffer, {
          pack,
          author,
          type: StickerTypes.FULL
        });

        await react(ctx, '✅');

      } catch (error) {
        console.error('[STICKER TAKE]', error);

        await ctx.reply(
          `❌ Failed to process sticker:\n${error.message}`
        );

        await react(ctx, '❌');
      }
    }
  }

];
