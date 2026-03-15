const { z } = require('zod');
const { logActivity } = require('../services/audit');
const { normalizeTypeDetails } = require('../services/typeDetails');
const { COLLECTIBLE_SUBTYPES } = require('../services/collectibles');
const { PERSONAL_ACCESS_TOKEN_SCOPES } = require('../services/personalAccessTokens');
const { SERVICE_ACCOUNT_KEY_SCOPES, SERVICE_ACCOUNT_ALLOWED_PREFIXES } = require('../services/serviceAccountKeys');

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

const simpleSearchSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(255, 'title is too long'),
  year: z.preprocess((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return null;
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) return numeric;
    }
    return value;
  }, z.number().int().min(1888).max(2100).optional().nullable()),
  mediaType: z.enum(['movie', 'tv']).optional()
});

const titleAuthorSearchSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(255, 'title is too long'),
  author: z.preprocess(emptyStringToNull, z.string().max(255).optional().nullable())
});

const titleArtistSearchSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(255, 'title is too long'),
  artist: z.preprocess(emptyStringToNull, z.string().max(255).optional().nullable())
});

const upcLookupSchema = z.object({
  upc: z.string()
    .trim()
    .min(8, 'UPC is required')
    .max(32, 'UPC is too long')
    .regex(/^[0-9A-Za-z-]+$/, 'UPC must use only letters, numbers, or hyphens')
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
  email: z.string().email('Valid email is required'),
  expose_token: z.boolean().optional()
});

const personalAccessTokenCreateSchema = z.object({
  name: z.string().min(1, 'Token name is required').max(255),
  scopes: z.array(z.enum(PERSONAL_ACCESS_TOKEN_SCOPES)).min(1, 'At least one scope is required'),
  expires_at: z.preprocess(
    emptyStringToNull,
    z.string().datetime({ offset: true }).optional().nullable()
  )
});

const serviceAccountKeyCreateSchema = z.object({
  name: z.string().min(1, 'Key name is required').max(255),
  scopes: z.array(z.enum(SERVICE_ACCOUNT_KEY_SCOPES)).min(1, 'At least one scope is required'),
  allowed_prefixes: z.array(z.enum(SERVICE_ACCOUNT_ALLOWED_PREFIXES)).min(1, 'At least one allowed prefix is required'),
  expires_at: z.preprocess(
    emptyStringToNull,
    z.string().datetime({ offset: true }).optional().nullable()
  )
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

const authScopeSelectSchema = z.object({
  space_id: z.number().int().positive('space_id must be a positive integer').optional(),
  library_id: z.number().int().positive('library_id must be a positive integer').optional()
}).refine(
  (data) => data.space_id || data.library_id,
  { message: 'space_id or library_id is required' }
);

const spaceBaseSchema = z.object({
  name: z.string().trim().min(1, 'Space name is required').max(255),
  slug: z.preprocess(emptyStringToNull, z.string().trim().min(1).max(255).regex(/^[a-z0-9-]+$/, 'slug must use lowercase letters, numbers, or hyphens').optional().nullable()),
  description: z.preprocess(emptyStringToNull, z.string().max(2000).optional().nullable())
});

const spaceCreateSchema = spaceBaseSchema.extend({
  owner_user_id: z.number().int().positive('owner_user_id must be a positive integer').optional()
});

const spaceUpdateSchema = spaceBaseSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one space field is required' }
);

const spaceMembershipCreateSchema = z.object({
  user_id: z.number().int().positive('user_id must be a positive integer'),
  role: z.enum(['owner', 'admin', 'member', 'viewer'])
});

const spaceMembershipUpdateSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer'])
});

const spaceInviteCreateSchema = z.object({
  email: z.string().email('Valid email is required'),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
  expose_token: z.boolean().optional()
});

const spaceTransferCreateSchema = z.object({
  name: z.string().trim().min(1, 'Space name is required').max(255),
  slug: z.preprocess(emptyStringToNull, z.string().trim().min(1).max(255).regex(/^[a-z0-9-]+$/, 'slug must use lowercase letters, numbers, or hyphens').optional().nullable()),
  description: z.preprocess(emptyStringToNull, z.string().max(2000).optional().nullable())
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

// ── Events ───────────────────────────────────────────────────────────────────

const eventArtifactTypes = ['session', 'person', 'autograph', 'purchase', 'freebie', 'note'];
const eventDateSchema = z.preprocess(
  emptyStringToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')
);
const optionalEventDateSchema = z.preprocess(
  emptyStringToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable()
);
const eventBaseObjectSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  url: z.string().url('Valid URL is required').max(2000),
  location: z.string().min(1, 'Location is required').max(255),
  date_start: eventDateSchema,
  date_end: optionalEventDateSchema,
  host: z.preprocess(emptyStringToNull, z.string().max(255).optional().nullable()),
  time_label: z.preprocess(emptyStringToNull, z.string().max(100).optional().nullable()),
  room: z.preprocess(emptyStringToNull, z.string().max(255).optional().nullable()),
  notes: z.preprocess(emptyStringToNull, z.string().max(5000).optional().nullable())
});

const eventCreateSchema = eventBaseObjectSchema.superRefine((data, ctx) => {
  if (data.date_end && data.date_start && data.date_end < data.date_start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['date_end'],
      message: 'date_end cannot be before date_start'
    });
  }
});

const eventUpdateSchema = eventBaseObjectSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one event field is required' }
).superRefine((data, ctx) => {
  if (data.date_start && data.date_end && data.date_end < data.date_start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['date_end'],
      message: 'date_end cannot be before date_start'
    });
  }
});

const eventArtifactBaseSchema = z.object({
  artifact_type: z.enum(eventArtifactTypes),
  title: z.string().min(1, 'Title is required').max(255),
  description: z.preprocess(emptyStringToNull, z.string().max(5000).optional().nullable()),
  image_path: z.preprocess(emptyStringToNull, z.string().max(2000).optional().nullable()),
  price: nullableNumberSchema(z.number().min(0).max(1000000)),
  vendor: z.preprocess(emptyStringToNull, z.string().max(255).optional().nullable())
});

const eventArtifactCreateSchema = eventArtifactBaseSchema;
const eventArtifactUpdateSchema = eventArtifactBaseSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one artifact field is required' }
);

// ── Collectibles ─────────────────────────────────────────────────────────────

const collectibleCategoryKeys = [
  'lego',
  'figures_statues',
  'props_replicas_originals',
  'funko',
  'comic_panels',
  'anime',
  'toys',
  'clothing'
];

const collectibleBaseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  subtype: z.enum(COLLECTIBLE_SUBTYPES).optional().nullable(),
  item_type: z.enum(COLLECTIBLE_SUBTYPES).optional().nullable(), // legacy alias
  category_key: z.preprocess(
    emptyStringToNull,
    z.enum(collectibleCategoryKeys).optional().nullable()
  ),
  category: z.preprocess(
    emptyStringToNull,
    z.string().max(100).optional().nullable()
  ),
  event_id: nullableNumberSchema(z.number().int().positive()),
  booth_or_vendor: z.preprocess(emptyStringToNull, z.string().max(255).optional().nullable()),
  price: nullableNumberSchema(z.number().min(0).max(1000000)),
  exclusive: z.boolean().optional().nullable(),
  image_path: z.preprocess(emptyStringToNull, z.string().max(2000).optional().nullable()),
  notes: z.preprocess(emptyStringToNull, z.string().max(5000).optional().nullable())
});

const collectibleCreateSchema = collectibleBaseSchema;
const collectibleUpdateSchema = collectibleBaseSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one collectible field is required' }
);

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
  simpleSearchSchema,
  titleAuthorSearchSchema,
  titleArtistSearchSchema,
  upcLookupSchema,
  mediaCreateSchema,
  mediaUpdateSchema,
  profileUpdateSchema,
  passwordResetConsumeSchema,
  roleUpdateSchema,
  inviteCreateSchema,
  personalAccessTokenCreateSchema,
  serviceAccountKeyCreateSchema,
  generalSettingsSchema,
  spaceCreateSchema,
  spaceUpdateSchema,
  spaceMembershipCreateSchema,
  spaceMembershipUpdateSchema,
  spaceInviteCreateSchema,
  spaceTransferCreateSchema,
  libraryCreateSchema,
  libraryUpdateSchema,
  librarySelectSchema,
  authScopeSelectSchema,
  libraryDeleteSchema,
  libraryTransferSchema,
  libraryArchiveSchema,
  eventCreateSchema,
  eventUpdateSchema,
  eventArtifactCreateSchema,
  eventArtifactUpdateSchema,
  collectibleCreateSchema,
  collectibleUpdateSchema
};
