import config from 'config';
import promisify from "promisify-node";
import database from '../databases';
import log from '../log';

const fs = promisify('fs');

export default async function populateUploadedAt() {
  const toEnrich = await database.getTokensWithoutUploadedAt();

  if (toEnrich.length === 0) {
    // Done
    log('info', 'Enriching for `populateUploadedAt` completed');
    return true;
  }

  for (let i = 0; i < toEnrich.length; i = i + 1) {
    const imageId = toEnrich[i].image_id;
    const imagePath = `${config.get('originals_dir')}/${imageId}`;

    const fileData = await fs.stat(imagePath);
    const creationDate = fileData.birthtime
      || fileData.ctime
      || fileData.mtime;
    await database.setUploadedAt(imageId, creationDate);
  }

  log('info', `Enriched ${toEnrich.length} items`);

  return false;
}
