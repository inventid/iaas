import database from '../databases';
import log from '../log';
import populateUploadedAt from './populateTokensUploadedAt';

// eslint-disable-next-line no-process-env
const APP_INSTANCE = process.env.NODE_APP_INSTANCE;

function canNodeRunMigration() {
  // Run when not in PM2 or on the first instance only
  return !APP_INSTANCE || APP_INSTANCE === '0';
}

export default async function startMigrations() {
  if (!canNodeRunMigration()) {
    return;
  }

  const next = await database.nextPendingAppMigration();
  if (next === null) {
    return;
  }
  log('info', `Next app migration to run is '${next}'`);

  switch (next) {
    case 'uploadedAt':
      try {
        await populateUploadedAt();
        await database.markAppMigrationAsCompleted(next);
        log('info', `Finished migration for ${next}`);
      } catch (e) {
        log('warn', `Migration for ${next} threw in the process. This migration will be retried.`);
      }
      break;
    default:
      log('error', `Migration with name '${next}' was not handled in code`);
      return;
  }
  await startMigrations();
}
