
const cooldowns = new Map();

export function checkCooldown(key, seconds = 3) {
  const now = Date.now();
  const previous = cooldowns.get(key) || 0;
  const remaining = seconds * 1000 - (now - previous);

  if (remaining > 0) {
    return {
      allowed: false,
      remaining: Math.ceil(remaining / 1000)
    };
  }

  cooldowns.set(key, now);
  return { allowed: true, remaining: 0 };
}

export function cleanInput(value, maxLength = 2000) {
  return String(value || '')
    .replace(/\0/g, '')
    .slice(0, maxLength)
    .trim();
}

export function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidPhoneNumber(value) {
  return /^\d{7,15}$/.test(String(value || '').replace(/\D/g, ''));
}

export function isBlockedCommand(command, disabledCommands = []) {
  return disabledCommands.includes(String(command).toLowerCase());
}

export function getMessageKey(msg) {
  return [
    msg.key?.remoteJid || '',
    msg.key?.participant || '',
    msg.key?.id || ''
  ].join(':');
}
