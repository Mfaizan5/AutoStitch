/**
 * Custom design preview service
 * -----------------------------
 * Builds an AI-edited preview of a garment from a customization request:
 * the base garment photo + the reference photos the customer picked for each
 * region + the written notes. Uses a Gemini image model through the
 * Interactions API.
 *
 * Security notes
 *  - Gallery photos are only ever read from this server's /uploads folder.
 *  - Catalogue photos must belong to a real product (checked by the controller)
 *    and are the only images that may be fetched from another host.
 *  - Nothing the client sends is used as a file path or fetched as a URL.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const PREVIEW_DIR = path.join(UPLOADS_DIR, 'custom-previews');
const PHOTO_DIRS = [
  path.resolve(__dirname, '../../frontend/public/Photos'),
  path.resolve(__dirname, '../../frontend/Photos'),
];

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
// 1 base garment + 9 references stays inside the 10 "object" images the model accepts
const MAX_REFERENCE_IMAGES = 9;

const ASPECT_RATIOS = {
  '1:1': 1,
  '2:3': 2 / 3,
  '3:4': 3 / 4,
  '4:5': 4 / 5,
  '5:4': 5 / 4,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

class PreviewError extends Error {
  constructor(message, { status = 500, code = 'PREVIEW_FAILED' } = {}) {
    super(message);
    this.name = 'PreviewError';
    this.status = status;
    this.code = code;
  }
}

const isConfigured = () => Boolean(process.env.GEMINI_API_KEY);
const getModel = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const getTimeoutMs = () => Number(process.env.GEMINI_TIMEOUT_MS || 90000);

/* ------------------------------------------------------------------ */
/* Safe image loading                                                  */
/* ------------------------------------------------------------------ */

const insideDir = (base, target) => {
  const rel = path.relative(base, target);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Returns the URL path ("/uploads/x.png") of an absolute or site-relative link, else null. */
const getPathname = (src) => {
  if (typeof src !== 'string' || src.length === 0 || src.length > 2048) return null;
  try {
    if (src.startsWith('/') && !src.startsWith('//')) return src.split(/[?#]/)[0];
    if (/^https?:\/\//i.test(src)) return new URL(src).pathname;
  } catch (_) {
    /* fall through */
  }
  return null;
};

/** Maps "/uploads/..." or "/Photos/..." to candidate files on disk (never outside those folders). */
const resolveLocalCandidates = (pathname, { uploadsOnly = false } = {}) => {
  if (!pathname) return [];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    return [];
  }
  if (decoded.includes('\0')) return [];

  if (decoded.startsWith('/uploads/')) {
    const target = path.resolve(UPLOADS_DIR, decoded.slice('/uploads/'.length));
    return insideDir(UPLOADS_DIR, target) ? [target] : [];
  }
  if (!uploadsOnly && decoded.startsWith('/Photos/')) {
    const rest = decoded.slice('/Photos/'.length);
    return PHOTO_DIRS.map((dir) => ({ dir, target: path.resolve(dir, rest) }))
      .filter(({ dir, target }) => insideDir(dir, target))
      .map(({ target }) => target);
  }
  return [];
};

const readFirstExisting = async (candidates) => {
  for (const file of candidates) {
    try {
      const stat = await fs.promises.stat(file);
      if (stat.isFile() && stat.size <= MAX_SOURCE_BYTES) return await fs.promises.readFile(file);
    } catch (_) {
      /* try the next candidate */
    }
  }
  return null;
};

const fetchRemoteImage = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_SOURCE_BYTES) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return buffer.length <= MAX_SOURCE_BYTES ? buffer : null;
};

/** Customer gallery photo: must be a file in this server's /uploads folder. Never fetched remotely. */
const loadUploadedImage = async (src) => {
  const candidates = resolveLocalCandidates(getPathname(src), { uploadsOnly: true });
  return readFirstExisting(candidates);
};

/** Catalogue photo. Only call this with an image URL taken from a Product record. */
const loadCatalogueImage = async (src) => {
  const local = await readFirstExisting(resolveLocalCandidates(getPathname(src)));
  if (local) return local;
  if (/^https?:\/\//i.test(src)) {
    try {
      return await fetchRemoteImage(src);
    } catch (_) {
      return null;
    }
  }
  return null;
};

/** Validates it really is an image, fixes orientation, and shrinks it to keep the API call small. */
const normalizeImage = async (buffer, maxSide = 1280) => {
  try {
    const { data, info } = await sharp(buffer, { failOnError: true })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, mimeType: 'image/jpeg', width: info.width, height: info.height };
  } catch (_) {
    throw new PreviewError('One of the photos could not be read as an image.', { status: 400, code: 'BAD_IMAGE' });
  }
};

/* ------------------------------------------------------------------ */
/* Prompt + request building                                           */
/* ------------------------------------------------------------------ */

const pickAspectRatio = (width, height) => {
  if (!width || !height) return '3:4';
  const target = width / height;
  let best = '3:4';
  let bestDiff = Infinity;
  Object.entries(ASPECT_RATIOS).forEach(([label, ratio]) => {
    const diff = Math.abs(Math.log(ratio / target));
    if (diff < bestDiff) {
      best = label;
      bestDiff = diff;
    }
  });
  return best;
};

/**
 * Keeps at most `max` reference photos, taking them region by region
 * (round-robin) so every region still gets represented.
 */
const selectReferences = (references, regionOrder, max = MAX_REFERENCE_IMAGES) => {
  const byRegion = new Map(regionOrder.map((region) => [region, []]));
  references.forEach((ref) => {
    if (byRegion.has(ref.region)) byRegion.get(ref.region).push(ref);
  });
  const picked = [];
  let added = true;
  for (let round = 0; picked.length < max && added; round++) {
    added = false;
    for (const region of regionOrder) {
      const ref = byRegion.get(region)[round];
      if (ref && picked.length < max) {
        picked.push(ref);
        added = true;
      }
    }
  }
  // Keep the photos grouped by region so the numbering in the prompt reads naturally
  return regionOrder.flatMap((region) => picked.filter((ref) => ref.region === region));
};

const cleanText = (text = '') =>
  String(text).replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim().slice(0, 1200);

const describeImages = (numbers) => {
  if (numbers.length === 1) return `image ${numbers[0]}`;
  const head = numbers.slice(0, -1).join(', ');
  return `images ${head} and ${numbers[numbers.length - 1]}`;
};

/**
 * @param {boolean} hasBase            whether image 1 is the base garment
 * @param {string[]} regions           selected regions, in order
 * @param {Object<string, number[]>} imageNumbersByRegion  region -> image numbers in the request
 */
const buildPrompt = ({ hasBase, regions, description, imageNumbersByRegion }) => {
  const lines = [];
  if (hasBase) {
    lines.push('You are editing a fashion garment photo for a custom-tailoring marketplace.');
    lines.push("Image 1 is the base garment. Edit it to show the customer's requested changes and return the edited image.");
  } else {
    lines.push('You are designing a garment for a custom-tailoring marketplace.');
    lines.push('Create one photorealistic fashion photo of the garment described below.');
  }

  lines.push('', 'Requested changes:');
  regions.forEach((region) => {
    const numbers = imageNumbersByRegion[region] || [];
    lines.push(
      numbers.length > 0
        ? `- ${region}: redesign it so it matches the design shown in ${describeImages(numbers)}.`
        : `- ${region}: change it as described in the customer's notes.`
    );
  });

  const notes = cleanText(description);
  if (notes) lines.push('', `Customer's notes: "${notes}"`);

  lines.push('', 'Rules:');
  lines.push(
    hasBase
      ? '- Change ONLY the regions listed above. Keep the fabric, colour, print, silhouette, model, pose, framing and background of image 1 the same.'
      : '- Show the whole garment clearly, front view, on a plain light background.'
  );
  lines.push('- Reference images are only for the design details of the region they are assigned to. Do not copy people, faces, backgrounds or any other part from them.');
  lines.push('- No text, logos or watermarks. Return a single image.');
  return lines.join('\n');
};

/* ------------------------------------------------------------------ */
/* Gemini call                                                         */
/* ------------------------------------------------------------------ */

/** Pulls the final image out of an Interactions API response (with fallbacks for older shapes). */
const extractImage = (data) => {
  const blocks = [];
  if (Array.isArray(data?.steps)) {
    data.steps.forEach((step) => {
      if (step?.type === 'model_output' && Array.isArray(step.content)) blocks.push(...step.content);
    });
  }
  const images = blocks.filter((block) => block?.type === 'image' && block.data);
  if (images.length > 0) return Buffer.from(images[images.length - 1].data, 'base64');

  if (data?.output_image?.data) return Buffer.from(data.output_image.data, 'base64');

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.map((p) => p.inlineData || p.inline_data).filter((p) => p?.data);
  if (inline.length > 0) return Buffer.from(inline[inline.length - 1].data, 'base64');

  return null;
};

const extractText = (data) => {
  const texts = [];
  if (Array.isArray(data?.steps)) {
    data.steps.forEach((step) => {
      if (step?.type === 'model_output' && Array.isArray(step.content)) {
        step.content.forEach((block) => block?.type === 'text' && block.text && texts.push(block.text));
      }
    });
  }
  return texts.join(' ').slice(0, 300);
};

const buildRequestBody = ({ images, prompt, aspectRatio }) => {
  const body = {
    model: getModel(),
    input: [
      { type: 'text', text: prompt },
      ...images.map((img) => ({ type: 'image', mime_type: img.mimeType, data: img.buffer.toString('base64') })),
    ],
    response_format: { type: 'image', aspect_ratio: aspectRatio, image_size: '1K' },
  };
  if (process.env.GEMINI_IMAGE_THINKING) {
    body.generation_config = { thinking_level: process.env.GEMINI_IMAGE_THINKING };
  }
  return body;
};

const generateImage = async ({ images, prompt, aspectRatio }) => {
  if (!isConfigured()) {
    throw new PreviewError('AI previews are not available right now.', { status: 503, code: 'PREVIEW_NOT_CONFIGURED' });
  }

  let res;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(buildRequestBody({ images, prompt, aspectRatio })),
      signal: AbortSignal.timeout(getTimeoutMs()),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new PreviewError('The AI took too long to respond. Please try again.', { status: 504, code: 'TIMEOUT' });
    }
    console.error('[CustomPreview] Could not reach Gemini:', err.message);
    throw new PreviewError('Could not reach the AI service. Please try again.', { status: 502, code: 'UNREACHABLE' });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[CustomPreview] Gemini returned ${res.status}:`, detail.slice(0, 600));
    if (res.status === 429) {
      throw new PreviewError('The AI service is busy right now. Please try again in a minute.', { status: 429, code: 'RATE_LIMITED' });
    }
    if (res.status === 400) {
      throw new PreviewError('The AI could not process these photos. Try different reference photos.', { status: 422, code: 'PROVIDER_BAD_REQUEST' });
    }
    // 401/403/404 etc. are server configuration problems (key, billing, model name)
    throw new PreviewError('AI previews are temporarily unavailable.', { status: 502, code: 'PROVIDER_ERROR' });
  }

  const data = await res.json();
  const image = extractImage(data);
  if (!image) {
    console.warn('[CustomPreview] Gemini returned no image. Text:', extractText(data));
    throw new PreviewError(
      'The AI did not return an image. Try rewording your description or using different photos.',
      { status: 422, code: 'NO_IMAGE' }
    );
  }
  return image;
};

/* ------------------------------------------------------------------ */
/* Preview storage                                                     */
/* ------------------------------------------------------------------ */

const PREVIEW_ID = /^[a-f0-9]{32}$/;

const savePreview = async (buffer) => {
  await fs.promises.mkdir(PREVIEW_DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString('hex');
  const webp = await sharp(buffer).webp({ quality: 92 }).toBuffer();
  await fs.promises.writeFile(path.join(PREVIEW_DIR, `${id}.webp`), webp);
  return { id, relativePath: `/uploads/custom-previews/${id}.webp` };
};

const readPreview = async (id) => {
  if (typeof id !== 'string' || !PREVIEW_ID.test(id)) return null;
  try {
    return await fs.promises.readFile(path.join(PREVIEW_DIR, `${id}.webp`));
  } catch (_) {
    return null;
  }
};

module.exports = {
  PreviewError,
  MAX_REFERENCE_IMAGES,
  PREVIEW_DIR,
  isConfigured,
  getModel,
  loadUploadedImage,
  loadCatalogueImage,
  normalizeImage,
  pickAspectRatio,
  selectReferences,
  buildPrompt,
  buildRequestBody,
  extractImage,
  generateImage,
  savePreview,
  readPreview,
};