const { z } = require('zod');

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

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];
const MEDIA_TYPES = ['movie', 'tv_series', 'tv_episode', 'other'];
const nullableDateSchema = z.preprocess(
  emptyStringToNull,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').optional().nullable()
);
const nullableUrlSchema = z.preprocess(
  emptyStringToNull,
  z.string().url().optional().nullable()
);

const mediaCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  media_type: z.enum(MEDIA_TYPES).optional().nullable(),
  original_title: z.string().max(500).optional().nullable(),
  release_date: nullableDateSchema,
  year: z.number().int().min(1888).max(2100).optional().nullable(),
  format: z.enum(MEDIA_FORMATS).optional().nullable(),
  genre: z.string().max(100).optional().nullable(),
  director: z.string().max(255).optional().nullable(),
  rating: z.number().min(0).max(10).optional().nullable(),
  user_rating: z.number().min(0).max(5).optional().nullable(),
  runtime: z.number().int().min(1).max(9999).optional().nullable(),
  upc: z.string().max(50).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  overview: z.string().max(10000).optional().nullable(),
  tmdb_id: z.number().int().positive().optional().nullable(),
  tmdb_media_type: z.enum(['movie', 'tv']).optional().nullable(),
  tmdb_url: nullableUrlSchema,
  trailer_url: nullableUrlSchema,
  poster_path: z.string().max(1000).optional().nullable(),
  backdrop_path: z.string().max(1000).optional().nullable(),
  season_number: z.number().int().min(0).max(200).optional().nullable(),
  episode_number: z.number().int().min(0).max(5000).optional().nullable(),
  episode_title: z.string().max(500).optional().nullable(),
  network: z.string().max(255).optional().nullable(),
  library_id: z.number().int().positive().optional().nullable(),
  space_id: z.number().int().positive().optional().nullable()
});

// Patch only requires at least one valid field — same shape, all optional
const mediaUpdateSchema = mediaCreateSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field is required for update' }
);

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
