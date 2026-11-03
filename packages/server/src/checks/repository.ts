import {
  CheckSummary,
  type Check,
  type Confidence,
  type Kind,
  type Severity,
  type Snippet,
} from '@cc/shared';
import type { Db } from '../db/database.js';

const COLUMNS =
  'id, project_id, provider_repo_id, base_ref, head_ref, base_sha, head_sha, status, started_at, finished_at, error';

export interface NewCheck {
  projectId: number;
  providerRepoId: number;
  baseRef: string;
  headRef: string;
  /** ISO-8601 UTC. */
  startedAt: string;
}

/** Satu baris `findings`. `endpoint` = `'METHOD path'`, atau `'spec'` untuk finding tingkat provider. */
export interface NewFinding {
  endpoint: string;
  /** `null`, `file`, `line`, dan `confidence` kosong untuk finding tingkat provider (`spec_stale`). */
  consumerRepoId: number | null;
  file: string | null;
  line: number | null;
  kind: Kind;
  severity: Severity;
  detail: string;
  confidence: Confidence | null;
  viaSymbol: string | null;
  snippet: Snippet | null;
}

export interface CheckResult {
  findings: readonly NewFinding[];
  /** Semuanya dari pemanggil kecuali `counts`, yang dihitung dari `findings`. */
  summary: Omit<CheckSummary, 'counts'>;
  /** ISO-8601 UTC. */
  finishedAt: string;
}

export function createCheckRepository(db: Db) {
  const insertFinding = db.prepare(
    `INSERT INTO findings (check_id, endpoint, consumer_repo_id, file, line, kind, severity,
       detail, confidence, via_symbol, snippet_json)
     VALUES (@checkId, @endpoint, @consumerRepoId, @file, @line, @kind, @severity,
       @detail, @confidence, @viaSymbol, @snippetJson)`,
  );
  const finish = db.prepare(
    `UPDATE checks SET status = @status, summary_json = @summaryJson, finished_at = @finishedAt
     WHERE id = @id`,
  );

  const save = db.transaction((checkId: number, result: CheckResult): void => {
    const counts: Record<Severity, number> = { break: 0, warn: 0, info: 0 };
    for (const finding of result.findings) counts[finding.severity]++;
    const summary = CheckSummary.parse({ ...result.summary, counts });

    for (const { snippet, ...row } of result.findings) {
      insertFinding.run({
        checkId,
        ...row,
        snippetJson: snippet === null ? null : JSON.stringify(snippet),
      });
    }
    finish.run({
      id: checkId,
      status: result.findings.length === 0 ? 'clean' : 'findings',
      summaryJson: JSON.stringify(summary),
      finishedAt: result.finishedAt,
    });
  });

  const insertCheck = db.prepare(
    `INSERT INTO checks (project_id, provider_repo_id, base_ref, head_ref, started_at)
     VALUES (@projectId, @providerRepoId, @baseRef, @headRef, @startedAt)`,
  );
  const selectCheck = db.prepare(`SELECT ${COLUMNS} FROM checks WHERE id = ?`);
  const updateShas = db.prepare('UPDATE checks SET base_sha = ?, head_sha = ? WHERE id = ?');
  const endWith = db.prepare(
    'UPDATE checks SET status = @status, error = @error, finished_at = @finishedAt WHERE id = @id',
  );

  const selectRunning = db.prepare(
    `SELECT ${COLUMNS} FROM checks WHERE status = 'running' ORDER BY id`,
  );

  function get(id: number): Check | undefined {
    return selectCheck.get(id) as Check | undefined;
  }

  return {
    get,

    /** Check yang masih `running` di DB; saat start berarti prosesnya sudah mati (CC-063). */
    listRunning: (): Check[] => selectRunning.all() as Check[],

    /** Baris baru berstatus `running`. */
    create(input: NewCheck): Check {
      const { lastInsertRowid } = insertCheck.run(input);
      return get(Number(lastInsertRowid)) as Check;
    },

    /** Hasil langkah 1; ditulis segera supaya check yang gagal sesudahnya tetap menyimpan SHA-nya. */
    setShas(id: number, baseSha: string, headSha: string): void {
      updateShas.run(baseSha, headSha, id);
    },

    /** Status `failed` dengan alasan satu pesan; tanpa finding. */
    fail(id: number, error: string, finishedAt: string): void {
      endWith.run({ id, status: 'failed', error, finishedAt });
    },

    /** Status `cancelled`; tanpa finding parsial. */
    cancel(id: number, finishedAt: string): void {
      endWith.run({ id, status: 'cancelled', error: null, finishedAt });
    },

    /**
     * Menulis semua finding, `summary_json`, status akhir (`clean` bila tanpa finding, selain itu
     * `findings`), dan `finished_at` dalam satu transaksi: gagal di tengah = tidak ada yang tertulis.
     */
    saveResult(checkId: number, result: CheckResult): void {
      save(checkId, result);
    },
  };
}
