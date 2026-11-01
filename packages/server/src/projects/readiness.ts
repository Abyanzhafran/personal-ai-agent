import type { ProjectDetail, Role } from '@cc/shared';

type Readiness = Pick<ProjectDetail, 'ready_for_check' | 'not_ready_reason'>;

const NEEDS_SERVICE = 'Tambahkan minimal satu repo service.';
const NEEDS_CONSUMER = 'Tambahkan satu repo service atau microfrontend lain.';
/** Tanpa catatan ini, user yang baru menambah repo e2e tidak tahu kenapa tombolnya masih mati. */
const E2E_NOT_COUNTED = ' Repo e2e tidak dihitung.';

/**
 * Siap check bila ada minimal satu repo service dan minimal satu repo service atau microfrontend
 * lain (CC-014). Repo e2e disimpan tetapi tidak pernah ikut check, jadi tidak dihitung.
 */
export function projectReadiness(roles: readonly Role[]): Readiness {
  const services = roles.filter((role) => role === 'service').length;
  const checkable = services + roles.filter((role) => role === 'microfrontend').length;
  if (services >= 1 && checkable >= 2) return { ready_for_check: true, not_ready_reason: null };

  const reason = services === 0 ? NEEDS_SERVICE : NEEDS_CONSUMER;
  return {
    ready_for_check: false,
    not_ready_reason: roles.includes('e2e') ? `${reason}${E2E_NOT_COUNTED}` : reason,
  };
}
