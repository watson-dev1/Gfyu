
import { saveDatabase } from './database.js';
import { getContextInfo } from './utils.js';

export async function handleAfk(sock, msg, sender, user) {
  // Automatically clear AFK when the user sends a new message.
  if (user.afk?.active) {
    const duration = Math.floor((Date.now() - user.afk.since) / 60000);
    delete user.afk;
    await saveDatabase();

    await sock.sendMessage(msg.key.remoteJid, {
      text: `👋 Welcome back! Your AFK status has been cleared. You were away for ${duration} minute(s).`
    }, { quoted: msg }).catch(() => {});
  }

  const context = getContextInfo(msg);
  const mentioned = context.mentionedJid || [];

  for (const jid of mentioned) {
    if (jid === sender) continue;

    const mentionedUser = globalThis.db.users?.[jid];

    if (!mentionedUser?.afk?.active) continue;

    const minutes = Math.floor(
      (Date.now() - mentionedUser.afk.since) / 60000
    );

    await sock.sendMessage(msg.key.remoteJid, {
      text:
        `💤 @${jid.split('@')[0]} is currently AFK.\n` +
        `Reason: ${mentionedUser.afk.reason}\n` +
        `Away for: ${minutes} minute(s).`,
      mentions: [jid]
    }, { quoted: msg }).catch(() => {});
  }
}
