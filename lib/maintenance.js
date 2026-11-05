
import fs from 'node:fs/promises';
import path from 'node:path';

import config from '../config.js';

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const DEFAULT_MAX_AGE_HOURS = 24;
const DEFAULT_CLEANUP_INTERVAL = 60 * 60 * 1000;

const MAX_FILES_PER_RUN = 10_000;

let maintenanceTimer = null;
let cleaning = false;

let lastCleanup = {
  startedAt: null,
  completedAt: null,
  removed: 0,
  failed: 0,
  skipped: 0
};

// --------------------------------------------------
// DIRECTORY SAFETY
// --------------------------------------------------

function getProtectedDirectories() {
  return [
    config.sessionDir,
    path.dirname(config.databaseFile)
  ]
    .filter(Boolean)
    .map(directory => path.resolve(directory));
}

function isProtectedDirectory(directory) {
  const target = path.resolve(directory);

  return getProtectedDirectories().some(protectedPath => {
    return (
      target === protectedPath ||
      target.startsWith(protectedPath + path.sep) ||
      protectedPath.startsWith(target + path.sep)
    );
  });
}

// --------------------------------------------------
// TEMPORARY FILE CLEANUP
// --------------------------------------------------

export async function cleanTemporaryFiles(
  maxAgeHours = DEFAULT_MAX_AGE_HOURS
) {
  if (
    !Number.isFinite(maxAgeHours) ||
    maxAgeHours < 0
  ) {
    throw new Error(
      'maxAgeHours must be a non-negative number.'
    );
  }

  if (cleaning) {
    return {
      ...lastCleanup,
      skipped: lastCleanup.skipped + 1,
      busy: true
    };
  }

  cleaning = true;

  const result = {
    startedAt: Date.now(),
    completedAt: null,
    removed: 0,
    failed: 0,
    skipped: 0
  };

  try {
    const directory = path.resolve(config.mediaDir);

    if (isProtectedDirectory(directory)) {
      throw new Error(
        'Media directory cannot overlap the session or database directory.'
      );
    }

    await fs.mkdir(directory, {
      recursive: true
    });

    const files = await fs.readdir(directory, {
      withFileTypes: true
    });

    const cutoff =
      Date.now() - maxAgeHours * 60 * 60 * 1000;

    for (
      let index = 0;
      index < Math.min(files.length, MAX_FILES_PER_RUN);
      index++
    ) {
      const entry = files[index];

      // Only regular files are eligible.
      // Symlinks and directories are never followed or removed.
      if (!entry.isFile()) {
        result.skipped++;
        continue;
      }

      const filepath = path.join(
        directory,
        entry.name
      );

      try {
        const stat = await fs.lstat(filepath);

        if (!stat.isFile()) {
          result.skipped++;
          continue;
        }

        if (stat.mtimeMs >= cutoff) {
          result.skipped++;
          continue;
        }

        await fs.unlink(filepath);

        result.removed++;

      } catch (error) {
        result.failed++;

        console.error(
          `[MAINTENANCE] Failed to clean ${entry.name}:`,
          error.message
        );
      }
    }

    if (files.length > MAX_FILES_PER_RUN) {
      result.skipped += files.length - MAX_FILES_PER_RUN;
    }

    result.completedAt = Date.now();

    lastCleanup = { ...result };

    if (
      result.removed > 0 ||
      result.failed > 0
    ) {
      console.log(
        `[MAINTENANCE] Cleanup: ` +
        `${result.removed} removed, ` +
        `${result.failed} failed, ` +
        `${result.skipped} skipped.`
      );
    }

    return { ...result };

  } finally {
    cleaning = false;
  }
}

// --------------------------------------------------
// START MAINTENANCE
// --------------------------------------------------

export function startMaintenance() {
  if (maintenanceTimer) {
    return maintenanceTimer;
  }

  console.log(
    '[PRECIOUS-MD] Maintenance service started.'
  );

  const maxAgeHours =
    Number(config.tempFileMaxAgeHours) ||
    DEFAULT_MAX_AGE_HOURS;

  const interval =
    Number(config.maintenanceInterval) ||
    DEFAULT_CLEANUP_INTERVAL;

  // Initial cleanup.
  cleanTemporaryFiles(maxAgeHours).catch(error => {
    console.error(
      '[MAINTENANCE] Initial cleanup failed:',
      error.message
    );
  });

  // Scheduled cleanup.
  maintenanceTimer = setInterval(() => {
    cleanTemporaryFiles(maxAgeHours).catch(error => {
      console.error(
        '[MAINTENANCE] Scheduled cleanup failed:',
        error.message
      );
    });
  }, Math.max(60_000, interval));

  maintenanceTimer.unref?.();

  return maintenanceTimer;
}

// --------------------------------------------------
// STOP MAINTENANCE
// --------------------------------------------------

export function stopMaintenance() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }

  console.log(
    '[PRECIOUS-MD] Maintenance service stopped.'
  );
}

// --------------------------------------------------
// STATUS
// --------------------------------------------------

export function isMaintenanceRunning() {
  return maintenanceTimer !== null;
}

export function getMaintenanceStatus() {
  return {
    running: isMaintenanceRunning(),
    cleaning,
    lastCleanup: { ...lastCleanup }
  };
}
