
import config from '../config.js';
import { getGroup, saveDatabase } from './database.js';

export function installEventHandlers(sock) {
  // GROUP WELCOME AND GOODBYE
  sock.ev.on('group-participants.update', async update => {
    const { id, participants = [], action } = update;

    if (!id) return;

    const group = getGroup(id);

    if (action === 'add' && group.welcome) {
      for (const jid of participants) {
        const number = jid.split('@')[0];

        const message = (
          group.welcomeMessage ||
          `👋 Welcome @${number} to the group!`
        ).replace(/@user/gi, `@${number}`);

        await sock.sendMessage(id, {
          text: message,
          mentions: [jid]
        }).catch(error => {
          console.error('[WELCOME]', error.message);
        });
      }
    }

    if (
      ['remove', 'leave'].includes(action) &&
      group.goodbye
    ) {
      for (const jid of participants) {
        const number = jid.split('@')[0];

        const message = (
          group.goodbyeMessage ||
          `👋 Goodbye @${number}. We wish you well!`
        ).replace(/@user/gi, `@${number}`);

        await sock.sendMessage(id, {
          text: message,
          mentions: [jid]
        }).catch(error => {
          console.error('[GOODBYE]', error.message);
        });
      }
    }
  });

  // GROUP SETTINGS UPDATE
  sock.ev.on('groups.update', async updates => {
    for (const update of updates || []) {
      if (update.id) {
        getGroup(update.id);
      }
    }

    await saveDatabase().catch(error => {
      console.error('[GROUP UPDATE]', error.message);
    });
  });

  console.log('[PRECIOUS-MD] Group event handlers installed.');
}
