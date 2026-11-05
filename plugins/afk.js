
import { saveDatabase } from '../lib/database.js';

function getAwayDuration(since) {
  const elapsed = Math.max(0, Date.now() - Number(since || Date.now()));

  const totalMinutes = Math.floor(elapsed / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];

  if (days) parts.push(`${days} day(s)`);
  if (hours) parts.push(`${hours} hour(s)`);
  if (minutes || parts.length === 0) {
    parts.push(`${minutes} minute(s)`);
  }

  return parts.join(', ');
}

export default [
  {
    command: 'afk',
    aliases: ['away'],
    category: 'utility',
    description: 'Set your AFK status',

    run: async ctx => {
      const reason = String(ctx.q || '')
        .trim()
        .slice(0, 300) || 'No reason provided';

      ctx.user.afk = {
        active: true,
        reason,
        since: Date.now()
      };

      await saveDatabase();

      await ctx.reply(
        `💤 *AFK MODE ENABLED*\n\n` +
        `Reason: ${reason}\n\n` +
        `I will notify people when they mention you.\n\n` +
        `Use *.back* to return.`
      );
    }
  },

  {
    command: 'back',
    aliases: ['unafk', 'return'],
    category: 'utility',
    description: 'Return from AFK mode',

    run: async ctx => {
      if (!ctx.user.afk?.active) {
        return ctx.reply('You are not currently AFK.');
      }

      const duration = getAwayDuration(ctx.user.afk.since);

      delete ctx.user.afk;

      await saveDatabase();

      await ctx.reply(
        `👋 *WELCOME BACK!*\n\n` +
        `Your AFK status has been cleared.\n` +
        `You were away for ${duration}.`
      );
    }
  }
];
