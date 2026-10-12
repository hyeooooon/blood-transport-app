import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Serialize atomic replacements; OneDrive/antivirus may briefly lock Windows files. */
export function createPersistence(file, { rename = renameSync, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let queue = Promise.resolve();
  return state => {
    const content = JSON.stringify(state);
    const task = queue.then(async () => {
      mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      writeFileSync(temporary, content);
      for (let attempt = 0; attempt < 6; attempt++) {
        try { rename(temporary, file); return; }
        catch (e) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt === 5) {
            throw new Error(`Could not save records: ${e.message}. Recoverable snapshot retained at ${temporary}`);
          }
          await wait(25 * 2 ** attempt);
        }
      }
    });
    // A rejected write is reported to its caller; it must not poison later saves.
    queue = task.catch(() => {});
    return task;
  };
}
