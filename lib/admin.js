
import {
  getMentioned,
  getQuotedParticipant,
  normalizeJid,
  isOwnerOrSudo
} from './utils.js';

// --------------------------------------------------
// PARTICIPANT HELPERS
// --------------------------------------------------

function isAdminParticipant(participant) {
  if (!participant) return false;

  return Boolean(
    participant.admin === 'admin' ||
    participant.admin === 'superadmin' ||
    participant.admin === true ||
    participant.isAdmin === true ||
    participant.isSuperAdmin === true
  );
}

function isSuperAdminParticipant(participant) {
  if (!participant) return false;

  return Boolean(
    participant.admin === 'superadmin' ||
    participant.isSuperAdmin === true
  );
}

function getParticipantJid(participant) {
  if (!participant) return '';

  return normalizeJid(
    participant.id ||
    participant.jid ||
    participant.lid ||
    ''
  );
}

function getParticipantIdentifiers(participant) {
  if (!participant) return [];

  const identifiers = [
    participant.id,
    participant.jid,
    participant.lid,
    participant.phoneNumber
  ];

  return [
    ...new Set(
      identifiers
        .filter(value => typeof value === 'string' && value.trim())
        .map(value => normalizeJid(value))
        .filter(Boolean)
    )
  ];
}

function findParticipant(metadata, jid) {
  if (
    !Array.isArray(metadata?.participants) ||
    !jid
  ) {
    return null;
  }

  const normalized = normalizeJid(jid);

  if (!normalized) return null;

  return metadata.participants.find(participant => {
    return getParticipantIdentifiers(participant)
      .includes(normalized);
  }) || null;
}

function isWhatsAppUserJid(jid) {
  return typeof jid === 'string' && (
    jid.endsWith('@s.whatsapp.net') ||
    jid.endsWith('@lid')
  );
}

function isValidGroupContext(ctx) {
  return Boolean(
    ctx?.isGroup &&
    ctx?.chat &&
    ctx?.sock
  );
}

// --------------------------------------------------
// GROUP METADATA
// --------------------------------------------------

export async function getGroupMetadata(ctx) {
  if (!ctx?.isGroup) {
    await ctx?.reply?.(
      'This command only works in groups.'
    );

    return null;
  }

  if (!ctx.sock || !ctx.chat) {
    await ctx?.reply?.(
      'Unable to identify this group.'
    );

    return null;
  }

  try {
    return await ctx.sock.groupMetadata(ctx.chat);
  } catch (error) {
    console.error(
      '[ADMIN] Group metadata error:',
      error?.stack || error
    );

    await ctx.reply(
      'Unable to retrieve group information. Try again.'
    ).catch(() => {});

    return null;
  }
}

// --------------------------------------------------
// BOT ADMIN CHECK
// --------------------------------------------------

export async function requireBotAdmin(ctx, metadata = null) {
  if (!isValidGroupContext(ctx)) {
    await ctx?.reply?.(
      'This command only works in groups.'
    );

    return false;
  }

  const meta = metadata ||
    await getGroupMetadata(ctx);

  if (!meta) return false;

  const botJid = normalizeJid(
    ctx.sock.user?.id ||
    ctx.sock.user?.jid ||
    ''
  );

  if (!botJid) {
    await ctx.reply(
      'Unable to identify PRECIOUS-MD in this group.'
    );

    return false;
  }

  const bot = findParticipant(
    meta,
    botJid
  );

  if (!isAdminParticipant(bot)) {
    await ctx.reply(
      '⚠️ Make PRECIOUS-MD a group admin first.'
    );

    return false;
  }

  return meta;
}

// --------------------------------------------------
// SENDER ADMIN CHECK
// --------------------------------------------------

export async function requireSenderAdmin(ctx, metadata = null) {
  if (!isValidGroupContext(ctx)) {
    await ctx?.reply?.(
      'This command only works in groups.'
    );

    return false;
  }

  // Owner and sudo users bypass the sender-admin check.
  // They do not bypass the bot-admin requirement.
  if (isOwnerOrSudo(ctx.sender)) {
    return true;
  }

  const meta = metadata ||
    await getGroupMetadata(ctx);

  if (!meta) return false;

  const senderJid = normalizeJid(
    ctx.sender || ''
  );

  const sender = findParticipant(
    meta,
    senderJid
  );

  if (!isAdminParticipant(sender)) {
    await ctx.reply(
      '⛔ Only group administrators can use this command.'
    );

    return false;
  }

  return true;
}

// --------------------------------------------------
// FULL GROUP ADMIN CHECK
// --------------------------------------------------

export async function requireGroupAdmin(ctx) {
  if (!isValidGroupContext(ctx)) {
    await ctx?.reply?.(
      'This command only works in groups.'
    );

    return false;
  }

  // Fetch metadata once and reuse it.
  const metadata = await getGroupMetadata(ctx);

  if (!metadata) return false;

  // Check command sender.
  const senderAllowed = await requireSenderAdmin(
    ctx,
    metadata
  );

  if (!senderAllowed) return false;

  // Check whether the bot has admin privileges.
  const botAllowed = await requireBotAdmin(
    ctx,
    metadata
  );

  if (!botAllowed) return false;

  // Return metadata on success.
  return metadata;
}

// --------------------------------------------------
// TARGET EXTRACTION
// --------------------------------------------------

function extractTarget(ctx) {
  const mentioned = getMentioned(ctx.msg);

  if (Array.isArray(mentioned)) {
    const first = mentioned.find(
      value => typeof value === 'string' && value.trim()
    );

    if (first) return first;
  }

  if (
    typeof mentioned === 'string' &&
    mentioned.trim()
  ) {
    return mentioned.trim();
  }

  const quoted = getQuotedParticipant(ctx.msg);

  if (
    typeof quoted === 'string' &&
    quoted.trim()
  ) {
    return quoted.trim();
  }

  return '';
}

// --------------------------------------------------
// GET TARGET MEMBER
// --------------------------------------------------

export async function groupTarget(ctx, options = {}) {
  if (!isValidGroupContext(ctx)) {
    await ctx?.reply?.(
      'This command only works in groups.'
    );

    return null;
  }

  const target = extractTarget(ctx);

  if (!target) {
    await ctx.reply(
      'Tag a member or reply to their message.'
    );

    return null;
  }

  const normalized = normalizeJid(target);

  if (!isWhatsAppUserJid(normalized)) {
    await ctx.reply(
      'Invalid WhatsApp member account.'
    );

    return null;
  }

  const botJid = normalizeJid(
    ctx.sock.user?.id ||
    ctx.sock.user?.jid ||
    ''
  );

  if (
    !options.allowBot &&
    normalized === botJid
  ) {
    await ctx.reply(
      'You cannot target the bot itself.'
    );

    return null;
  }

  if (
    !options.allowOwner &&
    isOwnerOrSudo(normalized)
  ) {
    await ctx.reply(
      'You cannot target the bot owner or a sudo user.'
    );

    return null;
  }

  // Verify that the target is actually in this group.
  const metadata = await getGroupMetadata(ctx);

  if (!metadata) return null;

  const participant = findParticipant(
    metadata,
    normalized
  );

  if (!participant) {
    await ctx.reply(
      'That user is not a member of this group.'
    );

    return null;
  }

  // Return the participant's canonical JID.
  const canonicalJid = getParticipantJid(participant);

  if (!canonicalJid) {
    await ctx.reply(
      'Unable to identify that group member.'
    );

    return null;
  }

  return canonicalJid;
}

// --------------------------------------------------
// PARTICIPANT STATUS
// --------------------------------------------------

export async function getParticipantStatus(
  ctx,
  jid,
  metadata = null
) {
  if (!isValidGroupContext(ctx) || !jid) {
    return null;
  }

  const meta = metadata ||
    await getGroupMetadata(ctx);

  if (!meta) return null;

  const participant = findParticipant(
    meta,
    jid
  );

  if (!participant) return null;

  return {
    participant,

    isAdmin: isAdminParticipant(participant),

    isSuperAdmin: isSuperAdminParticipant(participant),

    jid: getParticipantJid(participant),

    identifiers: getParticipantIdentifiers(participant)
  };
}

// --------------------------------------------------
// EXPORT PARTICIPANT HELPERS
// --------------------------------------------------

export {
  isAdminParticipant,
  isSuperAdminParticipant,
  getParticipantJid,
  findParticipant
};
