# PRECIOUS-MD v3.2.0 Ultimate Edition

**Created by Watson Fourpence.** A modular WhatsApp automation bot built with Node.js 20+ and Baileys `7.0.0-rc14`.

## Included

- Pairing-code or QR login for the primary WhatsApp account.
- Isolated additional WhatsApp sessions managed from the authenticated dashboard.
- JSON database, plugin loader, command handler, plugin reload, and interactive quick-reply navigation with text fallbacks.
- More than 100 primary plugin command declarations across general, owner, group, security, AI, media, sticker, utility, translation, TTS, entertainment, and games categories.
- AI chat client with configurable OpenAI-compatible endpoint, model, API key, timeout, and history settings.
- YouTube/social media search and download integrations, with local `yt-dlp` support where configured.
- Group moderation controls, anti-link, anti-spam, anti-badword, warnings, AFK, welcome/goodbye, and group administration tools.
- Owner tools, premium-user records, backups, automation toggles, reminders, and plugin management.
- Protected dashboard with connection, runtime, memory, command/plugin registry, and multi-session controls.
- `/health` and `/ready` monitoring endpoints.

## Requirements

- Node.js 20 or newer.
- `ffmpeg` and `yt-dlp` installed on the host for local media conversion/download commands.
- A private hosting environment with persistent storage. WhatsApp auth folders must survive restarts.

## Setup

1. Extract the ZIP.
2. Copy `.env.example` to `.env` and set `OWNER_NUMBER`, `PAIRING_NUMBER`, and a unique `DASHBOARD_PASSWORD`.
3. Add your AI provider key to `AI_API_KEY` if you want AI responses. Keep `.env` private.
4. Run `npm install` and `npm run check`.
5. Run `npm start`.
6. Open `http://YOUR-HOST:9090`, sign in using `DASHBOARD_PASSWORD`, and follow the pairing code in the server logs. If `PAIRING_NUMBER` is blank, scan the QR code.

Phone numbers must include the country code and digits only, for example `2637XXXXXXXX`.

## Multi-session manager

The primary bot account continues to use `SESSION_DIR` (default `./session`). Additional accounts are created through the dashboard's **Multi-session manager** panel. Give each account a unique ID and enter its phone number (including country code) to request a pairing code. The manager supports up to five additional accounts. Additional auth data is stored under `./sessions/<session-id>/`. Never share these folders or pairing codes.

Additional sessions share the plugin registry and JSON database and pass incoming messages to the same command handler. They use isolated Baileys auth states, install group-event and automation handlers, and reconnect independently. Reminder scheduling remains attached to the primary session.

## Dashboard security

- `DASHBOARD_PASSWORD` is mandatory. If it is missing, dashboard login is disabled.
- Dashboard login uses a short-lived, server-signed token. No dashboard password is embedded in `index.html`.
- Dashboard data, command/plugin registries, system details, plugin reload, and session-management routes require authentication.
- `/health` and `/ready` are intentionally public for hosting health checks; they expose status only, not credentials or message contents.
- Use HTTPS or a trusted reverse proxy for public hosting. Do not expose the panel over plain HTTP on an untrusted network.

## Commands and plugins

Use `.menu` to browse categories and `.helpme` for help. Plugins are `.js` modules under `plugins/`; the loader registers primary commands and aliases while ignoring duplicates. Add plugins using the documented plugin object shape in the existing source files, then use the authenticated dashboard's reload control.

## Important operational notes

- Baileys is an unofficial WhatsApp Web client. Use a test account first; automated activity may violate WhatsApp terms or trigger account restrictions.
- Respect platform rules, copyright, privacy, and local law when downloading or forwarding media. Only download content you own or are authorized to use.
- AI and media features depend on valid external API credentials, reachable services, and installed host binaries. A command being present does not guarantee a third-party API is online.
- Back up `session/`, `sessions/`, and `data/` securely. Do not upload auth folders or `.env` to public repositories.
- Validate the bot in a private test group before enabling moderation or automation in production.

## Baileys package

This release uses the `@itsliaaa/baileys` fork through an npm alias, preserving the existing `@whiskeysockets/baileys` import path throughout the project:

```json
"@whiskeysockets/baileys": "npm:@itsliaaa/baileys@latest"
```

The socket factory is imported as a named export (`makeWASocket`) to match the fork documentation. Install with `npm install` after extracting the project.
