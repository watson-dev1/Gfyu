
import {
  randomInt,
  randomUUID,
  createHash
} from 'node:crypto';

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function validNumbers(args, count) {
  if (!Array.isArray(args) || args.length !== count) {
    return false;
  }

  return args.every(value => {
    const number = Number(value);
    return Number.isFinite(number);
  });
}

function formatNumber(value, decimals = 2) {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: decimals
  });
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);

  while (b) {
    [a, b] = [b, a % b];
  }

  return a;
}

function parsePoll(text) {
  return String(text || '')
    .split('|')
    .map(value => value.trim())
    .filter(Boolean);
}

// --------------------------------------------------
// TOOLS
// --------------------------------------------------

export default [

  // SHA256 HASH
  {
    command: 'hashtext',
    aliases: ['sha256text'],
    category: 'tools',
    description: 'Create a SHA-256 hash of text',

    run: async ctx => {
      if (!ctx.q) {
        return ctx.reply(
          'Usage: .hashtext text to hash'
        );
      }

      const hash = createHash('sha256')
        .update(ctx.q, 'utf8')
        .digest('hex');

      await ctx.reply(
        `🔐 *SHA-256 HASH*\n\n${hash}`
      );
    }
  },

  // PERCENTAGE
  {
    command: 'percentage',
    aliases: ['percent'],
    category: 'tools',
    description: 'Calculate a percentage of a number',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .percentage 15 200'
        );
      }

      const [percent, amount] = ctx.args.map(Number);

      await ctx.reply(
        `📊 *PERCENTAGE*\n\n` +
        `Percentage: ${percent}%\n` +
        `Amount: ${formatNumber(amount)}\n` +
        `Result: *${formatNumber(percent / 100 * amount)}*`
      );
    }
  },

  // DISCOUNT
  {
    command: 'discount',
    aliases: ['saleprice'],
    category: 'tools',
    description: 'Calculate a discounted price',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .discount 100 20'
        );
      }

      const [price, percent] = ctx.args.map(Number);

      if (
        price < 0 ||
        percent < 0 ||
        percent > 100
      ) {
        return ctx.reply(
          'Price must be non-negative and discount must be between 0 and 100.'
        );
      }

      const saved = price * percent / 100;
      const finalPrice = price - saved;

      await ctx.reply(
        `🏷️ *DISCOUNT CALCULATOR*\n\n` +
        `Original: ${formatNumber(price)}\n` +
        `Discount: ${percent}%\n` +
        `You save: ${formatNumber(saved)}\n` +
        `Final price: *${formatNumber(finalPrice)}*`
      );
    }
  },

  // SPLIT BILL
  {
    command: 'splitbill',
    aliases: ['billdivide'],
    category: 'tools',
    description: 'Split a bill equally between people',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .splitbill 120 4'
        );
      }

      const [total, people] = ctx.args.map(Number);

      if (
        total < 0 ||
        !Number.isInteger(people) ||
        people < 1 ||
        people > 1000
      ) {
        return ctx.reply(
          'Enter a non-negative total and a whole number of people between 1 and 1000.'
        );
      }

      await ctx.reply(
        `🧾 *BILL SPLITTER*\n\n` +
        `Total: ${formatNumber(total)}\n` +
        `People: ${people}\n` +
        `Each pays: *${formatNumber(total / people)}*`
      );
    }
  },

  // AVERAGE
  {
    command: 'average',
    aliases: ['avg', 'mean'],
    category: 'tools',
    description: 'Calculate the average of numbers',

    run: async ctx => {
      const values = (ctx.q || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);

      if (
        values.length < 2 ||
        values.length > 100 ||
        values.some(value => !Number.isFinite(value))
      ) {
        return ctx.reply(
          'Usage: .average 10 20 30 40'
        );
      }

      const result =
        values.reduce((sum, value) => sum + value, 0) /
        values.length;

      await ctx.reply(
        `📊 *AVERAGE*\n\n` +
        `Numbers: ${values.length}\n` +
        `Average: *${formatNumber(result, 4)}*`
      );
    }
  },

  // RATIO
  {
    command: 'ratio',
    aliases: ['simplifyratio'],
    category: 'tools',
    description: 'Simplify a numerical ratio',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .ratio 20 30'
        );
      }

      const [a, b] = ctx.args.map(Number);

      if (
        !Number.isSafeInteger(a) ||
        !Number.isSafeInteger(b) ||
        (a === 0 && b === 0)
      ) {
        return ctx.reply(
          'Enter two whole numbers, not both zero.'
        );
      }

      const divisor = gcd(a, b);

      await ctx.reply(
        `⚖️ *RATIO SIMPLIFIER*\n\n` +
        `${a}:${b} = *${a / divisor}:${b / divisor}*`
      );
    }
  },

  // RANDOM NUMBER
  {
    command: 'randomnumber',
    aliases: ['randnum', 'rng'],
    category: 'tools',
    description: 'Generate a random integer',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .randomnumber 1 100'
        );
      }

      const [min, max] = ctx.args.map(Number);

      if (
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        min > max ||
        max - min > 1000000000
      ) {
        return ctx.reply(
          'Enter valid whole-number limits. Maximum range is 1 billion.'
        );
      }

      const result = randomInt(min, max + 1);

      await ctx.reply(
        `🎲 Random number: *${result}*`
      );
    }
  },

  // UUID
  {
    command: 'uuid',
    aliases: ['generateuuid'],
    category: 'tools',
    description: 'Generate a unique UUID',

    run: async ctx => {
      await ctx.reply(
        `🆔 *UUID*\n\n${randomUUID()}`
      );
    }
  },

  // TAX
  {
    command: 'tax',
    aliases: ['taxcalc'],
    category: 'tools',
    description: 'Calculate tax on an amount',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .tax 100 15'
        );
      }

      const [amount, rate] = ctx.args.map(Number);

      if (amount < 0 || rate < 0 || rate > 1000) {
        return ctx.reply(
          'Enter a non-negative amount and a tax rate between 0 and 1000%.'
        );
      }

      const tax = amount * rate / 100;

      await ctx.reply(
        `🧮 *TAX CALCULATOR*\n\n` +
        `Amount: ${formatNumber(amount)}\n` +
        `Tax rate: ${rate}%\n` +
        `Tax: ${formatNumber(tax)}\n` +
        `Total: *${formatNumber(amount + tax)}*`
      );
    }
  },

  // TIP
  {
    command: 'tip',
    aliases: ['tipcalc'],
    category: 'tools',
    description: 'Calculate a tip and total bill',

    run: async ctx => {
      if (!validNumbers(ctx.args, 2)) {
        return ctx.reply(
          'Usage: .tip 50 10'
        );
      }

      const [amount, rate] = ctx.args.map(Number);

      if (amount < 0 || rate < 0 || rate > 1000) {
        return ctx.reply(
          'Enter a non-negative amount and a valid tip rate.'
        );
      }

      const tip = amount * rate / 100;

      await ctx.reply(
        `💰 *TIP CALCULATOR*\n\n` +
        `Bill: ${formatNumber(amount)}\n` +
        `Tip rate: ${rate}%\n` +
        `Tip: ${formatNumber(tip)}\n` +
        `Total: *${formatNumber(amount + tip)}*`
      );
    }
  },

  // UNIT CONVERTER
  {
    command: 'unit',
    aliases: ['convert'],
    category: 'tools',
    description: 'Convert common units',

    run: async ctx => {
      const [rawValue, rawUnit] = ctx.args || [];

      const value = Number(rawValue);
      const unit = String(rawUnit || '').toLowerCase();

      if (!Number.isFinite(value) || !unit) {
        return ctx.reply(
          `*UNIT CONVERTER*\n\n` +
          `Usage:\n` +
          `.unit 100 km\n` +
          `.unit 5 kg\n` +
          `.unit 32 c\n` +
          `.unit 10 miles\n` +
          `.unit 1000 m`
        );
      }

      const conversions = {
        km: ['miles', value * 0.621371],
        miles: ['km', value * 1.609344],
        kg: ['pounds', value * 2.204623],
        lb: ['kg', value / 2.204623],
        g: ['ounces', value / 28.3495],
        m: ['feet', value * 3.28084],
        ft: ['meters', value / 3.28084],
        c: ['fahrenheit', (value * 9 / 5) + 32],
        f: ['celsius', (value - 32) * 5 / 9],
        l: ['gallons', value * 0.264172],
        ml: ['liters', value / 1000]
      };

      const result = conversions[unit];

      if (!result) {
        return ctx.reply(
          'Unsupported unit. Try km, miles, kg, lb, g, m, ft, c, f, l or ml.'
        );
      }

      await ctx.reply(
        `📐 *UNIT CONVERTER*\n\n` +
        `${formatNumber(value, 4)} ${unit} = *${formatNumber(result[1], 4)} ${result[0]}*`
      );
    }
  },

  // AGE CALCULATOR
  {
    command: 'age',
    aliases: ['agecalc'],
    category: 'tools',
    description: 'Calculate age from date of birth',

    run: async ctx => {
      const input = String(ctx.q || '').trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return ctx.reply(
          'Usage: .age YYYY-MM-DD\nExample: .age 2000-05-20'
        );
      }

      const [year, month, day] = input.split('-').map(Number);
      const birth = new Date(Date.UTC(year, month - 1, day));

      if (
        birth.getUTCFullYear() !== year ||
        birth.getUTCMonth() !== month - 1 ||
        birth.getUTCDate() !== day
      ) {
        return ctx.reply(
          'Invalid date of birth.'
        );
      }

      const now = new Date();

      let age = now.getFullYear() - year;

      const birthdayPassed =
        now.getMonth() + 1 > month ||
        (
          now.getMonth() + 1 === month &&
          now.getDate() >= day
        );

      if (!birthdayPassed) age--;

      if (age < 0) {
        return ctx.reply(
          'Date of birth cannot be in the future.'
        );
      }

      await ctx.reply(
        `🎂 Your age is *${age} years*.`
      );
    }
  },

  // POLL
  {
    command: 'poll',
    aliases: ['vote'],
    category: 'group',
    description: 'Create a WhatsApp poll',

    run: async ctx => {
      if (!ctx.isGroup) {
        return ctx.reply(
          'Polls can only be created in groups.'
        );
      }

      const parts = parsePoll(ctx.q);

      if (parts.length < 3 || parts.length > 13) {
        return ctx.reply(
          'Usage: .poll Best colour? | Red | Blue | Green\nProvide 2–12 options.'
        );
      }

      const [name, ...values] = parts;

      if (
        name.length > 240 ||
        values.some(value => value.length > 100)
      ) {
        return ctx.reply(
          'The question or an option is too long.'
        );
      }

      if (
        new Set(values.map(value => value.toLowerCase())).size !== values.length
      ) {
        return ctx.reply(
          'Poll options must be unique.'
        );
      }

      try {
        await ctx.send({
          poll: {
            name,
            values,
            selectableCount: 1
          }
        });
      } catch (error) {
        console.error('[POLL]', error.message);

        await ctx.reply(
          'Unable to create the poll.'
        );
      }
    }
  },

  // MULTIPLE-CHOICE POLL
  {
    command: 'pollmulti',
    aliases: ['multivote'],
    category: 'group',
    description: 'Create a multiple-choice WhatsApp poll',

    run: async ctx => {
      if (!ctx.isGroup) {
        return ctx.reply(
          'Polls can only be created in groups.'
        );
      }

      const parts = parsePoll(ctx.q);

      if (parts.length < 3 || parts.length > 13) {
        return ctx.reply(
          'Usage: .pollmulti Choose topics | News | Music | Sports\nProvide 2–12 options.'
        );
      }

      const [name, ...values] = parts;

      if (
        name.length > 240 ||
        values.some(value => value.length > 100)
      ) {
        return ctx.reply(
          'The question or an option is too long.'
        );
      }

      if (
        new Set(values.map(value => value.toLowerCase())).size !== values.length
      ) {
        return ctx.reply(
          'Poll options must be unique.'
        );
      }

      try {
        await ctx.send({
          poll: {
            name,
            values,
            selectableCount: values.length
          }
        });
      } catch (error) {
        console.error('[MULTI POLL]', error.message);

        await ctx.reply(
          'Unable to create the poll.'
        );
      }
    }
  }

];
