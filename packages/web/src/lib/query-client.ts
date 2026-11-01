import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { reportError } from './api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // `onError` jalan sekali per kegagalan akhir, bukan per percobaan ulang.
    queryCache: new QueryCache({ onError: reportError }),
    mutationCache: new MutationCache({ onError: reportError }),
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false },
    },
  });
}
