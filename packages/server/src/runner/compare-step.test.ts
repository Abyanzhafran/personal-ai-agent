import { describe, expect, it, vi } from 'vitest';
import type { Repo } from '@cc/shared';
import type { ChangedEndpoint } from '../diff/endpoints.js';
import type { ApiCall } from '../llm/extraction.prompt.js';
import { compareCalls } from './compare-step.js';
import type { ExtractedFile } from './consumers-step.js';

const repo = { id: 7, name: 'mfe', local_path: '/r/mfe' } as Repo;

const endpoint: ChangedEndpoint = {
  method: 'GET',
  path: '/orders',
  normalized_path: '/orders',
  operationId: 'listOrders',
  changes: [],
  max_level: 'break',
};

const call = (path: string): ApiCall => ({
  method: 'GET',
  path,
  file: 'src/a.ts',
  line: 3,
  query_params: [],
  body_fields: [],
  response_fields_read: [],
  confidence: 'high',
  wrapper_symbols: [],
});

const file = (calls: ApiCall[]): ExtractedFile => ({
  repo,
  sha: 'a'.repeat(40),
  path: 'src/a.ts',
  baseUrlPattern: null,
  calls,
});

describe('compareCalls', () => {
  it('pemakaian yang path-nya tidak bisa dinormalisasi dilewati dan dicatat di log (D-43)', async () => {
    const logger = { info: vi.fn() };
    const git = { show: vi.fn() };

    const result = await compareCalls(
      { git, logger },
      {
        files: [file([call('${BASE_URL}')])],
        endpoints: [endpoint],
        specs: { base: {}, head: {} },
      },
    );

    expect(result).toEqual({ findings: [], matchedFields: {} });
    expect(logger.info).toHaveBeenCalledWith(
      { repo: 'mfe', file: 'src/a.ts', path: '${BASE_URL}' },
      'pemakaian dilewati: path tidak bisa dinormalisasi',
    );
    expect(git.show).not.toHaveBeenCalled();
  });
});
