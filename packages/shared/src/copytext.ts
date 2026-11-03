import type { CheckSummary } from './checks.js';
import { SEVERITIES, type Confidence, type Kind, type Severity } from './domain.js';

/** Satu baris `findings`; `location` kosong untuk finding tingkat provider (`spec_stale`). */
export interface CopyTextFinding {
  endpoint: string;
  location: { repo: string; file: string; line: number } | null;
  kind: Kind;
  severity: Severity;
  detail: string;
  confidence: Confidence | null;
  via_symbol: string | null;
}

/** Bahan teks "Salin ringkasan" (CC-050): satu check yang sudah selesai. */
export interface CopyTextInput {
  id: number;
  provider: string;
  base_ref: string;
  head_ref: string;
  /** merge-base(base_ref, head_sha). */
  base_sha: string;
  head_sha: string;
  summary: CheckSummary;
  findings: readonly CopyTextFinding[];
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'tinggi',
  medium: 'sedang',
  low: 'rendah',
};

const NO_CONSUMER_NOTE =
  'Tidak ketemu bukan berarti aman: pemanggil dinamis, consumer di luar project, atau komunikasi async tidak terlihat oleh tool ini.';

const short = (sha: string) => sha.slice(0, 7);
const rank = (severity: Severity) => SEVERITIES.indexOf(severity);

/** Perbandingan string biasa (bukan locale) supaya urutan sama di semua mesin. */
function compare(a: string | number, b: string | number): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function compareFindings(a: CopyTextFinding, b: CopyTextFinding): number {
  return (
    rank(a.severity) - rank(b.severity) ||
    compare(a.location?.repo ?? '', b.location?.repo ?? '') ||
    compare(a.location?.file ?? '', b.location?.file ?? '') ||
    compare(a.location?.line ?? 0, b.location?.line ?? 0)
  );
}

function findingLines(finding: CopyTextFinding): string[] {
  const { location, confidence, via_symbol: viaSymbol } = finding;
  const notes = [
    viaSymbol === null ? null : `via hop 2: ${viaSymbol}`,
    confidence === null ? null : `keyakinan ${CONFIDENCE_LABEL[confidence]}`,
  ].filter((note) => note !== null);
  const where = location === null ? '' : ` — ${location.repo} ${location.file}:${location.line}`;
  const tail = notes.length === 0 ? '' : ` (${notes.join(', ')})`;
  return [
    `- ${finding.severity.toUpperCase()} ${finding.kind}${where}${tail}`,
    `  ${finding.detail}`,
  ];
}

/** Endpoint dengan severity terburuk dulu, lalu menurut nama; tiap kelompok sudah terurut. */
function endpointBlocks(findings: readonly CopyTextFinding[]): string[][] {
  const groups = new Map<string, CopyTextFinding[]>();
  for (const finding of findings) {
    groups.set(finding.endpoint, [...(groups.get(finding.endpoint) ?? []), finding]);
  }
  return [...groups.entries()]
    .map(([endpoint, list]) => ({ endpoint, list: list.toSorted(compareFindings) }))
    .sort(
      (a, b) =>
        rank(a.list[0]!.severity) - rank(b.list[0]!.severity) || compare(a.endpoint, b.endpoint),
    )
    .map(({ endpoint, list }) => [endpoint, ...list.flatMap(findingLines)]);
}

/** Teks polos untuk ditempel ke chat atau PR; tanpa cuplikan kode dan tanpa baris penutup. */
export function buildCopyText(input: CopyTextInput): string {
  const { summary, findings } = input;
  const { counts } = summary;
  const noConsumer = summary.endpoints_without_consumer;

  const total =
    findings.length === 0
      ? 'Bersih: tidak ada dampak ke consumer.'
      : [
          `${counts.break} break`,
          `${counts.warn} warn`,
          `${counts.info} info`,
          ...(noConsumer.length === 0 ? [] : [`${noConsumer.length} endpoint tanpa consumer`]),
        ].join(' · ');
  const repos = Object.keys(summary.consumer_shas);

  const notes = [
    ...(summary.incomplete
      ? [
          `Catatan: laporan tidak lengkap, ${summary.skipped_files} file consumer dilewati karena batas jumlah file.`,
        ]
      : []),
    ...summary.fetch_errors.map(
      (error) => `Catatan: fetch gagal untuk ${error.repo} (${error.message}).`,
    ),
    ...(summary.spec_unpinned ? ['Catatan: spec provider dibuat tanpa lockfile ter-commit.'] : []),
  ];

  const blocks: string[][] = [
    [
      `Contract Check #${input.id} · ${input.provider}`,
      `Base: ${input.base_ref} (merge-base ${short(input.base_sha)})`,
      `Head: ${input.head_ref} @ ${short(input.head_sha)}`,
    ],
    [
      total,
      `${summary.files_checked} file diperiksa di ${repos.length} repo (${summary.files_via_hop2} via hop 2)`,
    ],
    ...endpointBlocks(findings),
    noConsumer.length === 0
      ? []
      : [
          `Tanpa consumer (${noConsumer.length}):`,
          ...noConsumer.map((endpoint) => `- ${endpoint}`),
          `  ${NO_CONSUMER_NOTE}`,
        ],
    notes,
    repos.length === 0
      ? []
      : [
          `Consumer (default branch): ${repos
            .map((repo) => `${repo} @ ${short(summary.consumer_shas[repo]!)}`)
            .join(', ')}`,
        ],
  ];

  return blocks
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n');
}
