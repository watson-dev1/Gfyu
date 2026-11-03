
import { saveDatabase } from '../lib/database.js';

export default [
  {
    command: 'afk',
    aliases: ['away'],
    category: 'utility',
    description: 'Set your AFK status',
    run: async ctx => {
      const reason = ctx.q.trim().slice(0, 300) || 'No reason provided';

      ctx.user.afk = {
        active: true,
        reason,
        since: Date.now()
      };

      await saveDatabase();

      await ctx.reply(
        `💤 *AFK MODE ENABLED*\n\n` +
        `Reason: ${reason}\n` +
        `I will let people know you are away when they mention you.`
      );
    }
  },

  {
    command: 'back',
    aliases: ['unafk'],
    category: 'utility',
    description: 'Return from AFK mode',
    run: async ctx => {
      if (!ctx.user.afk?.active) {
        return ctx.reply('You are not currently AFK.');
      }

      const duration = Date.now() - ctx.user.afk.since;
      const minutes = Math.floor(duration / 60000);

      delete ctx.user.afk;
      await saveDatabase();

      await ctx.reply(
        `👋 *WELCOME BACK!*\n\n` +
        `You were away for ${minutes} minute(s).`
      );
    }
  }
];
