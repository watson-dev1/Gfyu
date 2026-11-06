# PRECIOUS-MD v3.1.0 plugin additions

Added plugins:
- `plugins/security.js`: group controls for AntiBot, AntiPorn, AntiForeign, allowed calling-code list, and warning threshold.
- `plugins/premium.js`: owner commands `addpremium`, `delpremium`, `listpremium` with expiry timestamps.
- `plugins/user-block.js`: owner commands `block` and `unblock` using Baileys `updateBlockStatus`.
- `plugins/github-sync.js`: owner command `githubsync` checks the latest public commit in `watson-dev1/PRECIOUS-MD` and provides the source archive link. It intentionally does not overwrite a running installation or restart it.
- `plugins/group-extras.js`: `kickme`, `kick1`, and `admin` commands.

## Important integration notes

The existing message handler already enforces anti-link, anti-badword, and anti-spam. The new AntiBot, AntiPorn, and AntiForeign commands currently store their settings, but their enforcement is not enabled by these plugins alone. AntiPorn requires a configured image moderation service; AntiBot requires reliable account signals; AntiForeign requires handler-level participant/message filtering using `foreignAllowedCodes`.

The current moderation handler counts warnings but does not yet perform the automatic third-warning removal. `warnlimit` stores the requested threshold; enforcement still requires a handler change and bot-admin permissions.

No `263` country-code rejection has been added. Existing WhatsApp session credentials are not included in this archive.
