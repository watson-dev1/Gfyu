
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';

async function getMedia(ctx) {
  try {
    return await downloadMediaMessage(
      ctx.msg,
      'buffer',
      {},
      {
        logger: undefined,
        reuploadRequest: ctx.sock.updateMediaMessage
      }
    );
  } catch {
    return null;
  }
}

async function makeSticker(ctx, buffer, type = StickerTypes.FULL) {
  const sticker = new Sticker(buffer, {
    pack: 'PRECIOUS-MD',
    author: 'Watson Fourpence',
    type,
    quality: 75
  });

  const output = await sticker.toBuffer();

  await ctx.send({
    sticker: output
  });
}

export default [
  {
    command: 'sticker',
    aliases: ['s', 'stiker'],
    category: 'sticker',
    description: 'Convert an image into a WhatsApp sticker',
    run: async ctx => {
      const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      const hasImage =
        ctx.msg.message?.imageMessage ||
        quoted?.imageMessage;

      if (!hasImage) {
        return ctx.reply(
          'Reply to an image with .sticker to create a sticker.'
        );
      }

      await ctx.react('⏳');

      const source = quoted
        ? {
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
          }
        : ctx.msg;

      try {
        const buffer = await downloadMediaMessage(
          source,
          'buffer',
          {},
          { logger: undefined }
        );

        await makeSticker(ctx, buffer);
      } catch (error) {
        await ctx.reply(`❌ Sticker conversion failed: ${error.message}`);
      }
    }
  },

  {
    command: 'stickerinfo',
    aliases: ['sinfo'],
    category: 'sticker',
    description: 'Show sticker command information',
    run: async ctx => {
      await ctx.reply(
        `🎨 *PRECIOUS-MD STICKER TOOLS*\n\n` +
        `• .sticker — Create a sticker from an image\n` +
        `• .s — Sticker shortcut\n\n` +
        `Reply to an image with the command.`
      );
    }
  },

  {
    command: 'take',
    aliases: ['steal'],
    category: 'sticker',
    description: 'Recreate a sticker with custom pack metadata',
    run: async ctx => {
      const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (!quoted?.stickerMessage && !ctx.msg.message?.stickerMessage) {
        return ctx.reply('Reply to a sticker with .take.');
      }

      try {
        const source = quoted
          ? {
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
            }
          : ctx.msg;

        const buffer = await downloadMediaMessage(
          source,
          'buffer',
          {},
          { logger: undefined }
        );

        const sticker = new Sticker(buffer, {
          pack: ctx.args[0] || 'PRECIOUS-MD',
          author: ctx.args.slice(1).join(' ') || 'Watson Fourpence',
          type: StickerTypes.FULL,
          quality: 75
        });

        await ctx.send({ sticker: await sticker.toBuffer() });
      } catch (error) {
        await ctx.reply(`❌ Failed to process sticker: ${error.message}`);
      }
    }
  }
];
