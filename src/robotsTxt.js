import config from 'config';
import {pushFile} from './aws';
import log from './log';


export default function robotsTxt() {
  return (config.has('allow_indexing') && config.get('allow_indexing')) ?
    "User-Agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n";
}

export async function syncRobotsTxt() {
  await pushFile('robots.txt', robotsTxt(), 'text/plain');
  log('info', 'Synced current robots.txt file to AWS');
}
