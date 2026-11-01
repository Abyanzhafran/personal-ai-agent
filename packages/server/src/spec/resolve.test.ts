import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  makeFixtures,
  type FixtureRepo,
  type FixtureSet,
} from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter, type GitAdapter } from '../git/adapter.js';
import { PathNotFoundError, RefNotFoundError } from '../git/errors.js';
import { createCommandRunner } from '../proc/run-command.js';
import { SpecMissing, SpecParseError } from './errors.js';
import { resolveCommittedSpec } from './resolve.js';

const rawGit = (repo: string, ...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** Keadaan working tree dan HEAD; harus identik sebelum dan sesudah seluruh test. */
const snapshot = (repo: FixtureRepo) => ({
  status: rawGit(repo.path, 'status', '--porcelain=v1', '--ignored').trim(),
  head: rawGit(repo.path, 'rev-parse', 'HEAD').trim(),
});

let fixturesTmp: string;
let fixtures: FixtureSet;
let before: ReturnType<typeof snapshot>[];
const adapter = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

beforeAll(async () => {
  fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-resolve-'));
  fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
  before = Object.values(fixtures.repos).map(snapshot);
}, 120_000);

afterAll(async () => {
  try {
    expect(Object.values(fixtures.repos).map(snapshot)).toEqual(before);
  } finally {
    await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

/** Git palsu: `show` mengembalikan isi dari `files`, atau PathNotFoundError. */
function fakeGit(files: Record<string, string>) {
  const show = vi.fn<GitAdapter['show']>(async (_repo, sha, file) => {
    const text = files[file];
    if (text === undefined) throw new PathNotFoundError(sha, file);
    return text;
  });
  return { git: { show }, show };
}

const resolve = (files: Record<string, string>, specPath: string) =>
  resolveCommittedSpec(fakeGit(files).git, { repo: '/repo', sha: 'abc1234', specPath });

describe('resolveCommittedSpec: JSON dan YAML', () => {
  it('membaca spec JSON dari repo git sungguhan pada sha tertentu', async () => {
    const order = fixtures.repos['svc-order'];
    const sha = order.commits['initial'] as string;

    const result = await resolveCommittedSpec(adapter, {
      repo: order.path,
      sha,
      specPath: 'openapi.json',
    });

    expect(result).toEqual({
      document: JSON.parse(rawGit(order.path, 'show', `${sha}:openapi.json`)),
      source: 'committed',
      sha,
      path: 'openapi.json',
    });
    expect(result.document['openapi']).toBeDefined();
  });

  it('membaca spec YAML (.yaml dan .yml), termasuk anchor dan alias', async () => {
    const yaml = [
      'openapi: 3.0.3',
      'info: {title: Order, version: "1.0"}',
      'paths:',
      '  /orders:',
      '    get:',
      '      parameters:',
      '        - &page {name: page, in: query, required: false}',
      '        - *page',
      '      responses: {"200": {description: ok}}',
      '',
    ].join('\n');
    const page = { name: 'page', in: 'query', required: false };
    const expected = {
      openapi: '3.0.3',
      info: { title: 'Order', version: '1.0' },
      paths: {
        '/orders': {
          get: { parameters: [page, page], responses: { '200': { description: 'ok' } } },
        },
      },
    };

    for (const file of ['api/openapi.yaml', 'docs/swagger.yml']) {
      const result = await resolve({ [file]: yaml }, file);
      expect(result).toEqual({
        document: expected,
        source: 'committed',
        sha: 'abc1234',
        path: file,
      });
    }
  });

  it('berkas .yaml yang isinya JSON tetap terbaca; .json dengan BOM juga', async () => {
    const doc = { openapi: '3.0.3', paths: {} };
    expect((await resolve({ 'a.yaml': JSON.stringify(doc) }, 'a.yaml')).document).toEqual(doc);
    expect(
      (await resolve({ 'b.json': `\uFEFF${JSON.stringify(doc)}` }, 'b.json')).document,
    ).toEqual(doc);
    expect((await resolve({ 'C.JSON': JSON.stringify(doc) }, 'C.JSON')).document).toEqual(doc);
  });

  it('hanya memanggil show satu kali dengan repo, sha, dan path apa adanya', async () => {
    const { git, show } = fakeGit({ 'openapi.json': '{}' });
    await resolveCommittedSpec(git, { repo: '/r', sha: 'abc1234', specPath: 'openapi.json' });
    expect(show.mock.calls).toEqual([['/r', 'abc1234', 'openapi.json']]);
  });
});

describe('resolveCommittedSpec: galat bertipe', () => {
  it('spec_path tidak ada di ref → SpecMissing membawa sha dan path (repo sungguhan)', async () => {
    const order = fixtures.repos['svc-order'];
    const sha = order.commits['initial'] as string;

    const error = await resolveCommittedSpec(adapter, {
      repo: order.path,
      sha,
      specPath: 'docs/tidak-ada.yaml',
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpecMissing);
    expect(error).toMatchObject({ sha, path: 'docs/tidak-ada.yaml' });
    expect((error as Error).message).toContain(sha);
    expect((error as Error).message).toContain('docs/tidak-ada.yaml');
  });

  it('sha yang tidak dikenal bukan SpecMissing: galat git merambat', async () => {
    const order = fixtures.repos['svc-order'];
    await expect(
      resolveCommittedSpec(adapter, {
        repo: order.path,
        sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        specPath: 'openapi.json',
      }),
    ).rejects.toBeInstanceOf(RefNotFoundError);
  });

  it('dokumen rusak → SpecParseError satu baris, bukan SyntaxError atau YAMLParseError mentah', async () => {
    const broken: [string, string][] = [
      ['a.json', '{"openapi": "3.0.3", "paths": '],
      ['b.yaml', 'paths:\n  /orders:\n get: [\n'],
      ['c.yaml', 'openapi: 3.0.3\nopenapi: 3.1.0\n'],
      ['d.yaml', 'a: 1\n---\nb: 2\n'],
    ];
    for (const [file, text] of broken) {
      const error = await resolve({ [file]: text }, file).catch((e: unknown) => e);
      expect(error, file).toBeInstanceOf(SpecParseError);
      expect(error, file).toMatchObject({ sha: 'abc1234', path: file });
      const { problem } = error as SpecParseError;
      expect(problem.length, file).toBeGreaterThan(0);
      expect(problem, file).not.toContain('\n');
    }
  });

  it('sintaks valid tetapi akar bukan objek (kosong, teks, angka, array) → SpecParseError', async () => {
    const cases: [string, string][] = [
      ['kosong.yaml', ''],
      ['teks.yaml', 'bukan spec'],
      ['array.yaml', '- a\n- b\n'],
      ['null.json', 'null'],
      ['angka.json', '42'],
      ['array.json', '[]'],
    ];
    for (const [file, text] of cases) {
      const error = await resolve({ [file]: text }, file).catch((e: unknown) => e);
      expect(error, file).toBeInstanceOf(SpecParseError);
      expect((error as SpecParseError).problem, file).toBe('akar dokumen harus berupa objek');
    }
  });
});
