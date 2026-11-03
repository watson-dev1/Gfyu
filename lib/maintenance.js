
import fs from 'node:fs/promises';
import path from 'node:path';

export async function cleanTemporaryFiles(maxAgeHours = 24) {
  const directory = path.resolve(config.mediaDir);

  await fs.mkdir(directory, { recursive: true });

  const files = await fs.readdir(directory);
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;

  let removed = 0;

  for (const filename of files) {
    const filepath = path.join(directory, filename);

    try {
      const stat = await fs.stat(filepath);

      if (stat.isFile() && stat.mtimeMs < cutoff) {
        await fs.unlink(filepath);
        removed++;
      }
    } catch (error) {
      console.error(`Temporary cleanup failed for ${filename}:`, error.message);
    }
  }

  return removed;
}

export function startMaintenance() {
  cleanTemporaryFiles().catch(console.error);

  const timer = setInterval(() => {
    cleanTemporaryFiles().catch(console.error);
  }, 60 * 60 * 1000);

  timer.unref?.();

  return timer;
}
