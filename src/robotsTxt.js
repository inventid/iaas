import config from 'config';
import {pushFile} from './aws';
import log from './log';


export default function robotsTxt() {
  return (config.has('allow_indexing') && config.get('allow_indexing')) ?
    "User-agent: *\nAllow: /" : "User-agent: *\nDisallow: /";
}

export async function syncRobotsTxt() {
  await pushFile('robots.txt', robotsTxt(), 'text/plain');
  log('info', 'Synced current robots.txt file to AWS');
}
