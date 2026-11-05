
import config from '../config.js';

import {
  askAI,
  isAIConfigured,
  getAIModel
} from '../lib/ai-client.js';

import { saveDatabase } from '../lib/database.js';

// --------------------------------------------------
// SETTINGS
// --------------------------------------------------

const MAX_PROMPT_LENGTH = 4000;
const MAX_REPLY_LENGTH = 3500;

const MAX_HISTORY = Math.max(
  2,
  Number(config.aiMaxHistory || 10)
);

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getQuestion(ctx) {
  return String(ctx.q || '').trim();
}

function trimHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(item =>
      item &&
      ['user', 'assistant'].includes(item.role) &&
      typeof item.content === 'string'
    )
    .slice(-MAX_HISTORY);
}

function getHistoryOwner(ctx) {
  return ctx.isGroup
    ? ctx.group
    : ctx.user;
}

function truncateReply(text) {
  const answer = String(text || '').trim();

  if (answer.length <= MAX_REPLY_LENGTH) {
    return answer;
  }

  return `${answer.slice(0, MAX_REPLY_LENGTH)}\n\n_Reply shortened._`;
}

function isAIEnabled() {
  return config.aiEnabled !== false;
}

function isAIReady() {
  return isAIEnabled() && isAIConfigured();
}

function getAIError(error) {
  const message = String(error?.message || '');

  if (/401|unauthorized|invalid.*key/i.test(message)) {
    return 'Your AI API key is invalid. Check AI_API_KEY in your environment.';
  }

  if (/429|quota|rate.?limit/i.test(message)) {
    return 'The AI provider has reached its usage limit. Try again later.';
  }

  if (/timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return 'The AI service took too long to respond. Please try again.';
  }

  if (/disabled/i.test(message)) {
    return 'Watson AI is disabled in the bot configuration.';
  }

  return message.slice(0, 500) || 'Unknown AI error.';
}

function getStatusHistory(ctx) {
  return trimHistory(
    getHistoryOwner(ctx).aiHistory
  );
}

async function updateHistory(ctx, history, question, answer) {
  const owner = getHistoryOwner(ctx);

  owner.aiHistory = [
    ...history,
    {
      role: 'user',
      content: question
    },
    {
      role: 'assistant',
      content: String(answer)
    }
  ].slice(-MAX_HISTORY);

  await saveDatabase();
}

function aiUnavailableMessage() {
  if (!isAIEnabled()) {
    return '⚠️ Watson AI is currently disabled by the bot owner.';
  }

  if (!isAIConfigured()) {
    return '⚠️ Watson AI is not configured. Add a valid AI_API_KEY to your environment.';
  }

  return '';
}

// --------------------------------------------------
// PLUGINS
// --------------------------------------------------

export default [

  // ------------------------------------------------
  // ASK AI
  // ------------------------------------------------

  {
    command: 'ai',
    aliases: ['ask', 'watsonai', 'gpt'],
    category: 'ai',
    description: 'Ask Watson AI a question',
    cooldown: 5,

    run: async ctx => {
      const question = getQuestion(ctx);

      if (!question) {
        return ctx.reply(
          `🤖 *WATSON AI*\n\n` +
          `Usage: ${config.prefix}ai your question\n\n` +
          `Example: ${config.prefix}ai Explain JavaScript promises.`
        );
      }

      if (question.length > MAX_PROMPT_LENGTH) {
        return ctx.reply(
          `Your question is too long. Maximum: ${MAX_PROMPT_LENGTH} characters.`
        );
      }

      const unavailable = aiUnavailableMessage();

      if (unavailable) {
        return ctx.reply(unavailable);
      }

      await ctx.react('🤖');

      try {
        const history = getStatusHistory(ctx);

        const answer = await askAI(
          question,
          history
        );

        if (!answer || !String(answer).trim()) {
          throw new Error('The AI returned an empty response.');
        }

        await updateHistory(
          ctx,
          history,
          question,
          answer
        );

        await ctx.reply(
          `🤖 *WATSON AI*\n\n` +
          `${truncateReply(answer)}\n\n` +
          `_Powered by PRECIOUS-MD_`
        );

        await ctx.react('✅');

      } catch (error) {
        console.error('[WATSON AI]', error);

        await ctx.reply(
          `❌ *AI ERROR*\n\n${getAIError(error)}`
        );

        await ctx.react('❌');
      }
    }
  },

  // ------------------------------------------------
  // AUTOMATIC PRIVATE AI CHAT
  // ------------------------------------------------

  {
    command: 'aichat',
    aliases: ['autochat'],
    category: 'ai',
    description: 'Enable or disable automatic private AI conversations',

    run: async ctx => {
      const mode = getQuestion(ctx).toLowerCase();

      if (!['on', 'off'].includes(mode)) {
        return ctx.reply(
          `🤖 *AUTOMATIC AI CHAT*\n\n` +
          `Enable: ${config.prefix}aichat on\n` +
          `Disable: ${config.prefix}aichat off`
        );
      }

      if (mode === 'on' && ctx.isGroup) {
        return ctx.reply(
          'Automatic private AI chat can only be enabled in a private conversation. Use .aigroup on for groups.'
        );
      }

      if (mode === 'on' && !isAIReady()) {
        return ctx.reply(aiUnavailableMessage());
      }

      ctx.user.aiChat = mode === 'on';

      await saveDatabase();

      await ctx.reply(
        mode === 'on'
          ? '✅ Automatic Watson AI replies enabled in your private chat.'
          : '❌ Automatic Watson AI replies disabled.'
      );
    }
  },

  // ------------------------------------------------
  // AUTOMATIC GROUP AI CHAT
  // ------------------------------------------------

  {
    command: 'aigroup',
    aliases: ['groupai'],
    category: 'ai',
    description: 'Enable or disable group AI replies when mentioned',

    run: async ctx => {
      const mode = getQuestion(ctx).toLowerCase();

      if (!ctx.isGroup) {
        return ctx.reply(
          'This command only works in groups.'
        );
      }

      if (!['on', 'off'].includes(mode)) {
        return ctx.reply(
          `🤖 *GROUP AI CHAT*\n\n` +
          `Enable: ${config.prefix}aigroup on\n` +
          `Disable: ${config.prefix}aigroup off\n\n` +
          `Watson AI responds when mentioned or quoted.`
        );
      }

      if (mode === 'on' && !isAIReady()) {
        return ctx.reply(aiUnavailableMessage());
      }

      ctx.group.aiChat = mode === 'on';

      await saveDatabase();

      await ctx.reply(
        mode === 'on'
          ? '✅ Watson AI is enabled in this group. Mention or quote the bot to talk to it.'
          : '❌ Watson AI is disabled in this group.'
      );
    }
  },

  // ------------------------------------------------
  // AI STATUS
  // ------------------------------------------------

  {
    command: 'aistatus',
    aliases: ['aiinfo'],
    category: 'ai',
    description: 'Show AI configuration status',

    run: async ctx => {
      const keyConfigured = isAIConfigured();

      const enabled = isAIEnabled();

      const model = getAIModel();

      const history = getStatusHistory(ctx);

      const autoChat = ctx.isGroup
        ? Boolean(ctx.group.aiChat)
        : Boolean(ctx.user.aiChat);

      const historyType = ctx.isGroup
        ? 'Group'
        : 'Private';

      await ctx.reply(
        `╭━━〔 *WATSON AI STATUS* 〕━━╮\n` +
        `┃\n` +
        `┃ 🤖 AI system: ${enabled ? 'ENABLED' : 'DISABLED'}\n` +
        `┃ 🔑 API key: ${keyConfigured ? 'CONFIGURED' : 'MISSING'}\n` +
        `┃ 🧠 Model: ${model}\n` +
        `┃ 💬 Automatic chat: ${autoChat ? 'ON' : 'OFF'}\n` +
        `┃ 📚 History type: ${historyType}\n` +
        `┃ 📝 Saved messages: ${history.length}\n` +
        `┃ 👑 Creator: ${config.ownerName}\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`
      );
    }
  },

  // ------------------------------------------------
  // CLEAR AI HISTORY
  // ------------------------------------------------

  {
    command: 'aiclear',
    aliases: ['clearai'],
    category: 'ai',
    description: 'Clear AI conversation history',

    run: async ctx => {
      const owner = getHistoryOwner(ctx);

      owner.aiHistory = [];

      await saveDatabase();

      await ctx.reply(
        ctx.isGroup
          ? '🧹 This group Watson AI conversation history has been cleared.'
          : '🧹 Your Watson AI conversation history has been cleared.'
      );
    }
  },

  // ------------------------------------------------
  // FORGET AI HISTORY
  // ------------------------------------------------

  {
    command: 'aiforget',
    aliases: ['forgetai'],
    category: 'ai',
    description: 'Remove saved AI conversation history',

    run: async ctx => {
      const owner = getHistoryOwner(ctx);

      owner.aiHistory = [];

      await saveDatabase();

      await ctx.reply(
        '✅ Saved Watson AI conversation history has been removed.'
      );
    }
  },

  // ------------------------------------------------
  // AI HELP
  // ------------------------------------------------

  {
    command: 'aihelp',
    aliases: ['helpai'],
    category: 'ai',
    description: 'Show Watson AI commands',

    run: async ctx => {
      await ctx.reply(
        `╭━━〔 *PRECIOUS-MD AI CENTER* 〕━━╮\n` +
        `┃\n` +
        `┃ 🤖 .ai <question>\n` +
        `┃    Ask Watson AI anything\n` +
        `┃\n` +
        `┃ 💬 .aichat on/off\n` +
        `┃    Automatic private AI chat\n` +
        `┃\n` +
        `┃ 👥 .aigroup on/off\n` +
        `┃    Automatic group AI chat\n` +
        `┃    Responds when mentioned\n` +
        `┃\n` +
        `┃ 📊 .aistatus\n` +
        `┃    Check AI configuration\n` +
        `┃\n` +
        `┃ 🧹 .aiclear\n` +
        `┃    Clear conversation history\n` +
        `┃\n` +
        `┃ ❌ .aiforget\n` +
        `┃    Remove saved AI history\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `_Created by Watson Fourpence_`
      );
    }
  }

];
