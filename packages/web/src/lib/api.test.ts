import { HealthResponse } from '@cc/shared';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ResponseShapeError, apiFetch, reportError } from './api';
import { createQueryClient } from './query-client';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = (code: string, message: string, details: unknown = null) => ({
  error: { code, message, details },
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('apiFetch', () => {
  it('mengembalikan data yang sudah diparse skema', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, app: 'Contract Check', ekstra: 1 }));
    await expect(apiFetch('/api/health', HealthResponse)).resolves.toEqual({
      ok: true,
      app: 'Contract Check',
    });
  });

  it('respons yang tidak sesuai skema melempar galat yang menyebut metode, path, dan isian', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: false, app: 7 }));
    const error = await apiFetch('/api/health', HealthResponse).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResponseShapeError);
    const { message } = error as ResponseShapeError;
    expect(message).toContain('GET /api/health');
    expect(message).toContain('ok:');
    expect(message).toContain('app:');
  });

  it('badan bukan JSON pada respons sukses juga galat jelas, bukan undefined', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(apiFetch('/api/health', HealthResponse)).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it('204 lolos bila skema menerima undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      apiFetch('/api/projects/1', HealthResponse.optional(), { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('body dikirim sebagai JSON; tanpa body tidak ada content-type', async () => {
    // Badan Response hanya bisa dibaca sekali: buat yang baru tiap panggilan.
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, { ok: true, app: 'x' })));
    await apiFetch('/api/p', HealthResponse, { method: 'POST', body: { name: 'A' } });
    await apiFetch('/api/p', HealthResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/p', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"A"}',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/p', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
  });

  it('amplop galat server menjadi ApiError dengan status, kode, pesan, dan details', async () => {
    const details = { slug: 'order' };
    fetchMock.mockResolvedValue(
      reply(409, envelope('project_slug_taken', 'Slug sudah dipakai', details)),
    );
    const error = await apiFetch('/api/projects', HealthResponse).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'project_slug_taken',
      message: 'Slug sudah dipakai',
      details,
    });
  });

  it('galat tanpa amplop (mis. 502 dari proxy) menjadi unexpected_response', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(apiFetch('/api/health', HealthResponse)).rejects.toMatchObject({
      status: 502,
      code: 'unexpected_response',
    });
  });

  it('server tidak terjangkau menjadi network_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/health', HealthResponse)).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });
});

describe('reportError', () => {
  it('pesan amplop galat tampil sebagai toast', () => {
    reportError(new ApiError(404, 'project_not_found', 'Project tidak ditemukan'));
    expect(toast.error).toHaveBeenCalledWith('Project tidak ditemukan');
  });

  it('galat yang menunjuk isian form tidak jadi toast', () => {
    const details = { fields: [{ in: 'body', path: 'name', message: 'Wajib diisi' }] };
    reportError(new ApiError(400, 'validation_failed', 'Isian salah', details));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('galat selain ApiError tampil sebagai pesan umum, bukan teks mentahnya', () => {
    reportError(new ResponseShapeError('GET', '/api/x', [{ path: ['a'], message: 'salah' }]));
    expect(toast.error).toHaveBeenCalledWith('Server mengirim respons yang tidak terduga.');
  });
});

describe('createQueryClient', () => {
  it('query yang gagal menghasilkan satu toast walau dicoba ulang', async () => {
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
    const queryFn = vi.fn().mockRejectedValue(new ApiError(500, 'internal_error', 'Galat server'));
    await client.fetchQuery({ queryKey: ['x'], queryFn, retry: 1, retryDelay: 0 }).catch(() => {});
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Galat server');
  });
});
