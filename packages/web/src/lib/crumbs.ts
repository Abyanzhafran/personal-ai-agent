import { useMatches } from '@tanstack/react-router';
import type { MessageKey } from './i18n';

/** Tujuan yang boleh menjadi tautan breadcrumb sekaligus tujuan nav rail. */
export type CrumbTo = '/' | '/checks';

export interface Crumb {
  label: MessageKey;
  vars?: Record<string, string | undefined>;
  /** Tautan ke induk; kosong untuk halaman saat ini (crumb terakhir). */
  to?: CrumbTo;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /**
     * Jejak breadcrumb rute ini. Crumb pertama wajib bertautan: dialah tujuan nav rail yang aktif.
     * Rute tanpa `crumbs` (mis. `/panduan`) tidak punya breadcrumb dan tidak menandai nav rail.
     */
    crumbs?: (params: Record<string, string | undefined>) => [Crumb & { to: CrumbTo }, ...Crumb[]];
  }
}

/** Jejak rute yang sedang tampil, dibaca dari `staticData.crumbs` rute daun. */
export function useCrumbs(): Crumb[] {
  const leaf = useMatches().at(-1);
  return leaf?.staticData.crumbs?.(leaf.params) ?? [];
}
