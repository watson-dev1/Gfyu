import { randomBytes, randomUUID, createHash } from 'node:crypto';

export default [
  {
    command: 'hashtext', aliases: ['sha256text'], category: 'tools',
    description: 'Create a SHA-256 hash of text',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .hashtext text to hash');
      await ctx.reply(createHash('sha256').update(ctx.q).digest('hex'));
    }
  },
  {
    command: 'percentage', aliases: ['percent'], category: 'tools',
    description: 'Calculate a percentage of a number',
    run: async ctx => {
      const [percent, amount] = ctx.args.map(Number);
      if (!Number.isFinite(percent) || !Number.isFinite(amount) || ctx.args.length !== 2) return ctx.reply('Usage: .percentage 15 200');
      await ctx.reply(`📊 ${percent}% of ${amount} = *${(percent / 100 * amount).toLocaleString()}*`);
    }
  },
  {
    command: 'discount', aliases: ['saleprice'], category: 'tools',
    description: 'Calculate a discounted price',
    run: async ctx => {
      const [price, percent] = ctx.args.map(Number);
      if (!Number.isFinite(price) || !Number.isFinite(percent) || price < 0 || percent < 0 || percent > 100 || ctx.args.length !== 2) return ctx.reply('Usage: .discount 100 20');
      const saved = price * percent / 100;
      await ctx.reply(`🏷️ Original: ${price}\nDiscount: ${percent}%\nYou save: ${saved.toFixed(2)}\nFinal price: *${(price-saved).toFixed(2)}*`);
    }
  },
  {
    command: 'splitbill', aliases: ['billdivide'], category: 'tools',
    description: 'Split a bill equally between people',
    run: async ctx => {
      const [total, people] = ctx.args.map(Number);
      if (!Number.isFinite(total) || !Number.isInteger(people) || total < 0 || people < 1 || people > 1000 || ctx.args.length !== 2) return ctx.reply('Usage: .splitbill 120 4');
      await ctx.reply(`🧾 Total: ${total.toFixed(2)}\nPeople: ${people}\nEach pays: *${(total/people).toFixed(2)}*`);
    }
  },
  {
    command: 'poll', aliases: ['vote'], category: 'group',
    description: 'Create a WhatsApp poll (question | option 1 | option 2)',
    run: async ctx => {
      const parts = ctx.q.split('|').map(x => x.trim()).filter(Boolean);
      if (parts.length < 3 || parts.length > 13) return ctx.reply('Usage: .poll Best colour? | Red | Blue | Green\nProvide 2–12 options.');
      const [name, ...values] = parts;
      if (name.length > 240 || values.some(v => v.length > 100)) return ctx.reply('Question or option is too long.');
      await ctx.send({ poll: { name, values, selectableCount: 1 } });
    }
  },
  {
    command: 'pollmulti', aliases: ['multivote'], category: 'group',
    description: 'Create a multiple-choice WhatsApp poll',
    run: async ctx => {
      const parts = ctx.q.split('|').map(x => x.trim()).filter(Boolean);
      if (parts.length < 3 || parts.length > 13) return ctx.reply('Usage: .pollmulti Choose topics | News | Music | Sports');
      const [name, ...values] = parts;
      if (name.length > 240 || values.some(v => v.length > 100)) return ctx.reply('Question or option is too long.');
      await ctx.send({ poll: { name, values, selectableCount: values.length } });
    }
  }
];
