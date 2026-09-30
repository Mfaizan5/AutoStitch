/**
 * Custom design preview + try-on
 *
 *   POST /api/custom-preview          -> AI-edited preview of the customer's requested changes
 *   POST /api/custom-preview/try-on   -> virtual try-on of that preview on the customer's photo
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { z } = require('zod');
const Product = require('../models/Product');
const svc = require('../utils/customerPreviewService');
const { validateAndSanitizeImage, uploadTempVtoAsset } = require('../utils/s3Service');
const LocalSharpAdapter = require('../vto/LocalSharpAdapter');
const IdmVtonAdapter = require('../vto/IdmVtonAdapter');
const ReplicateAdapter = require('../vto/ReplicateAdapter');

const REGIONS = ['neckline', 'sleeves', 'hemline', 'embroidery', 'collar', 'cuffs'];
const CATEGORIES = ['tops', 'bottoms', 'dresses'];
const isObjectId = (value) => typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

const previewSchema = z
  .object({
    productId: z.string().min(1).max(100),
    selectedRegions: z.array(z.enum(REGIONS)).min(1).max(6),
    description: z.string().max(2000).optional().default(''),
    regionReferences: z
      .array(
        z.object({
          region: z.enum(REGIONS),
          image: z.string().min(1).max(2048),
          source: z.enum(['gallery', 'catalogue']).optional().default('gallery'),
          productId: z.string().max(100).optional(),
        })
      )
      .max(15)
      .optional()
      .default([]),
  })
  .superRefine((data, ctx) => {
    data.regionReferences.forEach((ref, i) => {
      if (!data.selectedRegions.includes(ref.region)) {
        ctx.addIssue({
          code: 'custom',
          path: ['regionReferences', i, 'region'],
          message: `Photo added for "${ref.region}", which is not one of the selected regions`,
        });
      }
    });
  });

const categoryFor = (product) => {
  const name = (product?.category || '').toLowerCase();
  if (name.includes('bottom')) return 'bottoms';
  if (name.includes('top')) return 'tops';
  return 'dresses';
};

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

const handleError = (res, error, label) => {
  if (error instanceof svc.PreviewError) return fail(res, error.status, error.message, error.code);
  console.error(`[${label}]`, error);
  return fail(res, 500, 'Something went wrong. Please try again.');
};

// @desc    Generate an AI preview of the requested customization
// @route   POST /api/custom-preview
// @access  Private
const generatePreview = async (req, res) => {
  try {
    if (!svc.isConfigured()) {
      return fail(res, 503, 'AI previews are not available right now.', 'PREVIEW_NOT_CONFIGURED');
    }

    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, 400, parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { productId, selectedRegions, description, regionReferences } = parsed.data;

    // 1. Base garment (only when the customer started from a real catalogue product)
    let baseProduct = null;
    if (isObjectId(productId)) {
      baseProduct = await Product.findOne({ _id: productId, isActive: true }).select('images category');
      if (!baseProduct) return fail(res, 404, 'The selected garment could not be found.');
    }
    const baseSource = baseProduct?.images?.[0];
    const baseRaw = baseSource ? await svc.loadCatalogueImage(baseSource) : null;
    const base = baseRaw ? await svc.normalizeImage(baseRaw) : null;

    // 2. Reference photos: verify each one, keep at most the number the model accepts
    const chosen = svc.selectReferences(regionReferences, selectedRegions);
    const productCache = new Map();
    const references = [];
    for (const ref of chosen) {
      let raw = null;
      if (ref.source === 'catalogue') {
        if (!isObjectId(ref.productId)) return fail(res, 400, 'A catalogue photo is missing its product.');
        if (!productCache.has(ref.productId)) {
          productCache.set(
            ref.productId,
            await Product.findOne({ _id: ref.productId, isActive: true }).select('images')
          );
        }
        const product = productCache.get(ref.productId);
        if (!product || !product.images.includes(ref.image)) {
          return fail(res, 400, 'A catalogue photo could not be found. Please pick it again.');
        }
        raw = await svc.loadCatalogueImage(ref.image);
      } else {
        raw = await svc.loadUploadedImage(ref.image);
      }
      if (!raw) return fail(res, 400, 'A reference photo could not be found. Please add it again.');
      references.push({ region: ref.region, image: await svc.normalizeImage(raw) });
    }

    // 3. Build the request: image 1 = base garment (if any), then the references
    const images = [];
    if (base) images.push(base);
    const imageNumbersByRegion = {};
    references.forEach((ref) => {
      images.push(ref.image);
      (imageNumbersByRegion[ref.region] = imageNumbersByRegion[ref.region] || []).push(images.length);
    });

    const prompt = svc.buildPrompt({
      hasBase: Boolean(base),
      regions: selectedRegions,
      description,
      imageNumbersByRegion,
    });
    const aspectRatio = base ? svc.pickAspectRatio(base.width, base.height) : '3:4';

    // 4. Generate + store
    const output = await svc.generateImage({ images, prompt, aspectRatio });
    const saved = await svc.savePreview(output);

    return res.status(201).json({
      success: true,
      previewId: saved.id,
      previewPath: saved.relativePath,
      category: categoryFor(baseProduct),
      usedBaseGarment: Boolean(base),
      usedReferences: references.length,
    });
  } catch (error) {
    return handleError(res, error, 'CustomPreview');
  }
};

// Only real base64 image data URLs are accepted, so this endpoint can never be
// pointed at a URL or a file path on the server.
const DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const localEngine = new LocalSharpAdapter();
const idmEngine = new IdmVtonAdapter();
const replicateEngine = new ReplicateAdapter();

// @desc    Virtual try-on of a generated preview on the customer's photo
// @route   POST /api/custom-preview/try-on
// @access  Private
const tryOnPreview = async (req, res) => {
  try {
    const { previewId, userPhoto, category, fitStyle } = req.body || {};

    if (typeof userPhoto !== 'string' || !DATA_URL.test(userPhoto)) {
      return fail(res, 400, 'Please upload a JPG, PNG or WebP photo.');
    }
    const garmentWebp = await svc.readPreview(previewId);
    if (!garmentWebp) return fail(res, 404, 'This design preview has expired. Please create it again.', 'PREVIEW_MISSING');

    let person;
    try {
      person = await validateAndSanitizeImage(userPhoto);
    } catch (err) {
      return fail(res, 400, err.message || 'That photo could not be used.');
    }

    // Some try-on engines expect JPEG input
    const garment = await sharp(garmentWebp).jpeg({ quality: 92 }).toBuffer();
    const options = {
      category: CATEGORIES.includes(category) ? category : 'dresses',
      garmentName: 'Custom design',
      fitStyle: ['Tailored', 'Relaxed', 'Slim'].includes(fitStyle) ? fitStyle : 'Tailored',
    };

    let result = null;
    let engine = 'local-sharp-compositor';

    if (process.env.REPLICATE_API_TOKEN) {
      try {
        result = await replicateEngine.generate(person.buffer, garment, options);
        engine = 'replicate-idm-vton';
      } catch (err) {
        console.warn('[CustomTryOn] Replicate notice:', err.message);
      }
    }
    if (!result && (process.env.VTON_SERVICE_URL || process.env.COLAB_TRYON_URL)) {
      try {
        result = await idmEngine.generate(person.buffer, garment, options);
        engine = 'idm-vton';
      } catch (err) {
        console.warn('[CustomTryOn] Colab GPU notice:', err.message);
      }
    }
    if (!result) {
      result = await localEngine.generate(person.buffer, garment, options);
    }

    // Result goes to the temporary folder that the existing cleanup cron purges.
    // The customer's own photo is never written to disk by this endpoint.
    const saved = await uploadTempVtoAsset(`custom_${crypto.randomBytes(6).toString('hex')}`, 'result', result);

    return res.json({ success: true, resultImage: saved.url, engine });
  } catch (error) {
    return handleError(res, error, 'CustomTryOn');
  }
};

module.exports = { generatePreview, tryOnPreview };