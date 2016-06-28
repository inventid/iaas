const BLUR_RADIUS = 15;
const BLUR_SIGMA = 7;

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

export default (req) => {
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
  if (req.query.fit && ALLOWED_FITS.includes(req.query.fit)) {
    result.fit = req.query.fit.toLowerCase();
  }
  if (req.query.blur && req.query.blur === 'true') {
    result.blur = {
      radius: BLUR_RADIUS,
      sigma: BLUR_SIGMA
    }
  }

  // Check if the minimum is ste
  if (!result.name) {
    console.warn(result, req.params, req.query);
    return null;
  }
  return result;
}
