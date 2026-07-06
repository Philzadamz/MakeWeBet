import { z } from 'zod';

export const CursorPaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuery>;

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Money is always integer minor units (kobo). Never floats. */
export const MoneyMinor = z.number().int().nonnegative();

export const ApiErrorShape = z.object({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiErrorShape = z.infer<typeof ApiErrorShape>;
