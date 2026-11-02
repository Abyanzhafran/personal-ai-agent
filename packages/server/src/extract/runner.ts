import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LlmClient } from '../llm/client.js';
import {
  buildExtractionPrompt,
  EXTRACTION_PROMPT_VERSION,
  ExtractionOutput,
  type ExtractionInput,
} from '../llm/extraction.prompt.js';
import { mapLimit } from '../util/concurrency.js';
import type { WorkspaceStore } from '../workspace/store.js';

/** Isi satu berkas cache: keluaran model plus keterangan pemotongan (D-39). */
const Extraction = ExtractionOutput.extend({
  truncated: z.boolean(),
  total_lines: z.number().int().nonnegative(),
  sent_lines: z.number().int().nonnegative(),
});
export type Extraction = z.infer<typeof Extraction>;

export interface ExtractionFile {
  readonly repoId: number;
  readonly path: string;
  readonly blob_sha: string;
  /** Profil discovery yang disetujui untuk repo itu. */
  readonly profile: string;
}

export type FileExtraction = Pick<ExtractionFile, 'repoId' | 'path' | 'blob_sha'> &
  (
    | { readonly status: 'ok'; readonly source: 'cache' | 'llm'; readonly extraction: Extraction }
    | { readonly status: 'failed'; readonly error: string }
    /** Jatah `maxCalls` habis sebelum berkas ini sempat dipanggil. */
    | { readonly status: 'skipped'; readonly reason: 'budget' }
  );

export interface ExtractionRunnerDeps {
  readonly llm: Pick<LlmClient, 'callJson'>;
  readonly workspace: WorkspaceStore;
  /** `ANTHROPIC_MODEL`; ikut kunci cache. */
  readonly model: string;
  /** `LLM_CONCURRENCY` */
  readonly concurrency: number;
  /** `MAX_LLM_CALLS_PER_CHECK` */
  readonly maxCalls: number;
}

export interface ExtractionRunInput {
  readonly checkId: number;
  readonly files: readonly ExtractionFile[];
  readonly endpoints: ExtractionInput['endpoints'];
  /** Isi berkas dari `git show`; hanya dipanggil bila cache miss. */
  readonly readContent: (file: ExtractionFile) => Promise<string>;
  readonly signal?: AbortSignal;
  /** Dipanggil begitu satu berkas selesai, untuk event log (`extract <path> (cache)`). */
  readonly onFile?: (result: FileExtraction) => void;
}

/**
 * Bagian `<pv>` nama berkas cache: prompt atau model berubah = nama lain = cache lama tidak
 * terbaca. Hex 12 karakter, jadi aman sebagai nama berkas (D-6) walau nama model memuat `:` atau `/`.
 */
export function extractionCacheVersion(
  model: string,
  promptVersion: string = EXTRACTION_PROMPT_VERSION,
): string {
  return createHash('sha256').update(`${promptVersion}\n${model}`).digest('hex').slice(0, 12);
}

/**
 * Hasil di-cache per `(repo, blob, prompt+model)`; path tidak ikut kunci karena isi yang sama
 * menghasilkan keluaran yang sama. Karena itu `file` di tiap panggilan selalu ditimpa path berkas
 * yang diminta, bukan yang tertulis saat hasil dibuat.
 */
function atPath(extraction: Extraction, path: string): Extraction {
  return { ...extraction, calls: extraction.calls.map((call) => ({ ...call, file: path })) };
}

export function createExtractionRunner(deps: ExtractionRunnerDeps) {
  const { llm, workspace, concurrency, maxCalls } = deps;
  const { layout } = workspace;
  const cacheVersion = extractionCacheVersion(deps.model);

  /**
   * Mengekstrak semua berkas; tidak melempar karena satu berkas gagal (ditandai `failed`).
   * Satu-satunya yang dilempar: `signal` dibatalkan. Hasil mengikuti urutan `files`.
   */
  async function run(input: ExtractionRunInput): Promise<FileExtraction[]> {
    const { signal } = input;
    // Dihitung sinkron tanpa `await` di antara cek dan tambah, jadi tidak ada balapan antar berkas.
    let calls = 0;

    async function extract(file: ExtractionFile): Promise<FileExtraction> {
      const id = { repoId: file.repoId, path: file.path, blob_sha: file.blob_sha };
      try {
        signal?.throwIfAborted();
        const cacheFile = layout.extractCacheFile(file.repoId, file.blob_sha, cacheVersion);

        let source: 'cache' | 'llm' = 'cache';
        let extraction = await workspace.readCache(cacheFile, (data) => Extraction.parse(data));
        if (extraction) {
          extraction = atPath(extraction, file.path);
        } else {
          if (calls >= maxCalls) return { ...id, status: 'skipped', reason: 'budget' };
          calls++;
          const built = buildExtractionPrompt({
            path: file.path,
            content: await input.readContent(file),
            profile: file.profile,
            endpoints: input.endpoints,
          });
          const output = await llm.callJson({
            prompt: built.prompt,
            schema: ExtractionOutput,
            signal,
          });
          source = 'llm';
          extraction = atPath(
            {
              calls: output.calls,
              truncated: built.truncated,
              total_lines: built.total_lines,
              sent_lines: built.sent_lines,
            },
            file.path,
          );
          await workspace.writeCache(cacheFile, extraction);
        }

        const pathHash = createHash('sha256').update(file.path).digest('hex').slice(0, 12);
        await workspace.writeJson(
          layout.checkExtractFile(input.checkId, `${file.repoId}-${pathHash}.json`),
          { repo_id: file.repoId, path: file.path, blob_sha: file.blob_sha, source, ...extraction },
        );
        return { ...id, status: 'ok', source, extraction };
      } catch (err) {
        return { ...id, status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    }

    const results = await mapLimit(input.files, concurrency, async (file) => {
      const result = await extract(file);
      if (!signal?.aborted) input.onFile?.(result);
      return result;
    });
    signal?.throwIfAborted();
    return results;
  }

  return { run };
}

export type ExtractionRunner = ReturnType<typeof createExtractionRunner>;
