/** Request and response shapes.
 *
 *  Defined once with Zod so the same definitions can be reused by the app's
 *  API client, which is the reason the library was chosen over Fastify's own
 *  JSON schema support.
 *
 *  Nothing that reaches a table is trusted before passing through here. The
 *  derived attributes of a trail are the clearest case: they are absent from
 *  every input shape on purpose, because the server recomputes them.
 */
import { z } from 'zod';

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const levelSchema = z.enum(LEVELS);

export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  ele: z.number().min(-500).max(9000).optional(),
  time: z.iso.datetime({ offset: true }).optional(),
});

// ------------------------------------------------------------------ auth --

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  // The policy is checked in the route, which can report every failing rule
  // at once instead of only the first one Zod happens to reach.
  password: z.string().min(1).max(200),
  level: levelSchema,
});

export const sessionSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

/**
 * The code that confirms an address.
 *
 * Exactly six digits, so a code with a stray space or a letter in it is
 * refused here and never costs the account one of its five attempts.
 */
export const verifyCodeSchema = z.object({
  email: z.email().max(254),
  code: z.string().trim().regex(/^[0-9]{6}$/),
});

export const resendCodeSchema = z.object({
  email: z.email().max(254),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(500),
});

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    level: levelSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.level !== undefined, {
    message: 'nothing to update',
  });

// ---------------------------------------------------------------- trails --

export const trailSubmissionSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  // A track shorter than two points has no geometry to derive anything from.
  points: z.array(pointSchema).min(2).max(50_000),
});

/** Delta cursor. Absent on a first synchronisation, which returns everything. */
export const deltaQuerySchema = z.object({
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// --------------------------------------------------------------- reports --

export const reportSchema = z.object({
  // Generated on the device. This identifier is what makes the upload
  // idempotent, so a retry after a failed response cannot duplicate a row.
  id: z.uuid(),
  trailId: z.uuid(),
  kind: z.string().trim().min(1).max(30),
  comment: z.string().trim().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  createdAt: z.iso.datetime({ offset: true }),
});

/**
 * Reports travel in batches, because a hike produces several at once.
 *
 * Only the envelope is validated here. Each report is then checked on its
 * own, so one malformed row is answered as a rejection of that row instead
 * of a refusal of the batch. The device keeps an unsent report queued until
 * the server names it, and a batch-wide refusal left an unsendable report
 * blocking every later synchronisation, the catalogue included.
 */
export const reportBatchSchema = z.object({
  reports: z.array(z.unknown()).min(1).max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type SessionInput = z.infer<typeof sessionSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
export type ResendCodeInput = z.infer<typeof resendCodeSchema>;
export type TrailSubmissionInput = z.infer<typeof trailSubmissionSchema>;
export type ReportInput = z.infer<typeof reportSchema>;
export type DeltaQuery = z.infer<typeof deltaQuerySchema>;
