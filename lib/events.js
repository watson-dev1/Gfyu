
import {
  getGroup,
  saveDatabase
} from './database.js';

import { normalizeJid } from './utils.js';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const installedSockets = new WeakSet();

const MAX_MESSAGE_LENGTH = 3000;
const MAX_GROUP_NAME_LENGTH = 100;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getNumber(jid = '') {
  return String(jid || '')
    .split('@')[0]
    .split(':')[0];
}

function getParticipantJid(participant) {
  if (typeof participant === 'string') {
    return normalizeJid(participant);
  }

  if (!participant || typeof participant !== 'object') {
    return '';
  }

  return normalizeJid(
    participant.id ||
    participant.jid ||
    participant.lid ||
    ''
  );
}

function uniqueParticipants(participants = []) {
  const seen = new Set();
  const result = [];

  for (const participant of participants) {
    const jid = getParticipantJid(participant);

    if (!jid || !jid.includes('@') || seen.has(jid)) {
      continue;
    }

    seen.add(jid);
    result.push(jid);
  }

  return result;
}

function replacePlaceholders(message, {
  user = '',
  group = '',
  subject = '',
  desc = ''
} = {}) {
  return String(message || '')
    .replace(/@user/gi, `@${getNumber(user)}`)
    .replace(/@group/gi, group)
    .replace(/@subject/gi, subject)
    .replace(/@desc/gi, desc)
    .slice(0, MAX_MESSAGE_LENGTH);
}

async function safeSend(sock, jid, content, label) {
  try {
    await sock.sendMessage(jid, content);
    return true;
  } catch (error) {
    console.error(`[${label}]`, error.message);
    return false;
  }
}

function getDefaultWelcome(jid, groupName) {
  return (
    `👋 Welcome @${getNumber(jid)} to ${groupName}!\n\n` +
    `Please read the group rules and enjoy your stay.`
  );
}

function getDefaultGoodbye(jid) {
  return (
    `👋 Goodbye @${getNumber(jid)}.\n\n` +
    `We wish you well!`
  );
}

// --------------------------------------------------
// WELCOME / GOODBYE
// --------------------------------------------------

async function handleParticipantsUpdate(sock, update) {
  const {
    id,
    participants = [],
    action
  } = update || {};

  if (
    !id ||
    !Array.isArray(participants) ||
    !['add', 'remove', 'leave'].includes(action)
  ) {
    return;
  }

  let group;

  try {
    group = getGroup(id);
  } catch (error) {
    console.error('[GROUP EVENTS]', error.message);
    return;
  }

  const isWelcome =
    action === 'add' &&
    group.welcome === true;

  const isGoodbye =
    ['remove', 'leave'].includes(action) &&
    group.goodbye === true;

  if (!isWelcome && !isGoodbye) {
    return;
  }

  let groupName = 'this group';

  try {
    const metadata = await sock.groupMetadata(id);

    if (metadata?.subject) {
      groupName = String(metadata.subject)
        .slice(0, MAX_GROUP_NAME_LENGTH);
    }
  } catch (error) {
    console.error('[GROUP METADATA]', error.message);
  }

  const members = uniqueParticipants(participants);

  for (const jid of members) {
    const customMessage = isWelcome
      ? group.welcomeMessage
      : group.goodbyeMessage;

    const defaultMessage = isWelcome
      ? getDefaultWelcome(jid, groupName)
      : getDefaultGoodbye(jid);

    const message = replacePlaceholders(
      customMessage || defaultMessage,
      {
        user: jid,
        group: groupName,
        subject: groupName
      }
    );

    await safeSend(
      sock,
      id,
      {
        text: message,
        mentions: [jid]
      },
      isWelcome ? 'WELCOME' : 'GOODBYE'
    );
  }
}

// --------------------------------------------------
// GROUP SUBJECT / DESCRIPTION UPDATES
// --------------------------------------------------

async function handleGroupsUpdate(sock, updates) {
  if (!Array.isArray(updates)) {
    return;
  }

  for (const update of updates) {
    if (!update?.id) {
      continue;
    }

    try {
      const group = getGroup(update.id);

      if (
        typeof update.subject === 'string' &&
        group.notifySubjectChanges === true
      ) {
        const subject = update.subject
          .slice(0, MAX_GROUP_NAME_LENGTH);

        await safeSend(
          sock,
          update.id,
          {
            text:
              `📝 *GROUP NAME UPDATED*\n\n` +
              `New name: *${subject}*`
          },
          'GROUP SUBJECT'
        );
      }

      if (
        typeof update.desc === 'string' &&
        group.notifyDescriptionChanges === true
      ) {
        await safeSend(
          sock,
          update.id,
          {
            text:
              `📌 *GROUP DESCRIPTION UPDATED*\n\n` +
              `The group description has been changed.`
          },
          'GROUP DESCRIPTION'
        );
      }
    } catch (error) {
      console.error('[GROUP UPDATE]', error.message);
    }
  }
}

// --------------------------------------------------
// INSTALL EVENT HANDLERS
// --------------------------------------------------

export function installEventHandlers(sock) {
  if (!sock?.ev) {
    throw new Error(
      'A valid Baileys socket is required.'
    );
  }

  if (installedSockets.has(sock)) {
    return false;
  }

  installedSockets.add(sock);

  // New member / member leaving.
  sock.ev.on(
    'group-participants.update',
    async update => {
      try {
        await handleParticipantsUpdate(
          sock,
          update
        );
      } catch (error) {
        console.error(
          '[GROUP PARTICIPANTS]',
          error.message
        );
      }
    }
  );

  // Group name / description changes.
  sock.ev.on(
    'groups.update',
    async updates => {
      try {
        await handleGroupsUpdate(
          sock,
          updates
        );
      } catch (error) {
        console.error(
          '[GROUP UPDATE]',
          error.message
        );
      }
    }
  );

  console.log(
    '[PRECIOUS-MD] Group event handlers installed.'
  );

  return true;
}
