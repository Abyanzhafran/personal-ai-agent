import { useSuspenseQuery } from '@tanstack/react-query';

import { listOrders, type Params } from '../api/orders';

export function useOrders(filters: Params) {
  return useSuspenseQuery({
    queryKey: ['orders', filters],
    queryFn: () => listOrders(filters),
  });
}
