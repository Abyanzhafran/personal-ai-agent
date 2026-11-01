import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * `useMutation` yang, sesudah berhasil, menginvalidasi query yang kuncinya diawali salah satu
 * `invalidates` (`['projects']` mencakup daftar dan detail). Mutasi baru selesai setelah query
 * aktif yang terkena selesai dimuat ulang. Galat sudah ditangani `createQueryClient` (toast).
 */
export function useApiMutation<TData, TVars = void>({
  mutationFn,
  invalidates,
}: {
  mutationFn: (vars: TVars) => Promise<TData>;
  invalidates: readonly QueryKey[];
}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all(invalidates.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}
