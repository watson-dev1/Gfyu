import { getGroup, saveDatabase } from '../lib/database.js';
import { requireGroupAdmin } from '../lib/admin.js';

const TOGGLES = {
  antibot: { key: 'antiBot', label: 'AntiBot', note: 'Detects bot-like accounts only when reliable participant signals are available.' },
  antiporn: { key: 'antiPorn', label: 'AntiPorn', note: 'Requires an image moderation provider in the message handler to inspect media.' },
  antiforeign: { key: 'antiForeign', label: 'AntiForeign', note: 'Uses the country calling-code allow/deny list configured for this group.' }
};

function toggleValue(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['on', 'enable', 'enabled', 'yes', 'true'].includes(v)) return true;
  if (['off', 'disable', 'disabled', 'no', 'false'].includes(v)) return false;
  return null;
}

async function groupAdmin(ctx) {
  if (!ctx.isGroup) {
    await ctx.reply('This setting can only be used in a group.');
    return false;
  }
  try { return await requireGroupAdmin(ctx) !== false; }
  catch { await ctx.reply('Could not verify your group-admin permissions.'); return false; }
}

const plugins = Object.entries(TOGGLES).map(([command, item]) => ({
  command,
  aliases: [],
  category: 'security',
  group: true,
  description: `Configure ${item.label}`,
  run: async ctx => {
    if (!await groupAdmin(ctx)) return;
    const group = getGroup(ctx.chat);
    group[item.key] ??= false;
    const value = toggleValue(ctx.q);
    if (value === null) {
      return ctx.reply(`🛡️ *${item.label.toUpperCase()}*\nStatus: ${group[item.key] ? 'ON' : 'OFF'}\nUsage: ${ctx.prefix}${command} on/off\n\n${item.note}`);
    }
    group[item.key] = value;
    await saveDatabase();
    await ctx.reply(`${value ? '✅ Enabled' : '🚫 Disabled'} ${item.label}.\n\n${item.note}`);
  }
}));

plugins.push({
  command: 'foreigncodes', aliases: ['antiforeigncodes'], category: 'security', group: true,
  description: 'Set allowed country calling codes for AntiForeign (comma-separated)',
  run: async ctx => {
    if (!await groupAdmin(ctx)) return;
    const group = getGroup(ctx.chat);
    group.foreignAllowedCodes ??= [];
    if (!ctx.q) return ctx.reply(`Allowed calling codes: ${group.foreignAllowedCodes.join(', ') || '(not configured)'}\nUsage: ${ctx.prefix}foreigncodes 263,27,44\nUse ${ctx.prefix}foreigncodes clear to remove the list.`);
    if (ctx.q.trim().toLowerCase() === 'clear') group.foreignAllowedCodes = [];
    else {
      const codes = ctx.q.split(/[\s,]+/).map(x => x.replace(/^\+/, '')).filter(x => /^\d{1,4}$/.test(x));
      if (!codes.length) return ctx.reply('Provide valid numeric calling codes, e.g. 263,27.');
      group.foreignAllowedCodes = [...new Set(codes)];
    }
    await saveDatabase();
    await ctx.reply(`✅ Allowed country codes: ${group.foreignAllowedCodes.join(', ') || 'none (list cleared)'}`);
  }
});

plugins.push({
  command: 'warnlimit', aliases: ['maxwarn'], category: 'security', group: true,
  description: 'Set the number of moderation warnings before removal',
  run: async ctx => {
    if (!await groupAdmin(ctx)) return;
    const group = getGroup(ctx.chat);
    const n = Number(ctx.q);
    if (!Number.isInteger(n) || n < 1 || n > 10) return ctx.reply(`Current limit: ${group.maxWarnings ?? 3}\nUsage: ${ctx.prefix}warnlimit 3 (1–10)`);
    group.maxWarnings = n;
    await saveDatabase();
    await ctx.reply(`✅ Warning limit set to ${n}. The message handler must enforce this limit and have bot-admin permissions to remove members.`);
  }
});

export default plugins;
