
import config from '../config.js';
import { askAI } from '../lib/ai-client.js';
import { saveDatabase } from '../lib/database.js';

export default [
  {
    command: 'ai',
    aliases: ['ask', 'watsonai', 'gpt'],
    category: 'ai',
    description: 'Ask Watson AI a question',
    cooldown: 5,

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          `🤖 *WATSON AI*\n\n` +
          `Usage: ${config.prefix}ai your question\n\n` +
          `Example: ${config.prefix}ai Explain JavaScript promises.`
        );
      }

      await ctx.react('🤖');

      try {
        const history = ctx.user.aiHistory || [];
        const answer = await askAI(ctx.q, history);

        ctx.user.aiHistory = [
          ...history,
          { role: 'user', content: ctx.q },
          { role: 'assistant', content: answer }
        ].slice(-10);

        await saveDatabase();

        await ctx.reply(
          `🤖 *WATSON AI*\n\n${answer}\n\n_Powered by PRECIOUS-MD_`
        );
      } catch (error) {
        await ctx.reply(`❌ AI error: ${error.message}`);
      }
    }
  },

  {
    command: 'aichat',
    aliases: ['autochat'],
    category: 'ai',
    description: 'Enable or disable automatic AI conversations',

    run: async ctx => {
      const mode = (ctx.q || '').toLowerCase();

      if (!['on', 'off'].includes(mode)) {
        return ctx.reply(
          `Usage:\n${config.prefix}aichat on\n${config.prefix}aichat off`
        );
      }

      ctx.user.aiChat = mode === 'on';
      await saveDatabase();

      await ctx.reply(
        mode === 'on'
          ? '✅ Automatic Watson AI replies enabled for your private chat.'
          : '❌ Automatic Watson AI replies disabled.'
      );
    }
  },

  {
    command: 'aistatus',
    aliases: ['aiinfo'],
    category: 'ai',
    description: 'Show AI configuration status',

    run: async ctx => {
      await ctx.reply(
        `🤖 *WATSON AI STATUS*\n\n` +
        `Automatic chat: ${ctx.user.aiChat ? 'ON' : 'OFF'}\n` +
        `Provider key: ${process.env.AI_API_KEY ? 'CONFIGURED' : 'MISSING'}\n` +
        `Model: ${process.env.AI_MODEL || 'gpt-4o-mini'}\n` +
        `Creator: ${config.ownerName}`
      );
    }
  },

  {
    command: 'aiclear',
    aliases: ['clearai'],
    category: 'ai',
    description: 'Clear your AI conversation history',

    run: async ctx => {
      ctx.user.aiHistory = [];
      await saveDatabase();
      await ctx.reply('🧹 Your Watson AI conversation history has been cleared.');
    }
  }
];
