import Anthropic from '@anthropic-ai/sdk';
import os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConfigError, parseConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createLlmClient, LlmSchemaError, type LlmPrompt } from './client.js';

const SECRET = 'RAHASIA_KODE_REPO';
const schema = z.object({ role: z.enum(['service', 'microfrontend']), count: z.number() });
const valid = { role: 'service', count: 3 };
const prompt: LlmPrompt = {
  version: 'pv-abc123',
  system: `Klasifikasikan repo. ${SECRET}`,
  user: `isi berkas: ${SECRET}`,
};

const JSON_HEADERS = { 'content-type': 'application/json' };
const reply = (text: string) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'model-uji',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 7 },
    }),
    { status: 200, headers: JSON_HEADERS },
  );
const rateLimited = () =>
  new Response(
    JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'pelan-pelan' } }),
    { status: 429, headers: { ...JSON_HEADERS, 'retry-after-ms': '30' } },
  );

const fetchMock = vi.fn<typeof fetch>();
let logs: Record<string, unknown>[] = [];

function client(env: Record<string, string> = { ANTHROPIC_API_KEY: 'kunci-uji' }) {
  const config = parseConfig({ ANTHROPIC_MODEL: 'model-uji', ...env }, { homedir: os.homedir() });
  const logger = createLogger({
    level: 'debug',
    destination: {
      write: (line: string) => void logs.push(JSON.parse(line) as Record<string, unknown>),
    },
  });
  return createLlmClient({ config, logger, fetch: fetchMock });
}

interface SentBody {
  model: string;
  system: string;
  messages: { role: string; content: string }[];
}
const sent = (call: number) =>
  JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)) as SentBody;

beforeEach(() => {
  fetchMock.mockReset();
  logs = [];
});

describe('callJson', () => {
  it('mengembalikan data yang lolos skema; model dan instruksi JSON ikut terkirim', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(valid))));
    await expect(client().callJson({ prompt, schema })).resolves.toEqual(valid);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sent(0);
    expect(body.model).toBe('model-uji');
    expect(body.system).toContain(prompt.system);
    expect(body.system).toContain('valid JSON');
    expect(body.messages).toEqual([{ role: 'user', content: prompt.user }]);
  });

  it('JSON yang dibungkus code fence diterima tanpa perbaikan', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(reply('```json\n' + JSON.stringify(valid) + '\n```')),
    );
    await expect(client().callJson({ prompt, schema })).resolves.toEqual(valid);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('429 dan 5xx', () => {
    it('429 lalu sukses: tepat satu retry, hasil benar, event loop tetap bebas selama backoff', async () => {
      fetchMock
        .mockResolvedValueOnce(rateLimited())
        .mockResolvedValueOnce(reply(JSON.stringify(valid)));

      let ticks = 0;
      const timer = setInterval(() => ticks++, 5);
      const result = await client().callJson({ prompt, schema });
      clearInterval(timer);

      expect(result).toEqual(valid);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(ticks).toBeGreaterThan(0);
    });

    it('5xx juga dicoba ulang', async () => {
      const overloaded = new Response(
        JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'sibuk' } }),
        { status: 529, headers: { ...JSON_HEADERS, 'retry-after-ms': '10' } },
      );
      fetchMock
        .mockResolvedValueOnce(overloaded)
        .mockResolvedValueOnce(reply(JSON.stringify(valid)));
      await expect(client().callJson({ prompt, schema })).resolves.toEqual(valid);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('JSON tidak valid', () => {
    it('satu percobaan perbaikan: masalah dikirim balik, lalu berhasil', async () => {
      fetchMock
        .mockResolvedValueOnce(reply('bukan json'))
        .mockResolvedValueOnce(reply(JSON.stringify(valid)));

      await expect(client().callJson({ prompt, schema })).resolves.toEqual(valid);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const repair = sent(1).messages;
      expect(repair.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(repair[1]?.content).toBe('bukan json');
      expect(repair[2]?.content).toContain('not valid JSON');
    });

    it('JSON valid tetapi salah bentuk diperlakukan sama, masalah menyebut isian yang salah', async () => {
      fetchMock
        .mockResolvedValueOnce(reply(JSON.stringify({ role: 'e2e', count: 'tiga' })))
        .mockResolvedValueOnce(reply(JSON.stringify(valid)));

      await expect(client().callJson({ prompt, schema })).resolves.toEqual(valid);

      const rejection = sent(1).messages[2]?.content ?? '';
      expect(rejection).toContain('role:');
      expect(rejection).toContain('count:');
    });

    it('gagal lagi setelah perbaikan: LlmSchemaError, hanya dua panggilan', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(reply(`bukan json ${SECRET}`)));

      const error = await client()
        .callJson({ prompt, schema })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(LlmSchemaError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((error as LlmSchemaError).message).not.toContain(SECRET);
    });

    it('respons kosong tidak membuat permintaan perbaikan ditolak API', async () => {
      fetchMock
        .mockResolvedValueOnce(reply(''))
        .mockResolvedValueOnce(reply(JSON.stringify(valid)));
      await expect(client().callJson({ prompt, schema })).resolves.toEqual(valid);
      expect(sent(1).messages[1]?.content).not.toBe('');
    });
  });

  it('signal yang di-abort membatalkan request yang sedang jalan', async () => {
    let fetchSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          fetchSignal = init?.signal;
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('dibatalkan', 'AbortError')),
          );
        }),
    );
    const controller = new AbortController();

    const pending = client().callJson({ prompt, schema, signal: controller.signal });
    const outcome = pending.catch((e: unknown) => e);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();

    expect(await outcome).toBeInstanceOf(Anthropic.APIUserAbortError);
    expect(fetchSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // tidak dicoba ulang
  });

  describe('log', () => {
    it('mencatat model, versi prompt, dan jumlah token', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(reply(JSON.stringify(valid))));
      await client().callJson({ prompt, schema });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        model: 'model-uji',
        promptVersion: 'pv-abc123',
        attempt: 1,
        inputTokens: 12,
        outputTokens: 7,
      });
    });

    it('tidak ada isi prompt atau respons di log, juga di jalur perbaikan dan gagal', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(reply(`bukan json ${SECRET}`)));
      await client()
        .callJson({ prompt, schema })
        .catch(() => undefined);

      expect(logs).toHaveLength(2); // satu per panggilan
      expect(JSON.stringify(logs)).not.toContain(SECRET);
    });
  });

  it('API key divalidasi saat panggilan pertama: tanpa key, galat konfigurasi dan tanpa jaringan', async () => {
    await expect(client({}).callJson({ prompt, schema })).rejects.toBeInstanceOf(ConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
