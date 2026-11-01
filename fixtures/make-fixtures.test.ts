import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MARKER_FILE,
  makeFixtures,
  type FixtureRepo,
  type FixtureRepoName,
  type FixtureSet,
} from './make-fixtures.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const REPO_NAMES: FixtureRepoName[] = ['svc-order', 'mfe-dashboard', 'svc-payment', 'e2e-suite'];

const git = (repo: FixtureRepo, ...args: string[]): string =>
  execFileSync('git', ['-C', repo.path, ...args], { encoding: 'utf8' }).trim();

const show = (repo: FixtureRepo, rev: string, file: string): string =>
  execFileSync('git', ['-C', repo.path, 'show', `${rev}:${file}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const showJson = (repo: FixtureRepo, rev: string, file: string): unknown =>
  JSON.parse(show(repo, rev, file));

function get(value: unknown, ...keys: (string | number)[]): unknown {
  return keys.reduce<unknown>(
    (current, key) => (current as Record<string | number, unknown> | undefined)?.[key],
    value,
  );
}

const paramNames = (spec: unknown, route: string, method: string): string[] =>
  (get(spec, 'paths', route, method, 'parameters') as { name: string }[]).map((p) => p.name);

const schemaProps = (spec: unknown, name: string): Record<string, { type?: string }> =>
  get(spec, 'components', 'schemas', name, 'properties') as Record<string, { type?: string }>;

const schemaRequired = (spec: unknown, name: string): string[] =>
  get(spec, 'components', 'schemas', name, 'required') as string[];

/** Berkas yang cocok dengan `git grep -l` di origin/main; kosong bila tidak ada. */
function grepFiles(repo: FixtureRepo, ...args: string[]): string[] {
  try {
    return git(repo, 'grep', '-l', ...args, 'origin/main')
      .split('\n')
      .map((line) => line.replace(/^origin\/main:/, ''))
      .sort();
  } catch {
    return [];
  }
}

const commitsOf = (set: FixtureSet) =>
  Object.fromEntries(REPO_NAMES.map((name) => [name, set.repos[name].commits]));

let tmp: string;
let set: FixtureSet;
let order: FixtureRepo;
let mfe: FixtureRepo;
let payment: FixtureRepo;
let e2e: FixtureRepo;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-fixtures-test-'));
  set = await makeFixtures(path.join(tmp, 'a'));
  ({
    'svc-order': order,
    'mfe-dashboard': mfe,
    'svc-payment': payment,
    'e2e-suite': e2e,
  } = set.repos);
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('bentuk repo', () => {
  it('tiap repo adalah repo git bersih dengan origin bare dan origin/HEAD ke main', () => {
    for (const name of REPO_NAMES) {
      const repo = set.repos[name];
      expect(git(repo, 'rev-parse', '--is-inside-work-tree')).toBe('true');
      expect(git(repo, 'status', '--porcelain')).toBe('');
      expect(git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).toBe('origin/main');
      expect(path.resolve(git(repo, 'remote', 'get-url', 'origin'))).toBe(
        path.resolve(repo.remote),
      );
      expect(
        execFileSync('git', ['-C', repo.remote, 'rev-parse', '--is-bare-repository'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe('true');
    }
  });

  it('svc-order: feature/xyz hanya ada sebagai origin/feature/xyz, merge-base bukan ujung main', () => {
    expect(git(order, 'branch', '--format=%(refname:short)')).toBe('main');
    expect(git(order, 'rev-parse', 'origin/feature/xyz')).toBe(order.commits['feature-xyz']);
    expect(git(order, 'rev-parse', 'origin/main')).toBe(order.commits['readme']);
    const base = git(order, 'merge-base', 'origin/main', 'origin/feature/xyz');
    expect(base).toBe(order.commits['initial']);
    expect(base).not.toBe(git(order, 'rev-parse', 'origin/main'));
  });

  it('peran dan jalur spec: satu provider dengan spec_cmd, satu dengan spec ter-commit saja', () => {
    expect(REPO_NAMES.map((name) => set.repos[name].role)).toEqual([
      'service',
      'microfrontend',
      'service',
      'e2e',
    ]);
    expect(order.specCmd).toBe('node scripts/export-openapi.mjs');
    expect(order.specPath).toBe('openapi.json');
    expect(payment.specCmd).toBeUndefined();
    expect(payment.specPath).toBe('docs/swagger.json');
    expect(git(payment, 'ls-tree', '-r', '--name-only', 'origin/main')).not.toContain('scripts/');
    expect(get(showJson(payment, 'origin/main', 'docs/swagger.json'), 'swagger')).toBe('2.0');
  });
});

describe('kasus perubahan kontrak svc-order (main -> feature/xyz)', () => {
  let base: unknown;
  let head: unknown;

  beforeAll(() => {
    base = showJson(order, order.commits['initial']!, 'openapi.json');
    head = showJson(order, 'origin/feature/xyz', 'openapi.json');
  });

  it('page_size dihapus (diganti limit opsional)', () => {
    expect(paramNames(base, '/orders', 'get')).toContain('page_size');
    expect(paramNames(head, '/orders', 'get')).not.toContain('page_size');
    expect(paramNames(head, '/orders', 'get')).toContain('limit');
  });

  it('field response total dihapus', () => {
    expect(schemaProps(base, 'OrderList')).toHaveProperty('total');
    expect(schemaRequired(base, 'OrderList')).toContain('total');
    expect(schemaProps(head, 'OrderList')).not.toHaveProperty('total');
  });

  it('currency jadi required', () => {
    expect(schemaProps(base, 'CreateOrderRequest')).toHaveProperty('currency');
    expect(schemaRequired(base, 'CreateOrderRequest')).not.toContain('currency');
    expect(schemaRequired(head, 'CreateOrderRequest')).toContain('currency');
  });

  it('note tidak ada di spec mana pun', () => {
    expect(JSON.stringify(base)).not.toContain('"note"');
    expect(JSON.stringify(head)).not.toContain('"note"');
  });

  it('grand_total number -> string, quantity integer -> number', () => {
    expect(schemaProps(base, 'OrderDetail')['grand_total']?.type).toBe('number');
    expect(schemaProps(head, 'OrderDetail')['grand_total']?.type).toBe('string');
    expect(schemaProps(base, 'OrderLine')['quantity']?.type).toBe('integer');
    expect(schemaProps(head, 'OrderLine')['quantity']?.type).toBe('number');
  });

  it('POST /orders/{order_id}/cancel dihapus dan tidak ada operasi lain yang hilang', () => {
    const operations = (spec: unknown) =>
      Object.values(get(spec, 'paths') as Record<string, Record<string, { operationId: string }>>)
        .flatMap((methods) => Object.values(methods).map((op) => op.operationId))
        .sort();
    expect(get(base, 'paths', '/orders/{order_id}/cancel', 'post', 'operationId')).toBe(
      'cancelOrder',
    );
    expect(get(head, 'paths', '/orders/{order_id}/cancel')).toBeUndefined();
    expect(operations(head)).toEqual(operations(base).filter((id) => id !== 'cancelOrder'));
  });

  it('spec_cmd menghasilkan spec yang sama secara semantik tetapi beda format dari yang di-commit', () => {
    const work = fs.mkdtempSync(path.join(tmp, 'spec-cmd-'));
    fs.mkdirSync(path.join(work, 'scripts'));
    fs.writeFileSync(
      path.join(work, 'scripts', 'export-openapi.mjs'),
      show(order, 'origin/feature/xyz', 'scripts/export-openapi.mjs'),
    );
    execFileSync(process.execPath, ['scripts/export-openapi.mjs'], { cwd: work });

    const generated = fs.readFileSync(path.join(work, 'openapi.json'), 'utf8');
    const committed = show(order, 'origin/feature/xyz', 'openapi.json');
    expect(generated).not.toBe(committed);
    expect(JSON.parse(generated)).toEqual(JSON.parse(committed));
  });
});

describe('bentuk pencarian consumer', () => {
  it('hop 1 (git grep -F orders) menemukan empat berkas mfe-dashboard dan satu berkas svc-payment', () => {
    expect(grepFiles(mfe, '-F', '-e', 'orders')).toEqual([
      'src/api/orders.ts',
      'src/components/OrderLines.tsx',
      'src/components/OrderSummary.tsx',
      'src/hooks/useOrders.ts',
    ]);
    expect(grepFiles(payment, '-F', '-e', 'orders')).toEqual(['internal/clients/order_client.go']);
  });

  it('OrdersPage.tsx hanya ditemukan lewat simbol useOrders (hop 2)', () => {
    const hop1 = grepFiles(mfe, '-F', '-e', 'orders');
    const viaSymbol = grepFiles(mfe, '-w', 'useOrders').filter((file) => !hop1.includes(file));
    expect(viaSymbol).toEqual(['src/pages/OrdersPage.tsx']);
  });

  it('e2e-suite memuat /orders (jadi grep ke sana akan terlihat) dan consumer tidak memuat cancel', () => {
    expect(grepFiles(e2e, '-F', '-e', '/orders')).toEqual(['tests/orders.spec.ts']);
    expect(grepFiles(mfe, '-i', '-F', '-e', 'cancel')).toEqual([]);
    expect(grepFiles(payment, '-i', '-F', '-e', 'cancel')).toEqual([]);
  });

  it.each([
    ['mfe-dashboard', 'src/api/orders.ts', 42, 'page_size'],
    ['mfe-dashboard', 'src/pages/OrdersPage.tsx', 88, 'data.total'],
    ['svc-payment', 'internal/clients/order_client.go', 63, 'CreateOrderReq'],
    ['svc-payment', 'internal/clients/order_client.go', 66, 'Note'],
    ['mfe-dashboard', 'src/components/OrderSummary.tsx', 31, 'order.grand_total'],
    ['mfe-dashboard', 'src/components/OrderLines.tsx', 18, 'line.quantity'],
  ] as const)('%s %s baris %i memuat %s (jangkar laporan #128)', (name, file, line, text) => {
    const lines = show(set.repos[name], 'origin/main', file).split('\n');
    expect(lines[line - 1]).toContain(text);
  });
});

describe('SHA stabil', () => {
  it('dua jalan di folder berbeda (satu dengan spasi) menghasilkan SHA identik', async () => {
    const other = await makeFixtures(path.join(tmp, 'folder dengan spasi'));
    expect(commitsOf(other)).toEqual(commitsOf(set));
  });

  it('menjalankan ulang di folder yang sama membuat ulang dengan SHA identik', async () => {
    const root = path.join(tmp, 'ulang');
    const first = await makeFixtures(root);
    const second = await makeFixtures(root);
    expect(commitsOf(second)).toEqual(commitsOf(first));
    expect(commitsOf(second)).toEqual(commitsOf(set));
  });

  it('tidak terpengaruh GIT_* atau identitas dari lingkungan pemanggil', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      GIT_DIR: path.join(tmp, 'tidak-ada'),
      GIT_WORK_TREE: PROJECT_ROOT,
      GIT_AUTHOR_NAME: 'Orang Lain',
      GIT_AUTHOR_DATE: '2001-01-01T00:00:00+00:00',
      GIT_COMMITTER_EMAIL: 'lain@example.com',
    });
    try {
      const other = await makeFixtures(path.join(tmp, 'lingkungan'));
      expect(commitsOf(other)).toEqual(commitsOf(set));
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});

describe('pengaman folder keluaran', () => {
  it('menulis penanda di folder buatan generator', () => {
    expect(fs.existsSync(path.join(set.root, MARKER_FILE))).toBe(true);
  });

  it('menolak folder di dalam repo Contract Check dan tidak membuat apa pun', async () => {
    const inside = path.join(PROJECT_ROOT, 'fixtures-tidak-boleh-ada');
    await expect(makeFixtures(inside)).rejects.toThrow(/repo Contract Check/);
    expect(fs.existsSync(inside)).toBe(false);
  });

  it('menolak folder tidak kosong tanpa penanda dan tidak menghapus isinya', async () => {
    const dir = path.join(tmp, 'milik-orang');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'penting.txt'), 'jangan hapus');
    await expect(makeFixtures(dir)).rejects.toThrow(/tidak dihapus/);
    expect(fs.readFileSync(path.join(dir, 'penting.txt'), 'utf8')).toBe('jangan hapus');
  });
});
