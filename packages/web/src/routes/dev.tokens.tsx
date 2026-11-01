import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { COLOR_TOKEN_GROUPS, FONT_TOKENS, RADIUS_TOKENS, TEXT_TOKENS } from '../design/tokens';

export const Route = createFileRoute('/dev/tokens')({
  component: TokensPage,
});

/** Nilai terhitung sebuah variabel CSS di :root; kosong bila CSS belum diterapkan (mis. di jsdom). */
function useCssVar(name: string): string {
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  }, [name]);
  return value;
}

// Halaman alat bantu pengembang untuk memeriksa token dengan mata. Bukan layar produk, jadi
// teksnya sengaja tidak lewat kamus i18n (aturan #6 berlaku untuk layar produk).
function TokensPage() {
  return (
    <section data-testid="tokens-page" className="flex flex-col gap-8 p-8">
      <h1 className="text-headline font-normal">Token desain</h1>

      {COLOR_TOKEN_GROUPS.map(({ group, tokens }) => (
        <div key={group} className="flex flex-col gap-3">
          <h2 className="text-title font-medium">{group}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {tokens.map((token) => (
              <ColorSwatch key={token} token={token} />
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <h2 className="text-title font-medium">Radius</h2>
        <div className="flex flex-wrap gap-4">
          {RADIUS_TOKENS.map((token) => (
            <RadiusSample key={token} token={token} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-title font-medium">Font</h2>
        {FONT_TOKENS.map((token) => (
          <p
            key={token}
            data-token={`font-${token}`}
            style={{ fontFamily: `var(--font-${token})` }}
            className="text-body"
          >
            --font-{token}: Contract Check 0123456789 GET /orders/{'{id}'}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-title font-medium">Skala teks</h2>
        {TEXT_TOKENS.map((token) => (
          <p
            key={token}
            data-token={`text-${token}`}
            style={{
              fontSize: `var(--text-${token})`,
              lineHeight: `var(--text-${token}--line-height)`,
            }}
          >
            --text-{token}: Merge feature/xyz akan merusak consumer
          </p>
        ))}
      </div>
    </section>
  );
}

function ColorSwatch({ token }: { token: string }) {
  const value = useCssVar(`--color-${token}`);
  return (
    <div
      data-token={`color-${token}`}
      className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-lowest p-2"
    >
      <span
        className="h-10 w-10 shrink-0 rounded-sm border border-outline-variant"
        style={{ backgroundColor: `var(--color-${token})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-label font-medium">{token}</span>
        <span className="font-mono text-code text-on-surface-variant">{value}</span>
      </span>
    </div>
  );
}

function RadiusSample({ token }: { token: string }) {
  const value = useCssVar(`--radius-${token}`);
  return (
    <div data-token={`radius-${token}`} className="flex flex-col items-center gap-2">
      <span
        className="h-16 w-24 border border-outline bg-secondary-container"
        style={{ borderRadius: `var(--radius-${token})` }}
      />
      <span className="text-label">
        {token} <span className="font-mono text-on-surface-variant">{value}</span>
      </span>
    </div>
  );
}
