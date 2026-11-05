
import { saveDatabase } from '../lib/database.js';

function parseDuration(value) {
  const match = /^(\d{1,4})(s|m|h|d)$/i.exec(value || '');
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multiplier = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  }[unit];

  const duration = amount * multiplier;

  if (duration < 10000 || duration > 30 * 86400000) return null;

  return duration;
}

function reminderStore() {
  globalThis.db.reminders ||= {};
  return globalThis.db.reminders;
}

export default [
  {
    command: 'remind',
    aliases: ['reminder', 'remindme'],
    category: 'utility',
    description: 'Create a reminder',
    run: async ctx => {
      const duration = parseDuration(ctx.args[0]);
      const message = ctx.args.slice(1).join(' ').trim();

      if (!duration || !message) {
        return ctx.reply(
          `Usage: ${config.prefix}remind 10m drink water\n\n` +
          `Examples: 30s, 10m, 2h, 1d\n` +
          `Maximum reminder duration: 30 days.`
        );
      }

      if (message.length > 1000) {
        return ctx.reply('Reminder text cannot exceed 1000 characters.');
      }

      const reminders = reminderStore();
      const userReminders = Object.values(reminders).filter(
        item => item && item.sender === ctx.sender && !item.sent
      );

      if (userReminders.length >= 10) {
        return ctx.reply('You can have a maximum of 10 pending reminders.');
      }

      const id = `r${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now();

      reminders[id] = {
        id,
        sender: ctx.sender,
        chat: ctx.chat,
        message,
        createdAt: now,
        dueAt: now + duration,
        sent: false
      };

      await saveDatabase();

      await ctx.reply(
        `✅ *REMINDER CREATED*\n\n` +
        `Message: ${message}\n` +
        `Time: ${ctx.args[0]}\n` +
        `Reference: ${id}`
      );
    }
  },

  {
    command: 'reminders',
    aliases: ['myreminders'],
    category: 'utility',
    description: 'List your pending reminders',
    run: async ctx => {
      const reminders = Object.values(reminderStore())
        .filter(item => item && item.sender === ctx.sender && !item.sent)
        .sort((a, b) => a.dueAt - b.dueAt);

      if (!reminders.length) {
        return ctx.reply('You have no pending reminders.');
      }

      await ctx.reply(
        `⏰ *YOUR REMINDERS*\n\n` +
        reminders.map((item, index) =>
          `${index + 1}. ${item.message}\n` +
          `   Due: ${new Date(item.dueAt).toLocaleString()}\n` +
          `   ID: ${item.id}`
        ).join('\n\n')
      );
    }
  },

  {
    command: 'cancelreminder',
    aliases: ['delreminder'],
    category: 'utility',
    description: 'Cancel one of your reminders',
    run: async ctx => {
      const id = ctx.args[0];

      if (!id) {
        return ctx.reply(`Usage: ${config.prefix}cancelreminder REMINDER_ID`);
      }

      const reminders = reminderStore();
      const reminder = reminders[id];

      if (!reminder || reminder.sender !== ctx.sender || reminder.sent) {
        return ctx.reply('Reminder not found or already delivered.');
      }

      delete reminders[id];
      await saveDatabase();

      await ctx.reply('✅ Reminder cancelled.');
    }
  }
];
