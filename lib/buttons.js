
import {
  generateWAMessageFromContent,
  proto
} from '@whiskeysockets/baileys';

const MAX_BUTTONS = 3;
const MAX_LABEL_LENGTH = 25;
const MAX_ID_LENGTH = 100;

function validateButtons(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error('At least one button is required.');
  }

  return buttons
    .slice(0, MAX_BUTTONS)
    .map(button => ({
      text: String(button?.text || '')
        .trim()
        .slice(0, MAX_LABEL_LENGTH),

      id: String(button?.id || '')
        .trim()
        .slice(0, MAX_ID_LENGTH)
    }))
    .filter(button => button.text && button.id);
}

function createFallback(title, body, footer, buttons) {
  return [
    `*${title}*`,
    '',
    body,
    '',
    ...buttons.map(
      (button, index) =>
        `${index + 1}. ${button.text}\n   ${button.id}`
    ),
    '',
    footer
  ].join('\n');
}

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
    throw new Error(
      'A WhatsApp socket and destination JID are required.'
    );
  }

  const selected = validateButtons(buttons);

  if (!selected.length) {
    throw new Error('No valid buttons were supplied.');
  }

  const safeTitle = String(title).slice(0, 60);
  const safeBody = String(body).slice(0, 3000);
  const safeFooter = String(footer).slice(0, 60);

  const nativeButtons = selected.map(button => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: button.text,
      id: button.id
    })
  }));

  const interactiveMessage =
    proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({
        title: safeTitle,
        subtitle: 'WhatsApp Assistant',
        hasMediaAttachment: false
      }),

      body: proto.Message.InteractiveMessage.Body.create({
        text: safeBody
      }),

      footer: proto.Message.InteractiveMessage.Footer.create({
        text: safeFooter
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
      '[PRECIOUS-MD BUTTONS] Native-flow error:',
      nativeError.message
    );

    const fallbackText = createFallback(
      safeTitle,
      safeBody,
      safeFooter,
      selected
    );

    try {
      return await sock.sendMessage(
        jid,
        { text: fallbackText },
        quoted ? { quoted } : {}
      );

    } catch (fallbackError) {
      console.error(
        '[PRECIOUS-MD BUTTONS] Fallback error:',
        fallbackError.message
      );

      throw new Error(
        `Button delivery failed: ${fallbackError.message}`,
        { cause: nativeError }
      );
    }
  }
}

// Reusable PRECIOUS-MD navigation buttons.
export const menuButtons = {
  main: [
    { text: 'GENERAL', id: '.generalmenu' },
    { text: 'GROUP', id: '.groupmenu' },
    { text: 'TOOLS', id: '.toolsmenu' }
  ],

  general: [
    { text: 'MAIN MENU', id: '.menu' },
    { text: 'OWNER', id: '.ownermenu' },
    { text: 'GROUP', id: '.groupmenu' }
  ],

  group: [
    { text: 'MAIN MENU', id: '.menu' },
    { text: 'GENERAL', id: '.generalmenu' },
    { text: 'TOOLS', id: '.toolsmenu' }
  ],

  tools: [
    { text: 'MAIN MENU', id: '.menu' },
    { text: 'GENERAL', id: '.generalmenu' },
    { text: 'OWNER', id: '.ownermenu' }
  ]
};
