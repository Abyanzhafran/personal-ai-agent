import { ApiErrorEnvelope, ValidationDetails } from '@cc/shared';
import { toast } from 'sonner';
import { t } from './i18n';

/** Bagian skema zod yang dipakai di sini, supaya web tidak perlu menambah `zod` sebagai dependensi. */
interface Schema<T> {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** Galat dari server (amplop `{error}`) atau dari jalur ke server (`network_error`, `unexpected_response`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Respons sukses yang bentuknya tidak sesuai skema `shared`. Pesannya untuk developer, bukan untuk toast. */
export class ResponseShapeError extends Error {
  constructor(method: string, path: string, issues: { path: PropertyKey[]; message: string }[]) {
    const detail = issues
      .map((issue) => `${issue.path.map(String).join('.') || '(akar)'}: ${issue.message}`)
      .join('; ');
    super(`Respons ${method} ${path} tidak sesuai skema: ${detail}`);
    this.name = 'ResponseShapeError';
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/**
 * Satu-satunya pintu `fetch` dari web. `path` lengkap (`/api/projects`). Respons dibaca lewat
 * `schema`; respons kosong (204) lolos bila skemanya menerima `undefined`.
 */
export async function apiFetch<T>(
  path: string,
  schema: Schema<T>,
  { method = 'GET', body }: Options = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', t('api.network'));
  }

  const data: unknown = await res.json().catch(() => undefined);

  if (!res.ok) {
    const envelope = ApiErrorEnvelope.safeParse(data);
    if (!envelope.success) {
      throw new ApiError(res.status, 'unexpected_response', t('api.unexpected'));
    }
    const { code, message, details } = envelope.data.error;
    throw new ApiError(res.status, code, message, details);
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ResponseShapeError(method, path, parsed.error.issues);
  return parsed.data;
}

/** Pesan server untuk satu isian body (`path`); undefined bila galat ini tidak menunjuk isian itu. */
export function fieldError(error: unknown, path: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const details = ValidationDetails.safeParse(error.details);
  return details.success ? details.data.fields.find((f) => f.path === path)?.message : undefined;
}

/**
 * Galat menjadi toast. Galat yang menunjuk isian form (`details.fields`) dilewati: layar
 * menampilkannya di isian itu.
 */
export function reportError(error: unknown): void {
  if (error instanceof ApiError && ValidationDetails.safeParse(error.details).success) return;
  toast.error(error instanceof ApiError ? error.message : t('api.unexpected'));
}
