const { z } = require('zod');
const { logActivity } = require('../services/audit');
const { normalizeTypeDetails } = require('../services/typeDetails');

const emptyStringToNull = (value) => (
  typeof value === 'string' && value.trim() === '' ? null : value
);

// ── Auth ─────────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(255),
  inviteToken: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

// ── Media ─────────────────────────────────────────────────────────────────────

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD', 'Paperback', 'Hardcover', 'Trade'];
const MEDIA_TYPES = ['movie', 'tv_series', 'tv_episode', 'book', 'audio', 'game', 'comic_book'];
const nullableDateSchema = z.preprocess(
  emptyStringToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable()
);
const nullableNumberSchema = (schema) => z.preprocess((value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) return numeric;
  }
  return value;
}, schema.optional().nullable());
const nullableUrlSchema = z.preprocess(
  emptyStringToNull,
  z.string().url().optional().nullable()
);

const mediaBaseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  media_type: z.enum(MEDIA_TYPES).optional().nullable(),
  original_title: z.string().max(500).optional().nullable(),
  release_date: nullableDateSchema,
  year: nullableNumberSchema(z.number().int().min(1888).max(2100)),
  format: z.enum(MEDIA_FORMATS).optional().nullable(),
  genre: z.string().max(100).optional().nullable(),
  director: z.string().max(255).optional().nullable(),
  cast: z.string().max(1000).optional().nullable(),
  rating: nullableNumberSchema(z.number().min(0).max(10)),
  user_rating: nullableNumberSchema(z.number().min(0).max(5)),
  runtime: nullableNumberSchema(z.number().int().min(1).max(9999)),
  upc: z.string().max(50).optional().nullable(),
  signed_by: z.string().max(255).optional().nullable(),
  signed_role: z.enum(['author', 'producer', 'cast']).optional().nullable(),
  signed_on: nullableDateSchema,
  signed_at: z.string().max(255).optional().nullable(),
  signed_proof_path: z.string().max(1000).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  overview: z.string().max(10000).optional().nullable(),
  tmdb_id: nullableNumberSchema(z.number().int().positive()),
  tmdb_media_type: z.enum(['movie', 'tv']).optional().nullable(),
  tmdb_url: nullableUrlSchema,
  trailer_url: nullableUrlSchema,
  poster_path: z.string().max(1000).optional().nullable(),
  backdrop_path: z.string().max(1000).optional().nullable(),
  season_number: nullableNumberSchema(z.number().int().min(0).max(200)),
  episode_number: nullableNumberSchema(z.number().int().min(0).max(5000)),
  episode_title: z.string().max(500).optional().nullable(),
  network: z.string().max(255).optional().nullable(),
  type_details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().nullable(),
  library_id: nullableNumberSchema(z.number().int().positive()),
  space_id: nullableNumberSchema(z.number().int().positive())
});

const mediaCreateSchema = mediaBaseSchema.superRefine((data, ctx) => {
  const mediaType = data.media_type || 'movie';
  const hasSeason = data.season_number !== undefined && data.season_number !== null;
  const hasEpisodeNumber = data.episode_number !== undefined && data.episode_number !== null;
  const hasEpisodeTitle = data.episode_title !== undefined && data.episode_title !== null && String(data.episode_title).trim() !== '';
  const hasNetwork = data.network !== undefined && data.network !== null && String(data.network).trim() !== '';
  const hasTvFields = hasSeason || hasEpisodeNumber || hasEpisodeTitle || hasNetwork;

  if (!['tv_series', 'tv_episode'].includes(mediaType) && hasTvFields) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TV-specific fields are only valid for TV media types'
    });
  }
  if (mediaType === 'tv_series' && (hasEpisodeNumber || hasEpisodeTitle)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TV series entries cannot include episode-specific fields'
    });
  }
  if (data.type_details && typeof data.type_details === 'object') {
    const normalized = normalizeTypeDetails(mediaType, data.type_details, { strict: true });
    const invalidKeys = normalized.invalidKeys || [];
    if (invalidKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid type_details key(s) for ${mediaType}: ${invalidKeys.join(', ')}`
      });
    }
    for (const detailError of (normalized.errors || [])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type_details', detailError.key],
        message: detailError.message
      });
    }
  }
});

// Patch only requires at least one valid field — same shape, all optional
const mediaUpdateSchema = mediaBaseSchema.partial().superRefine((data, ctx) => {
  if (Object.keys(data).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one field is required for update'
    });
    return;
  }
  if (data.type_details && typeof data.type_details === 'object' && data.media_type) {
    const mediaType = data.media_type;
    const normalized = normalizeTypeDetails(mediaType, data.type_details, { strict: true });
    const invalidKeys = normalized.invalidKeys || [];
    if (invalidKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid type_details key(s) for ${mediaType}: ${invalidKeys.join(', ')}`
      });
    }
    for (const detailError of (normalized.errors || [])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type_details', detailError.key],
        message: detailError.message
      });
    }
  }
});

// ── Profile ───────────────────────────────────────────────────────────────────

const profileUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  current_password: z.string().min(1).optional()
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one profile field is required' }
).refine(
  (data) => !data.password || Boolean(data.current_password),
  { message: 'Current password is required to set a new password', path: ['current_password'] }
);

const passwordResetConsumeSchema = z.object({
  token: z.string().min(10, 'Reset token is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

// ── Admin ─────────────────────────────────────────────────────────────────────

const roleUpdateSchema = z.object({
  role: z.enum(['admin', 'user', 'viewer'])
});

const inviteCreateSchema = z.object({
  email: z.string().email('Valid email is required')
});

const generalSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  density: z.enum(['comfortable', 'compact']).optional()
});

const libraryCreateSchema = z.object({
  name: z.string().min(1, 'Library name is required').max(255),
  description: z.string().max(2000).optional().nullable()
});

const libraryUpdateSchema = libraryCreateSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one library field is required' }
);

const librarySelectSchema = z.object({
  library_id: z.number().int().positive('library_id must be a positive integer')
});

const libraryDeleteSchema = z.object({
  confirm_name: z.string().min(1, 'confirm_name is required')
});

const libraryTransferSchema = z.object({
  new_owner_user_id: z.number().int().positive('new_owner_user_id must be a positive integer')
});

const libraryArchiveSchema = z.object({
  confirm_name: z.string().min(1, 'confirm_name is required')
});

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * validate(schema) returns an Express middleware that parses req.body
 * through the given zod schema. On failure, responds 400 with structured
 * error details. On success, replaces req.body with the parsed (coerced)
 * data and calls next().
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message
    }));
    void logActivity(req, 'request.validation.failed', 'http_request', null, {
      method: req.method,
      url: req.originalUrl,
      errors
    });
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  req.body = result.data;
  next();
};

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  mediaCreateSchema,
  mediaUpdateSchema,
  profileUpdateSchema,
  passwordResetConsumeSchema,
  roleUpdateSchema,
  inviteCreateSchema,
  generalSettingsSchema,
  libraryCreateSchema,
  libraryUpdateSchema,
  librarySelectSchema,
  libraryDeleteSchema,
  libraryTransferSchema,
  libraryArchiveSchema
};
