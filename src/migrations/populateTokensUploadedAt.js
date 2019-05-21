import config from 'config';
import promisify from "promisify-node";
import database from '../databases';
import log from '../log';

const fs = promisify('fs');

const timestampWhenFileNotFound = '1970-01-01T00:00:00.000Z';

export default async function populateUploadedAt() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const toEnrich = await database.getTokensWithoutUploadedAt();

    if (toEnrich.length === 0) {
      // Done
      log('info', 'Enriching for `populateUploadedAt` completed');
      return true;
    }

    for (let i = 0; i < toEnrich.length; i = i + 1) {
      const imageId = toEnrich[i].image_id;
      const imagePath = `${config.get('originals_dir')}/${imageId}`;

      let creationDate;
      try {
        const fileData = await fs.stat(imagePath);
        creationDate = fileData.birthtime
          || fileData.ctime
          || fileData.mtime;
      } catch (e) {
        // File most likely does not exist. We will fallback to 01.01.1970 for now
        // These tokens should be deleted as the original is not accessible
        creationDate = timestampWhenFileNotFound;
      }
      await database.setUploadedAt(imageId, creationDate);
    }

    log('info', `Enriched ${toEnrich.length} items`);
  }
}
