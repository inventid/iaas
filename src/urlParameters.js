import {areAllDefined} from "./helper";
import log from "./log";
import config from "config";

const BLUR_RADIUS = Number(process.env.BLUR_RADIUS) || 15; //eslint-disable-line no-process-env
const BLUR_SIGMA = Number(process.env.BLUR_SIGMA) || 7; //eslint-disable-line no-process-env

const WEBP_MIME_TYPE = 'image/webp';
const ALLOWED_TYPES = ['jpg', 'jpeg', 'jfif', 'jpe', 'png', 'webp'];
const ALLOWED_FITS = ['clip', 'crop', 'canvas', 'cover'];

const ALLOW_DYNAMIC_SWITCH_TO_WEBP = (config.has('webp') && config.has('webp.allow_dynamic_switch')
  && config.get('webp.allow_dynamic_switch'));
const ALLOW_WEBP_OPT_IN = (config.has('webp') && config.has('webp.allow_opt_in')
  && config.get('webp.allow_opt_in'));

log('info', `Allowing dynamic switch to webp: ${ALLOW_DYNAMIC_SWITCH_TO_WEBP ? 'true' : false}`);
log('info', `Allowing opt in for webp: ${ALLOW_WEBP_OPT_IN ? 'true' : false}`);

const getMimeFromExtension = (extension) => {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
    case 'jfif':
    case 'jpe':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return WEBP_MIME_TYPE;
    default:
      return null;
  }
};

export function hasFiltersApplied(params) {
  return Boolean(params.blur) || Number.isFinite(params.quality);
}

export default (req, requireDimensions = true) => {
  // The default settings
  const result = {
    name: null,
    width: undefined,
    height: undefined,
    blur: null,
    type: 'jpg',
    mime: 'image/jpeg',
    fit: 'clip',
    quality: -1
  };

  // Extract data
  result.name = req.params.name;
  const scale = Number(req.params.scale) || 1;
  result.width = Number(req.params.width) * scale || undefined;
  result.height = Number(req.params.height) * scale || undefined;

  if (ALLOWED_TYPES.includes(req.params.format.toLowerCase())) {
    result.type = req.params.format.toLowerCase();
    result.mime = getMimeFromExtension(result.type);

    const isWebpAllowedForRequest = (ALLOW_DYNAMIC_SWITCH_TO_WEBP ||
      (ALLOW_WEBP_OPT_IN && req.query.allow_webp === 'true'));

    if (isWebpAllowedForRequest && result.type !== 'webp' &&
      req.headers.accept && req.headers.accept.includes(WEBP_MIME_TYPE)) {
      log('debug', 'Switching to WEBP');
      result.type = 'webp';
      result.mime = WEBP_MIME_TYPE;
    }
  }

  if (req.query.fit && ALLOWED_FITS.includes(req.query.fit.toLowerCase())) {
    result.fit = req.query.fit.toLowerCase();
  }
  // Only do this for jpg and ignore it for all other formats
  if (req.query.quality && result.mime === 'image/jpeg') {
    result.quality = Number(req.query.quality) || -1;
  }
  if (req.query.blur && req.query.blur === 'true') {
    result.blur = {
      radius: BLUR_RADIUS,
      sigma: BLUR_SIGMA
    };
  }

  // Check if the minimum is set
  if (!result.name || (!requireDimensions && areAllDefined([result.width, result.height]))) {
    log('warn', `${result}, ${req.params}, ${req.query}`);
    return null;
  }
  return result;
};
