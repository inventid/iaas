import database from '../databases';
import log from '../log';
import populateUploadedAt from './populateTokensUploadedAt';

// eslint-disable-next-line no-process-env
const APP_INSTANCE = process.env.NODE_APP_INSTANCE;

function canNodeRunMigration() {
  // Run when not in PM2 or on the first instance only
  return !APP_INSTANCE || APP_INSTANCE === '0';
}

function startMigration(method) {
  return new Promise(resolve => {
    if (!canNodeRunMigration()) {
      resolve();
      return;
    }
    const reschedule = () => setTimeout(async () => {
      const done = await method();
      if (!done) {
        reschedule();
      } else {
        resolve();
      }
    }, 2500);
    reschedule();
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
      await startMigration(populateUploadedAt);
      break;
    case null:
      log('info', 'No application migration to be run');
      return;
  }
  await database.markAppMigrationAsCompleted(next);
  await startMigrations();
}
