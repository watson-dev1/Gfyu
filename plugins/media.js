
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

import { formatBytes } from '../lib/utils.js';

async function downloadCurrentMessage(ctx) {
  return downloadMediaMessage(
    ctx.msg,
    'buffer',
    {},
    { logger: undefined }
  );
}

export default [
  {
    command: 'mediainfo',
    aliases: ['fileinfo'],
    category: 'media',
    description: 'Inspect an image, video, audio or document',
    run: async ctx => {
      const message = ctx.msg.message || {};

      const media =
        message.imageMessage ||
        message.videoMessage ||
        message.audioMessage ||
        message.documentMessage ||
        message.stickerMessage;

      if (!media) {
        return ctx.reply('Send or reply to a media message with .mediainfo.');
      }

      await ctx.reply(
        `📁 *MEDIA INFORMATION*\n\n` +
        `Type: ${media.mimetype || 'Unknown'}\n` +
        `File name: ${media.fileName || 'Not provided'}\n` +
        `Size: ${media.fileLength ? formatBytes(Number(media.fileLength)) : 'Unknown'}\n` +
        `Width: ${media.width || 'N/A'}\n` +
        `Height: ${media.height || 'N/A'}\n` +
        `Duration: ${media.seconds ? `${media.seconds}s` : 'N/A'}`
      );
    }
  },

  {
    command: 'save',
    aliases: ['savemedia'],
    category: 'media',
    description: 'Save replied media temporarily',
    cooldown: 5,
    run: async ctx => {
      const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (!quoted) {
        return ctx.reply('Reply to an image, video, audio or document with .save.');
      }

      const temporaryMessage = {
        ...ctx.msg,
        message: {
          extendedTextMessage: {
            contextInfo: {
              quotedMessage: quoted,
              participant: ctx.msg.message.extendedTextMessage.contextInfo.participant,
              stanzaId: ctx.msg.message.extendedTextMessage.contextInfo.stanzaId
            }
          }
        }
      };

      try {
        const buffer = await downloadMediaMessage(
          temporaryMessage,
          'buffer',
          {},
          { logger: undefined }
        );

        if (!buffer?.length) {
          return ctx.reply('Unable to download this media.');
        }

        if (buffer.length > config.maxMediaMb * 1024 * 1024) {
          return ctx.reply('Media exceeds the configured size limit.');
        }

        const type = await fileTypeFromBuffer(buffer);

        if (!type) {
          return ctx.reply('Unknown or unsupported media format.');
        }

        const filename = `precious-${Date.now()}.${type.ext}`;
        const directory = path.resolve(config.mediaDir);
        const destination = path.join(directory, filename);

        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(destination, buffer);

        await ctx.reply(
          `✅ Media saved temporarily.\n` +
          `File: ${filename}\n` +
          `Type: ${type.mime}\n` +
          `Size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`
        );

        // Temporary files are cleaned by the maintenance task.
      } catch (error) {
        await ctx.reply(`❌ Media save failed: ${error.message}`);
      }
    }
  },

  {
    command: 'mediatools',
    aliases: ['mediahelp'],
    category: 'media',
    description: 'Show available media commands',
    run: async ctx => {
      await ctx.reply(
        `🎬 *PRECIOUS-MD MEDIA TOOLS*\n\n` +
        `• .mediainfo — Inspect media information\n` +
        `• .save — Save replied media temporarily\n` +
        `• .sticker — Create a sticker from an image\n` +
        `• .take — Recreate a sticker with custom metadata\n` +
        `• .play — Search and download audio\n` +
        `• .ytmp3 — Download audio from a supported URL\n` +
        `• .ytmp4 — Download video from a supported URL`
      );
    }
  }
];
