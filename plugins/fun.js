
import config from '../config.js';
import { randomInt } from 'node:crypto';

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const pick = list => {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Cannot choose from an empty list.');
  }

  return list[randomInt(list.length)];
};

const cleanText = (value, max = 300) =>
  String(value || '').trim().slice(0, max);

// --------------------------------------------------
// FUN CONTENT
// --------------------------------------------------

const jokes = [
  'Why did the programmer quit? Because they did not get arrays.',
  'Why do Java developers wear glasses? Because they cannot C#.',
  'A SQL query walks into a bar and asks: Can I join you?',
  'There are 10 kinds of people: those who understand binary and those who do not.',
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'A programmer is told to go to the store and buy a loaf of bread. If they have eggs, buy a dozen. They return with 12 loaves.',
  'Why was the computer cold? It left its Windows open.',
  'Debugging: being the detective in a crime movie where you are also the murderer.'
];

const compliments = [
  'You have a great sense of style! ✨',
  'Your energy makes the room brighter! 🌟',
  'You are stronger than you think! 💪',
  'Keep going. Your effort matters! ❤️',
  'You deserve good things in life! 🌹',
  'Your smile can make someone’s day! 😊',
  'You have something special that makes you unique! 💎',
  'Never underestimate your potential! 🚀'
];

const riddles = [
  { q: 'What has keys but cannot open locks?', a: 'A piano.' },
  { q: 'What gets wetter as it dries?', a: 'A towel.' },
  { q: 'What has a face and two hands but no arms or legs?', a: 'A clock.' },
  { q: 'What has many teeth but cannot bite?', a: 'A comb.' },
  { q: 'What goes up but never comes down?', a: 'Your age.' },
  { q: 'What has one eye but cannot see?', a: 'A needle.' },
  { q: 'What has a neck but no head?', a: 'A bottle.' },
  { q: 'What can travel around the world while staying in one corner?', a: 'A stamp.' }
];

const truths = [
  'What is one thing you have never told anyone?',
  'What is your biggest dream?',
  'What is your most embarrassing moment?',
  'Who inspires you the most?',
  'What is one habit you want to change?',
  'What is your biggest fear?',
  'What is the best thing that happened to you this year?',
  'If you could change one thing about your past, what would it be?',
  'What makes you genuinely happy?',
  'What is your biggest goal right now?'
];

const dares = [
  'Write a compliment for someone in the group.',
  'Speak only in emojis for the next five minutes.',
  'Tell everyone your favourite song.',
  'Send a voice note saying your favourite movie title.',
  'Tell a funny story about yourself.',
  'Use only three words to describe yourself.',
  'Share one thing you are grateful for.',
  'Make up a funny nickname for yourself.',
  'Tell everyone your favourite childhood memory.',
  'Send a funny GIF if you have one.'
];

const magicAnswers = [
  'Yes, definitely. ✨',
  'It is certain. 🔮',
  'Without a doubt.',
  'Most likely.',
  'Ask again later.',
  'Cannot predict now.',
  'Probably not.',
  'My answer is no.',
  'Very unlikely.',
  'The signs point to yes.',
  'Absolutely!',
  'I would not count on it.'
];

// --------------------------------------------------
// PLUGINS
// --------------------------------------------------

export default [

  // JOKE
  {
    command: 'joke',
    aliases: ['jokes'],
    category: 'fun',
    description: 'Get a random joke',

    run: async ctx => {
      await ctx.reply(`😂 *RANDOM JOKE*\n\n${pick(jokes)}`);
    }
  },

  // COMPLIMENT
  {
    command: 'compliment',
    aliases: ['praise'],
    category: 'fun',
    description: 'Get a random compliment',

    run: async ctx => {
      await ctx.reply(`💖 *COMPLIMENT*\n\n${pick(compliments)}`);
    }
  },

  // COIN FLIP
  {
    command: 'coin',
    aliases: ['flip'],
    category: 'games',
    description: 'Flip a coin',

    run: async ctx => {
      const result = randomInt(2) === 0 ? 'HEADS' : 'TAILS';

      await ctx.reply(
        `🪙 *COIN FLIP*\n\nThe coin landed on *${result}*!`
      );
    }
  },

  // DICE
  {
    command: 'dice',
    aliases: ['roll'],
    category: 'games',
    description: 'Roll a six-sided dice',

    run: async ctx => {
      const result = randomInt(1, 7);

      await ctx.reply(
        `🎲 *DICE ROLL*\n\nYou rolled a *${result}*!`
      );
    }
  },

  // SHIP
  {
    command: 'ship',
    aliases: ['love'],
    category: 'fun',
    description: 'Calculate playful compatibility',

    run: async ctx => {
      const names = cleanText(ctx.q, 150);

      if (!names) {
        return ctx.reply('Usage: .ship Watson, Alex');
      }

      const score = randomInt(101);

      const result =
        score >= 80 ? 'A perfect match! 💍' :
        score >= 60 ? 'There may be a spark! ❤️' :
        score >= 40 ? 'Maybe there is something! 💕' :
        'Just friends for now! 😅';

      await ctx.reply(
        `💘 *LOVE COMPATIBILITY*\n\n` +
        `${names}\n\n` +
        `❤️ Score: *${score}%*\n` +
        `${result}\n\n` +
        `_Just for fun, not a real compatibility test._`
      );
    }
  },

  // RATE
  {
    command: 'rate',
    aliases: ['howgood'],
    category: 'fun',
    description: 'Give a random fun rating',

    run: async ctx => {
      const subject = cleanText(ctx.q, 200);

      if (!subject) {
        return ctx.reply('Usage: .rate my coding skills');
      }

      const score = randomInt(101);

      await ctx.reply(
        `⭐ *RANDOM RATING*\n\n` +
        `Subject: ${subject}\n` +
        `Rating: *${score}/100*\n\n` +
        `_This rating is randomly generated._`
      );
    }
  },

  // MAGIC 8 BALL
  {
    command: '8ball',
    aliases: ['magicball'],
    category: 'games',
    description: 'Ask the magic eight ball',

    run: async ctx => {
      const question = cleanText(ctx.q, 250);

      if (!question) {
        return ctx.reply('Usage: .8ball Will I become successful?');
      }

      await ctx.reply(
        `🎱 *MAGIC 8 BALL*\n\n` +
        `❓ ${question}\n\n` +
        `🔮 *${pick(magicAnswers)}*`
      );
    }
  },

  // TRUTH
  {
    command: 'truth',
    aliases: ['truthquestion'],
    category: 'games',
    description: 'Get a truth question',

    run: async ctx => {
      await ctx.reply(
        `🗣️ *TRUTH*\n\n${pick(truths)}`
      );
    }
  },

  // DARE
  {
    command: 'dare',
    aliases: ['challenge'],
    category: 'games',
    description: 'Get a dare challenge',

    run: async ctx => {
      await ctx.reply(
        `🔥 *DARE*\n\n${pick(dares)}\n\n` +
        `_Only do challenges you are comfortable with._`
      );
    }
  },

  // RIDDLE
  {
    command: 'riddle',
    aliases: ['puzzle'],
    category: 'games',
    description: 'Get a random riddle',

    run: async ctx => {
      const item = pick(riddles);

      const answerCode = Buffer
        .from(item.a, 'utf8')
        .toString('base64url');

      await ctx.reply(
        `🧩 *RIDDLE CHALLENGE*\n\n` +
        `${item.q}\n\n` +
        `Think carefully!\n\n` +
        `To reveal the answer, use:\n` +
        `*${config.prefix}riddleanswer ${answerCode}*`
      );
    }
  },

  // RIDDLE ANSWER
  {
    command: 'riddleanswer',
    aliases: ['ranswer'],
    category: 'games',
    description: 'Reveal a riddle answer',

    run: async ctx => {
      const code = cleanText(ctx.q, 500);

      if (!code) {
        return ctx.reply(
          'Use the answer code supplied by .riddle.'
        );
      }

      try {
        if (!/^[A-Za-z0-9_-]+$/.test(code)) {
          throw new Error('Invalid code');
        }

        const answer = Buffer
          .from(code, 'base64url')
          .toString('utf8');

        if (
          !answer ||
          answer.length > 200 ||
          !/^[\x20-\x7E]+$/.test(answer)
        ) {
          throw new Error('Invalid answer');
        }

        await ctx.reply(
          `✅ *RIDDLE ANSWER*\n\n${answer}`
        );
      } catch {
        await ctx.reply('Invalid answer code.');
      }
    }
  },

  // ROCK PAPER SCISSORS
  {
    command: 'rps',
    aliases: ['rockpaperscissors'],
    category: 'games',
    description: 'Play rock paper scissors',

    run: async ctx => {
      const choices = ['rock', 'paper', 'scissors'];
      const userChoice = cleanText(ctx.q, 20).toLowerCase();

      if (!choices.includes(userChoice)) {
        return ctx.reply(
          '✊ *ROCK PAPER SCISSORS*\n\n' +
          'Usage:\n' +
          '.rps rock\n' +
          '.rps paper\n' +
          '.rps scissors'
        );
      }

      const botChoice = pick(choices);

      let result;

      if (userChoice === botChoice) {
        result = '🤝 It is a draw!';
      } else if (
        (userChoice === 'rock' && botChoice === 'scissors') ||
        (userChoice === 'paper' && botChoice === 'rock') ||
        (userChoice === 'scissors' && botChoice === 'paper')
      ) {
        result = '🏆 You win!';
      } else {
        result = '🤖 I win! Better luck next time.';
      }

      const emoji = {
        rock: '✊',
        paper: '✋',
        scissors: '✌️'
      };

      await ctx.reply(
        `🎮 *ROCK PAPER SCISSORS*\n\n` +
        `You: ${emoji[userChoice]} ${userChoice}\n` +
        `Bot: ${emoji[botChoice]} ${botChoice}\n\n` +
        `*${result}*`
      );
    }
  },

  // SLOT MACHINE
  {
    command: 'slot',
    aliases: ['slots', 'slotmachine'],
    category: 'games',
    description: 'Play the slot machine',

    run: async ctx => {
      const symbols = ['🍒', '🍋', '🍉', '⭐', '💎', '7️⃣'];

      const result = [
        pick(symbols),
        pick(symbols),
        pick(symbols)
      ];

      const win = result.every(symbol => symbol === result[0]);

      const pair = new Set(result).size === 2;

      await ctx.reply(
        `🎰 *SLOT MACHINE*\n\n` +
        `╭──────────────╮\n` +
        `│ ${result.join('  ')} │\n` +
        `╰──────────────╯\n\n` +
        `${win ? '🎉 JACKPOT! All three match!' : pair ? '✨ Two symbols match!' : '😅 No match. Try again!'}\n\n` +
        `_For entertainment only. No real money involved._`
      );
    }
  },

  // RANDOM CHOICE
  {
    command: 'choose',
    aliases: ['pickone'],
    category: 'fun',
    description: 'Randomly choose between options',

    run: async ctx => {
      const options = String(ctx.q || '')
        .split('|')
        .map(item => item.trim())
        .filter(Boolean);

      if (options.length < 2 || options.length > 20) {
        return ctx.reply(
          'Usage: .choose Pizza | Burger | Chicken\nProvide 2–20 options.'
        );
      }

      if (options.some(item => item.length > 100)) {
        return ctx.reply('Each option must be under 100 characters.');
      }

      await ctx.reply(
        `🎯 *MY CHOICE*\n\n${pick(options)}`
      );
    }
  },

  // FUN HELP
  {
    command: 'funhelp',
    aliases: ['gamehelp'],
    category: 'games',
    description: 'Show fun and games commands',

    run: async ctx => {
      await ctx.reply(
        `🎮 *PRECIOUS-MD FUN & GAMES*\n\n` +
        `╭───────────────\n` +
        `┃ 😂 .joke\n` +
        `┃ 💖 .compliment\n` +
        `┃ 💘 .ship Watson, Alex\n` +
        `┃ ⭐ .rate coding\n` +
        `┃ 🎱 .8ball question\n` +
        `┃ 🗣️ .truth\n` +
        `┃ 🔥 .dare\n` +
        `┃ 🧩 .riddle\n` +
        `┃ 🎲 .dice\n` +
        `┃ 🪙 .coin\n` +
        `┃ ✊ .rps rock\n` +
        `┃ 🎰 .slot\n` +
        `┃ 🎯 .choose A | B | C\n` +
        `╰───────────────\n\n` +
        `*PRECIOUS-MD by Watson Fourpence*`
      );
    }
  }

];
