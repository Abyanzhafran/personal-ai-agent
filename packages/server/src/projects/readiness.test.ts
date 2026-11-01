import type { Role } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import { projectReadiness } from './readiness.js';

const NEEDS_SERVICE = 'Tambahkan minimal satu repo service.';
const NEEDS_CONSUMER = 'Tambahkan satu repo service atau microfrontend lain.';
const E2E = ' Repo e2e tidak dihitung.';

describe('projectReadiness', () => {
  // Lima kombinasi dari AC CC-014, lalu kombinasi lain yang menjaga batas aturannya.
  const table: [string, Role[], string | null][] = [
    ['0 repo', [], NEEDS_SERVICE],
    ['1 service', ['service'], NEEDS_CONSUMER],
    ['1 service + 1 e2e', ['service', 'e2e'], NEEDS_CONSUMER + E2E],
    ['2 service', ['service', 'service'], null],
    ['1 service + 1 microfrontend', ['service', 'microfrontend'], null],
    ['1 microfrontend', ['microfrontend'], NEEDS_SERVICE],
    ['2 microfrontend', ['microfrontend', 'microfrontend'], NEEDS_SERVICE],
    ['hanya e2e', ['e2e', 'e2e'], NEEDS_SERVICE + E2E],
    ['1 microfrontend + 1 e2e', ['microfrontend', 'e2e'], NEEDS_SERVICE + E2E],
    ['service + microfrontend + e2e', ['service', 'microfrontend', 'e2e'], null],
    ['urutan tidak berpengaruh', ['microfrontend', 'e2e', 'service'], null],
  ];

  it.each(table)('%s', (_label, roles, reason) => {
    expect(projectReadiness(roles)).toEqual({
      ready_for_check: reason === null,
      not_ready_reason: reason,
    });
  });

  it('alasan berupa kalimat untuk user, bukan kode', () => {
    for (const [, roles, reason] of table) {
      if (reason === null) continue;
      const { not_ready_reason } = projectReadiness(roles);
      expect(not_ready_reason).toMatch(/^[A-Z][^_]*\.$/);
    }
  });
});
