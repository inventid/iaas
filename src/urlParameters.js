import {areAllDefined} from "./helper";
import log from "./log";

const BLUR_RADIUS = Number(process.env.BLUR_RADIUS) || 15; //eslint-disable-line no-process-env
const BLUR_SIGMA = Number(process.env.BLUR_SIGMA) || 7; //eslint-disable-line no-process-env

const ALLOWED_TYPES = ['jpg', 'jpeg', 'jfif', 'jpe', 'png'];
const ALLOWED_FITS = ['clip', 'crop', 'canvas'];

const getMimeFromExtension = (extension) => {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
    case 'jfif':
    case 'jpe':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return null;
  }
};

export default (req, requireDimensions = true) => {
  // The default settings
  const result = {
    name: null,
    width: undefined,
    height: undefined,
    blur: null,
    type: 'jpg',
    mime: 'image/jpeg',
    fit: 'clip'
  };

  // Extract data
  result.name = req.params.name;
  const scale = Number(req.params.scale) || 1;
  result.width = Number(req.params.width) * scale || undefined;
  result.height = Number(req.params.height) * scale || undefined;

  if (ALLOWED_TYPES.includes(req.params.format.toLowerCase())) {
    result.type = req.params.format.toLowerCase();
    result.mime = getMimeFromExtension(result.type);
  }
  if (req.query.fit && ALLOWED_FITS.includes(req.query.fit.toLowerCase())) {
    result.fit = req.query.fit.toLowerCase();
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
