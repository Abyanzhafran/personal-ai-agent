import { ERROR_CODES, type FieldIssue, type ValidationDetails } from '@cc/shared';
import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { HttpError } from './errors.js';

export interface RequestSchemas {
  readonly body?: z.ZodType;
  readonly query?: z.ZodType;
  readonly params?: z.ZodType;
}

type Output<S extends z.ZodType | undefined> = S extends z.ZodType ? z.output<S> : undefined;

export interface ValidatedInput<S extends RequestSchemas> {
  readonly body: Output<S['body']>;
  readonly query: Output<S['query']>;
  readonly params: Output<S['params']>;
}

function issuesOf(location: FieldIssue['in'], error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    in: location,
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Memvalidasi bagian request dengan skema zod dari `@cc/shared`. Semua bagian diperiksa sekaligus
 * supaya klien menerima daftar lengkap isian yang salah, bukan satu per satu.
 * `req.query` di Express 5 hanya-baca, jadi hasil parse dikembalikan, tidak ditulis balik.
 */
export function parseRequest<S extends RequestSchemas>(
  req: Request,
  schemas: S,
): ValidatedInput<S> {
  const fields: FieldIssue[] = [];
  const out: Record<string, unknown> = {};

  for (const location of ['body', 'query', 'params'] as const) {
    const schema = schemas[location];
    if (!schema) continue;
    const result = schema.safeParse(req[location]);
    if (result.success) out[location] = result.data;
    else fields.push(...issuesOf(location, result.error));
  }

  if (fields.length > 0) {
    const details: ValidationDetails = { fields };
    throw new HttpError(400, ERROR_CODES.validation_failed, 'Permintaan tidak valid', details);
  }
  return out as unknown as ValidatedInput<S>;
}

/**
 * Pembungkus handler: validasi dulu, handler hanya menerima input bertipe.
 * Galat (termasuk dari promise yang ditolak) diteruskan Express 5 ke error handler.
 */
export function validated<S extends RequestSchemas>(
  schemas: S,
  handler: (input: ValidatedInput<S>, req: Request, res: Response) => void | Promise<void>,
): RequestHandler {
  return async (req, res) => {
    await handler(parseRequest(req, schemas), req, res);
  };
}
