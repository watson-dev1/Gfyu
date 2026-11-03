# PRECIOUS-MD v2

**Created by Watson Fourpence.** Modular WhatsApp bot using Node.js 20+ and Baileys 7.0.0-rc14.

## Included
- Pairing-code login or QR login; multi-file session storage
- JSON database with atomic writes (`data/database.json`)
- Plugin loader and command handler
- List-style menu plus plain-text fallback
- Group management: tagall, hidetag, invite link, promote, demote, kick, add, group open/close
- Group settings: anti-link, anti-spam, anti-bad-word toggles, welcome toggle, warning system
- Owner: public/private, status view/react, anti-call, block/unblock, ban/unban, restart
- Search: YouTube search, Google search, image search
- Media: YouTube search and audio/video download through local `yt-dlp`
- Utilities: calculator, translator, URL shortener, sticker conversion (requires ffmpeg)
- Health endpoint `/health`

## Setup
1. Install Node.js 20+.
2. Install `ffmpeg` and `yt-dlp` on your hosting machine and ensure both are in PATH.
3. Upload/extract the ZIP.
4. Copy `.env.example` to `.env`; set `OWNER_NUMBER` and optionally `PAIRING_NUMBER`.
5. Run `npm install`, then `npm start`.
6. Read the pairing code from logs. In WhatsApp: Linked devices → Link a device → Link with phone number.

Leave `PAIRING_NUMBER` blank to use QR login. Number format: country code + number, digits only (e.g. `2637XXXXXXXX`, no `+`).

## Commands
Default prefix `.`. Use `.menu` for categories. Examples:
`.ping`, `.play song name`, `.ytsearch query`, `.ytmp3 URL`, `.ytmp4 URL`, `.sticker`, `.tagall`, `.group close`, `.antilink on`, `.welcome on`, `.block @user`.

## Plugin format
Add a `.js` file in `plugins/`:
```js
export default {
  command: 'hello',
  aliases: ['hi'],
  description: 'Example',
  run: async ({ reply, q, sock, chat, msg, sender, isOwner, isGroup }) => {
    await reply(`Hello ${q || 'there'}!`);
  }
};
```
An array of plugin objects is also supported.

## Important production notes
- Media downloads require a host that has `yt-dlp` and ffmpeg installed. Source websites may block downloads; use only content you own or are authorized to download and comply with local law and each service's terms. The bot reports failures instead of pretending a download succeeded.
- `sticker` requires ffmpeg.
- WhatsApp interactive list rendering varies by client; `.menu` falls back to text if the list message is rejected.
- Baileys is an unofficial WhatsApp Web client. Use a spare account for testing; WhatsApp can restrict accounts for automation. Keep the session folder secret.
- Group commands require the bot to be admin. For a public production deployment, add strict group-admin checks to every moderation command and rate limiting. Never expose the pairing code or session files.
- Runtime toggles are not persisted yet; set defaults in `.env` to keep settings across restarts.
- This is a substantial functional foundation, not a claim that every feature in the aspirational menu exists. Add modules incrementally and test on a private group first.


## Web control center
The root URL (`/`) serves `index.html`, a read-only dashboard. It reads live status from `/api/dashboard` and command metadata from `/api/plugins`. It does not expose session files, environment variables, API keys, or message contents. Keep the hosting port protected by your platform's access controls if you do not want the status page publicly visible.

## Additional plugins in this build
- `polls`: `.poll Question | Option 1 | Option 2` and `.pollmulti Question | Option 1 | Option 2`
- `group-insights`: `.groupinfo`, `.admins`, `.membercount`
- `extra-tools`: `.uuid`, `.password 16`, `.hashtext text`, `.percentage 15 200`, `.discount 100 20`, `.splitbill 120 4`

AI credentials must be supplied only through `AI_API_KEY` in the hosting environment or a private `.env` file. Never commit `.env` or session files.
