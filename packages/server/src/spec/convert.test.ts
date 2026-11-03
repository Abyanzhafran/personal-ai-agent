import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeFixtures, type FixtureSet } from '../../../../fixtures/make-fixtures.js';
import { createGitAdapter } from '../git/adapter.js';
import { createCommandRunner } from '../proc/run-command.js';
import { toOpenApi3 } from './convert.js';
import { SpecConvertError } from './errors.js';
import { resolveCommittedSpec } from './resolve.js';

let fixturesTmp: string;
let fixtures: FixtureSet;
const adapter = createGitAdapter(createCommandRunner({ oasdiffBin: 'oasdiff' }));

beforeAll(async () => {
  fixturesTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-spec-convert-'));
  fixtures = await makeFixtures(path.join(fixturesTmp, 'fixtures'));
}, 120_000);

afterAll(async () => {
  await fs.rm(fixturesTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const committed = (name: 'svc-payment' | 'svc-order', specPath: string) => {
  const repo = fixtures.repos[name];
  return resolveCommittedSpec(adapter, {
    repo: repo.path,
    sha: repo.commits['initial'] as string,
    specPath,
  });
};

describe('toOpenApi3', () => {
  it('Swagger 2 fixture (docs/swagger.json) menjadi OpenAPI 3 dengan isi yang sama', async () => {
    const spec = await committed('svc-payment', 'docs/swagger.json');
    const before = structuredClone(spec.document);

    const converted = await toOpenApi3(spec);

    expect(converted.document.swagger).toBeUndefined();
    expect(converted.document.openapi).toMatch(/^3\./);
    expect(converted.document.servers).toEqual([{ url: 'http://localhost:8081/api/v1' }]);
    expect(Object.keys(converted.document.paths as object)).toEqual(
      Object.keys(before.paths as object),
    );
    expect(converted.document.components).toHaveProperty(['schemas', 'handlers.Payment']);
    expect(converted).toMatchObject({ sha: spec.sha, path: spec.path, source: spec.source });
    // Masukan (yang bisa berasal dari cache) tidak diubah.
    expect(spec.document).toEqual(before);
  });

  it('dokumen OpenAPI 3 dilewatkan apa adanya', async () => {
    const spec = await committed('svc-order', 'openapi.json');

    expect(spec.document.openapi).toMatch(/^3\./);
    expect(await toOpenApi3(spec)).toBe(spec);
  });

  it('konversi gagal melempar SpecConvertError yang menyebut sha, path, dan alasan', async () => {
    const spec = {
      document: { swagger: '2.0', paths: 'bukan objek' },
      sha: 'abc1234',
      path: 's.json',
    };

    const error = await toOpenApi3(spec).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpecConvertError);
    expect(error).toMatchObject({ sha: 'abc1234', path: 's.json' });
    expect((error as SpecConvertError).problem).not.toBe('');
    expect((error as SpecConvertError).problem).not.toContain('\n');
    expect((error as SpecConvertError).message).toContain('s.json');
  });
});
