
const pick = list => list[Math.floor(Math.random() * list.length)];

const jokes = [
  'Why did the programmer quit? Because they did not get arrays.',
  'Why do Java developers wear glasses? Because they cannot C#.',
  'A SQL query walks into a bar and asks: Can I join you?',
  'There are 10 kinds of people: those who understand binary and those who do not.'
];

const compliments = [
  'You have a great sense of style! ✨',
  'Your energy makes the room brighter! 🌟',
  'You are stronger than you think! 💪',
  'Keep going. Your effort matters! ❤️'
];

const riddles = [
  { q: 'What has keys but cannot open locks?', a: 'A piano.' },
  { q: 'What gets wetter as it dries?', a: 'A towel.' },
  { q: 'What has a face and two hands but no arms or legs?', a: 'A clock.' },
  { q: 'What has many teeth but cannot bite?', a: 'A comb.' }
];

const truths = [
  'What is one thing you have never told anyone?',
  'What is your biggest dream?',
  'What is your most embarrassing moment?',
  'Who inspires you the most?',
  'What is one habit you want to change?'
];

const dares = [
  'Send your funniest selfie to the group.',
  'Write a compliment for the person above you.',
  'Speak only in emojis for the next five minutes.',
  'Tell everyone your favourite song.',
  'Send a voice note saying your favourite movie title.'
];

export default [
  {
    command: 'joke',
    aliases: ['jokes'],
    category: 'fun',
    description: 'Get a random joke',
    run: async ctx => ctx.reply(`😂 ${pick(jokes)}`)
  },

  {
    command: 'compliment',
    aliases: ['praise'],
    category: 'fun',
    description: 'Get a random compliment',
    run: async ctx => ctx.reply(`💖 ${pick(compliments)}`)
  },

  {
    command: 'coin',
    aliases: ['flip'],
    category: 'games',
    description: 'Flip a coin',
    run: async ctx => ctx.reply(
      `🪙 The coin landed on *${Math.random() < 0.5 ? 'HEADS' : 'TAILS'}*!`
    )
  },

  {
    command: 'dice',
    aliases: ['roll'],
    category: 'games',
    description: 'Roll a six-sided dice',
    run: async ctx => ctx.reply(
      `🎲 You rolled a *${Math.floor(Math.random() * 6) + 1}*!`
    )
  },

  {
    command: 'randomnumber',
    aliases: ['randnum'],
    category: 'games',
    description: 'Generate a random number',
    run: async ctx => {
      const min = Number(ctx.args[0] ?? 1);
      const max = Number(ctx.args[1] ?? 100);

      if (
        !Number.isSafeInteger(min) ||
        !Number.isSafeInteger(max) ||
        max < min ||
        max - min > 1000000
      ) {
        return ctx.reply('Usage: .randomnumber 1 100');
      }

      ctx.reply(`🎲 Random number: *${Math.floor(Math.random() * (max - min + 1)) + min}*`);
    }
  },

  {
    command: 'ship',
    aliases: ['love'],
    category: 'fun',
    description: 'Calculate a playful compatibility score',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .ship Watson, Alex');

      const score = Math.floor(Math.random() * 101);

      await ctx.reply(
        `💘 *LOVE COMPATIBILITY*\n\n` +
        `${ctx.q}\n\n` +
        `❤️ Score: *${score}%*\n` +
        `${score >= 80 ? 'A perfect match!' : score >= 50 ? 'There may be a spark!' : 'Just friends for now!'}`
      );
    }
  },

  {
    command: 'rate',
    aliases: ['howgood'],
    category: 'fun',
    description: 'Give a random fun rating',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Usage: .rate my coding skills');

      const score = Math.floor(Math.random() * 101);

      await ctx.reply(`⭐ Rating for *${ctx.q}*: *${score}/100*`);
    }
  },

  {
    command: '8ball',
    aliases: ['magicball'],
    category: 'games',
    description: 'Ask the magic eight ball',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Ask a yes-or-no question.');

      const answers = [
        'Yes, definitely.',
        'It is certain.',
        'Without a doubt.',
        'Most likely.',
        'Ask again later.',
        'Cannot predict now.',
        'Probably not.',
        'My answer is no.',
        'Very unlikely.'
      ];

      await ctx.reply(`🎱 ${pick(answers)}`);
    }
  },

  {
    command: 'truth',
    aliases: [],
    category: 'games',
    description: 'Get a truth question',
    run: async ctx => ctx.reply(`🗣️ *TRUTH*\n\n${pick(truths)}`)
  },

  {
    command: 'dare',
    aliases: [],
    category: 'games',
    description: 'Get a dare challenge',
    run: async ctx => ctx.reply(`🔥 *DARE*\n\n${pick(dares)}`)
  },

  {
    command: 'riddle',
    aliases: ['puzzle'],
    category: 'games',
    description: 'Get a random riddle',
    run: async ctx => {
      const item = pick(riddles);

      await ctx.reply(
        `🧩 *RIDDLE*\n\n${item.q}\n\n` +
        `Answer: ${config.prefix}riddleanswer ${Buffer.from(item.a).toString('base64')}`
      );
    }
  },

  {
    command: 'riddleanswer',
    aliases: ['ranswer'],
    category: 'games',
    description: 'Reveal a riddle answer',
    run: async ctx => {
      if (!ctx.q) return ctx.reply('Use the answer code supplied by .riddle.');

      try {
        const answer = Buffer.from(ctx.q, 'base64').toString('utf8');
        if (!answer || answer.length > 200) throw new Error();
        await ctx.reply(`✅ *Answer:* ${answer}`);
      } catch {
        await ctx.reply('Invalid answer code.');
      }
    }
  }
];
