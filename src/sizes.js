import config from 'config';

export const MAX_IMAGE_IN_MP = (config.has('constraints.max_input') && config.get('constraints.max_input')) || 30;
export const MAX_IMAGE_ON_DISK = (config.has('constraints.max_on_disk') && config.get('constraints.max_on_disk')) || 30;
