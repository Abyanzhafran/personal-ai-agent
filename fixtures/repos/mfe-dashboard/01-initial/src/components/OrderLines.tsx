import type { OrderDetail } from '../api/orders';

interface RowProps {
  qty: number;
}

function Row({ qty }: RowProps) {
  return <li>{qty}</li>;
}

interface Props {
  items: OrderDetail['items'];
}

export function OrderLines({ items }: Props) {
  return (
    items.map((line) => (
      <Row key={line.id} qty={line.quantity} />
    ))
  );
}
