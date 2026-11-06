
// --------------------------------------------------
// PRECIOUS-MD GUARDS
// Cooldowns, input validation and message helpers
// --------------------------------------------------

const cooldowns = new Map();

const MAX_COOLDOWN_ENTRIES = 10000;
const COOLDOWN_CLEANUP_INTERVAL = 60000;

// --------------------------------------------------
// COOLDOWN CLEANUP
// --------------------------------------------------

function cleanupCooldowns() {
  const now = Date.now();

  for (const [key, timestamp] of cooldowns.entries()) {
    if (now - timestamp > 3600000) {
      cooldowns.delete(key);
    }
  }

  // Prevent unlimited memory usage.
  if (cooldowns.size > MAX_COOLDOWN_ENTRIES) {
    const entries = [...cooldowns.entries()]
      .sort((a, b) => a[1] - b[1]);

    const removeCount = cooldowns.size - MAX_COOLDOWN_ENTRIES;

    for (let i = 0; i < removeCount; i++) {
      cooldowns.delete(entries[i][0]);
    }
  }
}

const cleanupTimer = setInterval(
  cleanupCooldowns,
  COOLDOWN_CLEANUP_INTERVAL
);

cleanupTimer.unref?.();

// --------------------------------------------------
// COOLDOWN CHECK
// --------------------------------------------------

export function checkCooldown(key, seconds = 3) {
  if (!key) {
    return {
      allowed: true,
      remaining: 0
    };
  }

  const duration = Number(seconds);

  const safeDuration = Number.isFinite(duration)
    ? Math.max(0, Math.min(duration, 86400))
    : 3;

  if (safeDuration === 0) {
    return {
      allowed: true,
      remaining: 0
    };
  }

  const now = Date.now();
  const cooldownKey = String(key);
  const previous = cooldowns.get(cooldownKey) || 0;

  const remaining =
    safeDuration * 1000 - (now - previous);

  if (remaining > 0) {
    return {
      allowed: false,
      remaining: Math.ceil(remaining / 1000)
    };
  }

  cooldowns.set(cooldownKey, now);

  return {
    allowed: true,
    remaining: 0
  };
}

// --------------------------------------------------
// CLEAR COOLDOWN
// --------------------------------------------------

export function clearCooldown(key) {
  if (!key) return false;

  return cooldowns.delete(String(key));
}

export function clearAllCooldowns() {
  cooldowns.clear();
}

// --------------------------------------------------
// INPUT CLEANING
// --------------------------------------------------

export function cleanInput(value, maxLength = 2000) {
  const limit = Number.isFinite(Number(maxLength))
    ? Math.max(0, Math.min(Number(maxLength), 100000))
    : 2000;

  return String(value ?? '')
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .slice(0, limit)
    .trim();
}

// --------------------------------------------------
// HTTP URL VALIDATION
// --------------------------------------------------

export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value.trim());

    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

// --------------------------------------------------
// PHONE NUMBER VALIDATION
// --------------------------------------------------

export function isValidPhoneNumber(value) {
  const number = String(value ?? '')
    .replace(/\D/g, '');

  return /^\d{7,15}$/.test(number);
}

// --------------------------------------------------
// COMMAND VALIDATION
// --------------------------------------------------

export function normalizeCommand(command) {
  return String(command ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[.!#/]+/, '');
}

export function isBlockedCommand(command, disabledCommands = []) {
  const target = normalizeCommand(command);

  if (!target || !Array.isArray(disabledCommands)) {
    return false;
  }

  return disabledCommands.some(item => {
    return normalizeCommand(item) === target;
  });
}

// --------------------------------------------------
// WHATSAPP MESSAGE KEY
// --------------------------------------------------

export function getMessageKey(msg) {
  if (!msg?.key) {
    return '';
  }

  const key = msg.key;

  return [
    key.remoteJid || '',
    key.participant || '',
    key.id || ''
  ].join(':');
}

// --------------------------------------------------
// SAFE STRING COMPARISON
// --------------------------------------------------

export function safeString(value, fallback = '') {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (
    typeof value === 'object' ||
    typeof value === 'function'
  ) {
    return fallback;
  }

  return String(value);
}

// --------------------------------------------------
// EXPORT COOLDOWN STATISTICS
// --------------------------------------------------

export function getCooldownStats() {
  return {
    active: cooldowns.size,
    maximum: MAX_COOLDOWN_ENTRIES
  };
}
