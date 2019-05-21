import database from '../databases';
import log from '../log';
import populateUploadedAt from './populateTokensUploadedAt';

// eslint-disable-next-line no-process-env
const APP_INSTANCE = process.env.NODE_APP_INSTANCE;

function canNodeRunMigration() {
  // Run when not in PM2 or on the first instance only
  return !APP_INSTANCE || APP_INSTANCE === '0';
}

function startMigration(migration) {
  return new Promise(async (resolve, reject) => {
    if (!canNodeRunMigration()) {
      resolve();
      return;
    }

    try {
      const done = await migration();
      if (!done) {
        reject();
      } else {
        resolve();
      }
    } catch (e) {
      reject();
    }
  });
}

export default async function startMigrations() {
  const next = await database.nextPendingAppMigration();
  if (next === null) {
    return;
  }
  log('info', `Next app migration to run is '${next}'`);

  switch (next) {
    case 'uploadedAt':
      try {
        await startMigration(populateUploadedAt);
        await database.markAppMigrationAsCompleted(next);
        log('info', `Finished migration for ${next}`);
      } catch (e) {
        log('warn', `Migration for ${next} threw in the process. This migration will be retried.`);
      }
      break;
    case null:
      log('info', 'No application migration to be run');
      return;
  }
  await startMigrations();
}
