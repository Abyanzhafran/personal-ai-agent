interface PlaceholderScreenProps {
  /** Pola rute, mis. `/projects/$projectId`. Identifier teknis, bukan teks UI. */
  route: string;
  params?: Record<string, string>;
}

/**
 * Penanda sementara untuk layar yang belum dibangun (CC-070). Setiap layar sungguhan
 * (CC-076 dst.) menggantikannya dan seluruh teksnya lewat kamus i18n (CC-074).
 */
export function PlaceholderScreen({ route, params }: PlaceholderScreenProps) {
  return (
    <section data-testid="screen" data-route={route}>
      <pre>
        {route}
        {params ? ` ${JSON.stringify(params)}` : ''}
      </pre>
    </section>
  );
}
