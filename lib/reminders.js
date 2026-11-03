
import { saveDatabase } from './database.js';

let scheduler = null;
let checking = false;

function getDatabase() {
  globalThis.db.reminders ||= {};
  return globalThis.db.reminders;
}

export async function checkReminders(sock) {
  if (checking || !globalThis.db) return;

  checking = true;

  try {
    const reminders = getDatabase();
    const now = Date.now();

    for (const [id, reminder] of Object.entries(reminders)) {
      if (!reminder || reminder.sent || reminder.dueAt > now) continue;

      // Mark before sending to avoid duplicate delivery after an error.
      reminder.sent = true;
      reminder.sentAt = now;
      await saveDatabase();

      try {
        await sock.sendMessage(reminder.chat, {
          text:
            `⏰ *PRECIOUS-MD REMINDER*\n\n` +
            `${reminder.message}\n\n` +
            `Created: ${new Date(reminder.createdAt).toLocaleString()}`
        });
      } catch (error) {
        console.error(`Reminder delivery failed (${id}):`, error.message);
        reminder.deliveryError = String(error.message || error).slice(0, 200);
        await saveDatabase();
      }
    }

    // Keep the database small.
    for (const [id, reminder] of Object.entries(reminders)) {
      if (reminder?.sent && now - (reminder.sentAt || now) > 7 * 86400000) {
        delete reminders[id];
      }
    }

    await saveDatabase();
  } finally {
    checking = false;
  }
}

export function startReminderScheduler(sock) {
  if (scheduler) clearInterval(scheduler);

  checkReminders(sock).catch(console.error);

  scheduler = setInterval(() => {
    checkReminders(sock).catch(console.error);
  }, 15000);

  scheduler.unref?.();

  return scheduler;
}

export function stopReminderScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}
