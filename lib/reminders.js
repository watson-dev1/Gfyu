
import { saveDatabase } from './database.js';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const CHECK_INTERVAL = 15_000;
const CLEANUP_AFTER = 7 * 24 * 60 * 60 * 1000;

const MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY = 60_000;
const MAX_RETRY_DELAY = 60 * 60 * 1000;

let scheduler = null;
let checking = false;
let activeSocket = null;

const deliveryLocks = new Set();

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

function getDatabase() {
  if (!globalThis.db) {
    throw new Error(
      'Database is not initialized.'
    );
  }

  if (
    !globalThis.db.reminders ||
    typeof globalThis.db.reminders !== 'object' ||
    Array.isArray(globalThis.db.reminders)
  ) {
    globalThis.db.reminders = {};
  }

  return globalThis.db.reminders;
}

// --------------------------------------------------
// VALIDATION
// --------------------------------------------------

function isValidReminder(reminder) {
  if (
    !reminder ||
    typeof reminder !== 'object' ||
    Array.isArray(reminder)
  ) {
    return false;
  }

  const chat = String(reminder.chat || '').trim();
  const message = String(reminder.message || '').trim();
  const dueAt = Number(reminder.dueAt);

  return (
    chat.length > 0 &&
    chat.includes('@') &&
    message.length > 0 &&
    Number.isFinite(dueAt) &&
    dueAt > 0
  );
}

// --------------------------------------------------
// REMINDER MESSAGE
// --------------------------------------------------

function buildReminderMessage(reminder) {
  const createdAt = Number(reminder.createdAt);

  const created = (
    Number.isFinite(createdAt) &&
    createdAt > 0
  )
    ? new Date(createdAt).toLocaleString()
    : 'Unknown';

  return (
    `⏰ *PRECIOUS-MD REMINDER*\n\n` +
    `${reminder.message}\n\n` +
    `Created: ${created}`
  );
}

// --------------------------------------------------
// RETRY MANAGEMENT
// --------------------------------------------------

function getRetryDelay(attempts) {
  const delay =
    RETRY_BASE_DELAY * Math.pow(2, Math.max(0, attempts - 1));

  return Math.min(delay, MAX_RETRY_DELAY);
}

function shouldRetry(reminder, now) {
  const retryAt = Number(reminder.retryAt) || 0;

  return retryAt <= now;
}

// --------------------------------------------------
// STATISTICS
// --------------------------------------------------

export function getReminderStats() {
  const reminders = getDatabase();

  const stats = {
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    overdue: 0,
    retrying: 0
  };

  const now = Date.now();

  for (const reminder of Object.values(reminders)) {
    if (!reminder || typeof reminder !== 'object') {
      continue;
    }

    stats.total++;

    if (reminder.sent === true) {
      stats.sent++;
    } else if (reminder.failed === true) {
      stats.failed++;
    } else {
      stats.pending++;

      if (Number(reminder.dueAt) <= now) {
        stats.overdue++;

        if (Number(reminder.retryAt) > now) {
          stats.retrying++;
        }
      }
    }
  }

  return stats;
}

// --------------------------------------------------
// DELIVERY
// --------------------------------------------------

async function deliverReminder(sock, id, reminder) {
  const attempts = Math.max(
    0,
    Number(reminder.attempts) || 0
  );

  if (attempts >= MAX_ATTEMPTS) {
    reminder.failed = true;
    reminder.failedAt = Date.now();

    reminder.deliveryError ||=
      'Maximum delivery attempts reached.';

    return;
  }

  try {
    await sock.sendMessage(
      reminder.chat,
      {
        text: buildReminderMessage(reminder)
      }
    );

    reminder.sent = true;
    reminder.sentAt = Date.now();

    delete reminder.deliveryError;
    delete reminder.retryAt;

    console.log(
      `[REMINDER] Successfully delivered: ${id}`
    );

  } catch (error) {
    const nextAttempt = attempts + 1;

    reminder.attempts = nextAttempt;

    reminder.deliveryError = String(
      error.message || error
    ).slice(0, 200);

    reminder.lastAttemptAt = Date.now();

    if (nextAttempt >= MAX_ATTEMPTS) {
      reminder.failed = true;
      reminder.failedAt = Date.now();

      delete reminder.retryAt;

      console.error(
        `[REMINDER] Permanently failed: ${id}`
      );

    } else {
      const delay = getRetryDelay(nextAttempt);

      reminder.retryAt = Date.now() + delay;

      console.error(
        `[REMINDER] Delivery failed: ${id}. ` +
        `Retry in ${Math.ceil(delay / 1000)} seconds.`
      );
    }
  }
}

// --------------------------------------------------
// CLEANUP
// --------------------------------------------------

function cleanupOldReminders(reminders, now) {
  let changed = false;

  for (const [id, reminder] of Object.entries(reminders)) {
    if (!reminder) {
      delete reminders[id];
      changed = true;
      continue;
    }

    const completedAt = reminder.sent === true
      ? Number(reminder.sentAt)
      : reminder.failed === true
        ? Number(reminder.failedAt)
        : 0;

    if (
      completedAt > 0 &&
      Number.isFinite(completedAt) &&
      now - completedAt > CLEANUP_AFTER
    ) {
      delete reminders[id];
      changed = true;
    }
  }

  return changed;
}

// --------------------------------------------------
// PROCESS REMINDERS
// --------------------------------------------------

export async function checkReminders(sock = activeSocket) {
  if (
    checking ||
    !sock ||
    !globalThis.db
  ) {
    return false;
  }

  // Do not use an old socket after reconnection.
  if (activeSocket && activeSocket !== sock) {
    return false;
  }

  checking = true;

  let changed = false;

  try {
    const reminders = getDatabase();
    const now = Date.now();

    for (const [id, reminder] of Object.entries(reminders)) {
      if (
        deliveryLocks.has(id) ||
        !reminder ||
        reminder.sent === true ||
        reminder.failed === true
      ) {
        continue;
      }

      if (!isValidReminder(reminder)) {
        reminder.failed = true;
        reminder.failedAt = Date.now();
        reminder.deliveryError = 'Invalid reminder data.';

        changed = true;
        continue;
      }

      const dueAt = Number(reminder.dueAt);

      if (dueAt > now) {
        continue;
      }

      if (!shouldRetry(reminder, now)) {
        continue;
      }

      const attempts = Math.max(
        0,
        Number(reminder.attempts) || 0
      );

      if (attempts >= MAX_ATTEMPTS) {
        reminder.failed = true;
        reminder.failedAt = Date.now();

        reminder.deliveryError ||=
          'Maximum delivery attempts reached.';

        changed = true;
        continue;
      }

      deliveryLocks.add(id);

      try {
        await deliverReminder(sock, id, reminder);
        changed = true;

        // Persist each delivery result immediately.
        await saveDatabase();
        changed = false;

      } finally {
        deliveryLocks.delete(id);
      }

      // Stop if the active connection changed.
      if (activeSocket && activeSocket !== sock) {
        break;
      }
    }

    if (
      cleanupOldReminders(
        reminders,
        Date.now()
      )
    ) {
      changed = true;
    }

    if (changed) {
      await saveDatabase();
    }

    return true;

  } finally {
    checking = false;
  }
}

// --------------------------------------------------
// SCHEDULER
// --------------------------------------------------

export function startReminderScheduler(sock) {
  if (!sock) {
    throw new Error(
      'A valid WhatsApp socket is required.'
    );
  }

  stopReminderScheduler();

  activeSocket = sock;

  checkReminders(sock).catch(error => {
    console.error(
      '[REMINDER CHECK]',
      error.message
    );
  });

  scheduler = setInterval(() => {
    if (activeSocket !== sock) {
      return;
    }

    checkReminders(sock).catch(error => {
      console.error(
        '[REMINDER SCHEDULER]',
        error.message
      );
    });
  }, CHECK_INTERVAL);

  scheduler.unref?.();

  console.log(
    '[PRECIOUS-MD] Reminder scheduler started.'
  );

  return scheduler;
}

// --------------------------------------------------
// STOP SCHEDULER
// --------------------------------------------------

export function stopReminderScheduler() {
  if (scheduler) {
    clearInterval(scheduler);
  }

  scheduler = null;
  activeSocket = null;
}

// --------------------------------------------------
// STATUS
// --------------------------------------------------

export function isReminderSchedulerRunning() {
  return scheduler !== null;
}

export function getReminderSchedulerStatus() {
  return {
    running: isReminderSchedulerRunning(),
    checking,
    active: Boolean(activeSocket),
    lockedDeliveries: deliveryLocks.size,
    stats: getReminderStats()
  };
}
