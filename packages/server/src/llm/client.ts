import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { requireAnthropicApiKey, type Config } from '../config.js';
import type { Logger } from '../logger.js';

// Konstanta, bukan config.ts (pola adapter.ts). Retry 429/5xx memakai bawaan SDK: backoff
// bertingkat yang menghormati `retry-after`, lewat timer sehingga event loop tetap bebas.
const MAX_TOKENS = 16_000;
const JSON_ONLY =
  'Respond with a single valid JSON value and nothing else: no prose, no markdown code fences.';

/** `version` dihitung pemanggil (hash isi berkas prompt, D-4); di sini hanya dicatat di log. */
export interface LlmPrompt {
  readonly version: string;
  readonly system: string;
  readonly user: string;
}

export interface CallJsonInput<S extends z.ZodType> {
  readonly prompt: LlmPrompt;
  readonly schema: S;
  readonly signal?: AbortSignal;
}

/**
 * Respons masih bukan JSON yang sesuai skema setelah satu perbaikan. Hanya memuat masalahnya
 * (path + pesan skema), tidak pernah isi respons: bisa berisi kode repo.
 */
export class LlmSchemaError extends Error {
  constructor(readonly problem: string) {
    super(`Respons Claude tidak sesuai skema setelah satu perbaikan: ${problem}`);
    this.name = 'LlmSchemaError';
  }
}

type Parsed<T> = { ok: true; data: T } | { ok: false; problem: string };

/** Model kadang tetap membungkus JSON dengan code fence walau diminta jangan. */
const unfence = (text: string) =>
  text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');

function parse<S extends z.ZodType>(text: string, schema: S): Parsed<z.output<S>> {
  let json: unknown;
  try {
    json = JSON.parse(unfence(text));
  } catch {
    return { ok: false, problem: 'the reply is not valid JSON' };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  const problem = result.error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  return { ok: false, problem };
}

interface Deps {
  readonly config: Config;
  readonly logger: Logger;
  /** Untuk test: SDK memanggil ini sebagai ganti `fetch` global. */
  readonly fetch?: typeof fetch;
}

export function createLlmClient({ config, logger, fetch }: Deps) {
  let sdk: Anthropic | undefined;
  // Kunci divalidasi saat panggilan pertama, bukan saat start (D-4).
  const anthropic = () =>
    (sdk ??= new Anthropic({ apiKey: requireAnthropicApiKey(config), fetch }));

  async function send(
    prompt: LlmPrompt,
    messages: Anthropic.MessageParam[],
    attempt: number,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const started = Date.now();
    const response = await anthropic().messages.create(
      {
        model: config.anthropicModel,
        max_tokens: MAX_TOKENS,
        system: `${prompt.system}\n\n${JSON_ONLY}`,
        messages,
      },
      { signal },
    );
    // Hanya metadata. Isi prompt dan respons bisa memuat kode repo, jangan dicatat (aturan kerja).
    logger.info(
      {
        model: config.anthropicModel,
        promptVersion: prompt.version,
        attempt,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        ms: Date.now() - started,
      },
      'Panggilan Claude selesai',
    );
    return response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
  }

  /**
   * Memanggil Claude dan mengembalikan JSON yang sudah lolos `schema`. Respons yang gagal
   * di-parse atau divalidasi diperbaiki satu kali (masalahnya dikirim balik); gagal lagi
   * → `LlmSchemaError`. Galat API (SDK) dan abort `signal` merambat apa adanya.
   */
  async function callJson<S extends z.ZodType>({
    prompt,
    schema,
    signal,
  }: CallJsonInput<S>): Promise<z.output<S>> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt.user }];
    for (let attempt = 1; ; attempt++) {
      const text = await send(prompt, messages, attempt, signal);
      const result = parse(text, schema);
      if (result.ok) return result.data;
      if (attempt === 2) throw new LlmSchemaError(result.problem);
      messages.push(
        // Blok teks kosong ditolak API.
        { role: 'assistant', content: text || '(empty reply)' },
        {
          role: 'user',
          content: `Your previous reply was rejected: ${result.problem}. Reply again with only the corrected JSON.`,
        },
      );
    }
  }

  return { callJson };
}

export type LlmClient = ReturnType<typeof createLlmClient>;
