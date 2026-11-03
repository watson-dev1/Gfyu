
import {
  generateWAMessageFromContent,
  proto
} from '@whiskeysockets/baileys';

/**
 * Send up to three WhatsApp native-flow quick-reply buttons.
 *
 * Each button:
 * {
 *   text: 'Button label',
 *   id: '.command'
 * }
 */
export async function sendQuickButtons(
  sock,
  jid,
  {
    title = 'PRECIOUS-MD',
    body = 'Choose an option below.',
    footer = 'Created by Watson Fourpence',
    buttons = [],
    quoted
  } = {}
) {
  if (!sock || !jid) {
    throw new Error('A WhatsApp socket and destination JID are required.');
  }

  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('At least one button is required.');
  }

  // Validate and limit the buttons.
  const selected = buttons
    .slice(0, 3)
    .map(button => ({
      text: String(button?.text || '').trim().slice(0, 25),
      id: String(button?.id || '').trim()
    }))
    .filter(button => button.text && button.id);

  if (!selected.length) {
    throw new Error('No valid buttons were supplied.');
  }

  const nativeButtons = selected.map(button => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: button.text,
      id: button.id
    })
  }));

  // Build the interactive message.
  const interactiveMessage =
    proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({
        title: String(title).slice(0, 60),
        subtitle: 'WhatsApp Assistant',
        hasMediaAttachment: false
      }),

      body: proto.Message.InteractiveMessage.Body.create({
        text: String(body)
      }),

      footer: proto.Message.InteractiveMessage.Footer.create({
        text: String(footer)
      }),

      nativeFlowMessage:
        proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: nativeButtons
        })
    });

  const content = {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage
      }
    }
  };

  const options = {};

  if (sock.user?.id) {
    options.userJid = sock.user.id;
  }

  if (quoted) {
    options.quoted = quoted;
  }

  try {
    const message = generateWAMessageFromContent(
      jid,
      content,
      options
    );

    await sock.relayMessage(
      jid,
      message.message,
      {
        messageId: message.key.id
      }
    );

    return message;

  } catch (nativeError) {
    console.error(
      '[PRECIOUS-MD BUTTONS] Native buttons failed:',
      nativeError.message
    );

    // Fallback for clients or environments where
    // native-flow messages cannot be sent.
    const fallbackText = [
      `*${title}*`,
      '',
      body,
      '',
      ...selected.map(
        (button, index) =>
          `${index + 1}. ${button.text}\n   ${button.id}`
      ),
      '',
      footer
    ].join('\n');

    try {
      return await sock.sendMessage(
        jid,
        { text: fallbackText },
        quoted ? { quoted } : {}
      );
    } catch (fallbackError) {
      throw new Error(
        `Could not send buttons or text fallback: ${fallbackError.message}`,
        { cause: nativeError }
      );
    }
  }
}
