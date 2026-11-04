import {
  CheckSummary,
  Snippet,
  type Check,
  type CheckDetail,
  type CheckList,
  type CheckListItem,
  type Confidence,
  type Finding,
  type Kind,
  type Severity,
} from '@cc/shared';
import type { Db } from '../db/database.js';

const COLUMNS =
  'id, project_id, provider_repo_id, base_ref, head_ref, base_sha, head_sha, status, started_at, finished_at, error';

/** Kolom `checks` berawalan `c.` plus nama project dan provider, untuk daftar dan detail. */
const NAMED_COLUMNS = `${COLUMNS.split(', ')
  .map((column) => `c.${column}`)
  .join(', ')}, p.name AS project_name, r.name AS provider_repo_name`;
const NAMED_FROM = `FROM checks c
  JOIN projects p ON p.id = c.project_id
  JOIN repos r ON r.id = c.provider_repo_id`;

type NamedRow = Check & { project_name: string; provider_repo_name: string };
type ListRow = NamedRow & { counts_json: string | null; spec_stale: 0 | 1 };
type DetailRow = NamedRow & { summary_json: string | null };
type FindingRow = Omit<Finding, 'snippet'> & { snippet_json: string | null };

export interface ListChecksInput {
  /** Kosong = semua project. */
  projectId?: number | undefined;
  limit: number;
  offset: number;
}

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

  const selectPage = db.prepare(
    `SELECT ${NAMED_COLUMNS},
       json_extract(c.summary_json, '$.counts') AS counts_json,
       EXISTS (SELECT 1 FROM findings f WHERE f.check_id = c.id AND f.kind = 'spec_stale') AS spec_stale
     ${NAMED_FROM}
     WHERE (@projectId IS NULL OR c.project_id = @projectId)
     ORDER BY c.started_at DESC, c.id DESC
     LIMIT @limit OFFSET @offset`,
  );
  const countMatching = db.prepare(
    'SELECT COUNT(*) AS total FROM checks WHERE (@projectId IS NULL OR project_id = @projectId)',
  );
  // LEFT JOIN: project tanpa check tetap muncul dengan hitungan 0.
  const countPerProject = db.prepare(
    `SELECT p.id AS project_id, p.name, COUNT(c.id) AS count
     FROM projects p LEFT JOIN checks c ON c.project_id = p.id
     GROUP BY p.id ORDER BY p.name COLLATE NOCASE, p.id`,
  );
  const selectDetail = db.prepare(
    `SELECT ${NAMED_COLUMNS}, c.summary_json ${NAMED_FROM} WHERE c.id = ?`,
  );
  const selectFindings = db.prepare(
    `SELECT f.id, f.endpoint, r.name AS consumer_repo, f.file, f.line, f.kind, f.severity, f.detail,
       f.confidence, f.via_symbol, f.snippet_json
     FROM findings f LEFT JOIN repos r ON r.id = f.consumer_repo_id
     WHERE f.check_id = ? ORDER BY f.id`,
  );

  function get(id: number): Check | undefined {
    return selectCheck.get(id) as Check | undefined;
  }

  return {
    get,

    /** Satu halaman riwayat, terbaru dulu; `total` = semua baris yang cocok filter. */
    list({ projectId, limit, offset }: ListChecksInput): { items: CheckListItem[]; total: number } {
      const filter = { projectId: projectId ?? null };
      const rows = selectPage.all({ ...filter, limit, offset }) as ListRow[];
      const { total } = countMatching.get(filter) as { total: number };
      const items = rows.map(({ counts_json, spec_stale, ...row }) => ({
        ...row,
        counts:
          counts_json === null ? null : CheckSummary.shape.counts.parse(JSON.parse(counts_json)),
        spec_stale: spec_stale === 1,
      }));
      return { items, total };
    },

    /** Jumlah check per project (semua project) untuk chip filter. */
    countByProject(): CheckList['counts'] {
      const byProject = countPerProject.all() as CheckList['counts']['by_project'];
      return { total: byProject.reduce((sum, { count }) => sum + count, 0), by_project: byProject };
    },

    /** Check + finding (urut penyimpanan) + `summary_json`; `undefined` bila id tidak ada. */
    detail(id: number): CheckDetail | undefined {
      const row = selectDetail.get(id) as DetailRow | undefined;
      if (!row) return undefined;
      const { project_name, provider_repo_name, summary_json, ...check } = row;
      const findings = (selectFindings.all(id) as FindingRow[]).map(
        ({ snippet_json, ...finding }) => ({
          ...finding,
          snippet: snippet_json === null ? null : Snippet.parse(JSON.parse(snippet_json)),
        }),
      );
      return {
        check,
        project_name,
        provider_repo_name,
        findings,
        summary: summary_json === null ? null : CheckSummary.parse(JSON.parse(summary_json)),
      };
    },

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
