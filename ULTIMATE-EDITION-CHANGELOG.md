# PRECIOUS-MD v3.2.0 — Ultimate Edition

## Main changes
- Preserved the existing v3.1.0 plugin-based Baileys project and its command modules.
- Added isolated secondary WhatsApp session manager with per-account auth folders, pairing-code support, independent reconnect handling, and dashboard API controls.
- Added dashboard UI to create, inspect, and stop secondary sessions.
- Removed the hard-coded dashboard password from server and browser source.
- Dashboard login now uses the backend `/api/login` endpoint and a signed, expiring server token.
- Protected dashboard data, plugin/command registries, and administrative endpoints with authentication.
- Added `.env.example`, deployment/security documentation, and updated package version.

## Validation
- `npm run check` runs Node syntax checks across `index.js`, `config.js`, all `lib/*.js`, and all `plugins/*.js`.
- Multi-session WhatsApp pairing still requires a real phone and WhatsApp Linked Devices confirmation; that cannot be completed in a static build environment.

- Switched the Baileys dependency to `npm:@itsliaaa/baileys@latest` via the `@whiskeysockets/baileys` npm alias.
- Updated primary and secondary session socket imports to the fork's documented named `makeWASocket` export.
