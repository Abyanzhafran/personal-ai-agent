import { CheckSummary } from '@cc/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { createCheckRepository, type CheckResult, type NewFinding } from './repository.js';

let db: Db;
let checkId: number;
let consumerId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  const projectId = Number(
    db.prepare("INSERT INTO projects (name, slug) VALUES ('Order', 'order')").run().lastInsertRowid,
  );
  const insertRepo = db.prepare(
    `INSERT INTO repos (project_id, role, name, local_path, default_branch)
     VALUES (?, ?, ?, ?, 'main')`,
  );
  const providerId = Number(
    insertRepo.run(projectId, 'service', 'svc-order', '/r/svc').lastInsertRowid,
  );
  consumerId = Number(insertRepo.run(projectId, 'microfrontend', 'mfe', '/r/mfe').lastInsertRowid);
  checkId = Number(
    db
      .prepare(
        `INSERT INTO checks (project_id, provider_repo_id, base_ref, head_ref, started_at)
         VALUES (?, ?, 'main', 'feature/xyz', '2026-11-03T00:00:00.000Z')`,
      )
      .run(projectId, providerId).lastInsertRowid,
  );
});
afterEach(() => {
  db.close();
});

const finding = (extra: Partial<NewFinding> = {}): NewFinding => ({
  endpoint: 'GET /orders',
  consumerRepoId: consumerId,
  file: 'src/orders.ts',
  line: 12,
  kind: 'removed',
  severity: 'break',
  detail: 'Parameter page_size dihapus',
  confidence: 'high',
  viaSymbol: null,
  snippet: null,
  ...extra,
});
const result = (extra: Partial<CheckResult> = {}): CheckResult => ({
  findings: [],
  summary: {
    files_checked: 3,
    files_via_hop2: 1,
    endpoints_without_consumer: [],
    consumer_shas: { mfe: 'a'.repeat(40) },
    matched_fields: {},
    incomplete: false,
    skipped_files: 0,
    tool_versions: { oasdiff: '1.11.0' },
    spec_unpinned: false,
    fetch_errors: [],
  },
  finishedAt: '2026-11-03T00:01:00.000Z',
  ...extra,
});

const save = (r: CheckResult) => createCheckRepository(db).saveResult(checkId, r);
const checkRow = () =>
  db.prepare('SELECT status, finished_at, summary_json FROM checks WHERE id = ?').get(checkId) as {
    status: string;
    finished_at: string | null;
    summary_json: string | null;
  };
const findingRows = () => db.prepare('SELECT * FROM findings WHERE check_id = ?').all(checkId);

describe('saveResult', () => {
  it('menulis finding, summary_json, status findings, dan finished_at', () => {
    const snippet = { lines: [{ n: 12, text: 'fetch(url)' }], highlight: 12, tokens: ['url'] };
    save(
      result({
        findings: [
          finding({ snippet, viaSymbol: 'useOrders', confidence: 'medium' }),
          finding({ severity: 'warn', kind: 'type_changed' }),
          finding({ severity: 'warn', kind: 'param_mismatch' }),
        ],
      }),
    );

    expect(checkRow()).toMatchObject({
      status: 'findings',
      finished_at: '2026-11-03T00:01:00.000Z',
    });
    const summary = CheckSummary.parse(JSON.parse(checkRow().summary_json as string));
    expect(summary.counts).toEqual({ break: 1, warn: 2, info: 0 });
    expect(summary).toMatchObject({ files_checked: 3, tool_versions: { oasdiff: '1.11.0' } });

    const rows = findingRows() as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      endpoint: 'GET /orders',
      consumer_repo_id: consumerId,
      file: 'src/orders.ts',
      line: 12,
      kind: 'removed',
      severity: 'break',
      detail: 'Parameter page_size dihapus',
      confidence: 'medium',
      via_symbol: 'useOrders',
    });
    expect(JSON.parse(rows[0]?.['snippet_json'] as string)).toEqual(snippet);
    expect(rows[1]?.['snippet_json']).toBeNull();
  });

  it('tanpa finding → status clean, counts nol; endpoint tanpa consumer tetap tercatat', () => {
    const base = result();
    save({
      ...base,
      summary: { ...base.summary, endpoints_without_consumer: ['GET /orders/{id}/cancel'] },
    });

    expect(checkRow().status).toBe('clean');
    expect(findingRows()).toHaveLength(0);
    expect(JSON.parse(checkRow().summary_json as string)).toMatchObject({
      counts: { break: 0, warn: 0, info: 0 },
      endpoints_without_consumer: ['GET /orders/{id}/cancel'],
    });
  });

  it('finding tingkat provider (spec_stale) tanpa consumer, file, line, confidence', () => {
    save(
      result({
        findings: [
          finding({
            endpoint: 'spec',
            consumerRepoId: null,
            file: null,
            line: null,
            kind: 'spec_stale',
            severity: 'warn',
            confidence: null,
          }),
        ],
      }),
    );

    expect(checkRow().status).toBe('findings');
    expect(findingRows()).toEqual([
      expect.objectContaining({
        endpoint: 'spec',
        kind: 'spec_stale',
        consumer_repo_id: null,
        file: null,
        line: null,
        confidence: null,
      }),
    ]);
  });

  it.each<[string, Partial<CheckResult>]>([
    ['summary tidak sesuai skema', { summary: { ...result().summary, files_checked: -1 } }],
    [
      'finding menunjuk consumer yang tidak ada',
      { findings: [finding(), finding({ consumerRepoId: 9999 })] },
    ],
  ])('%s → tidak ada yang tertulis, check tetap running', (_name, extra) => {
    expect(() => save(result(extra))).toThrow();

    expect(findingRows()).toHaveLength(0);
    expect(checkRow()).toEqual({ status: 'running', finished_at: null, summary_json: null });
  });
});
