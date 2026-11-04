import type { CheckDetail, CheckSummary, Finding } from '@cc/shared';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource, fetchMock, json, renderAt, repo, serve } from '../test-utils';

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  toast.dismiss(); // store sonner bersifat global; toast test ini tidak boleh bocor ke test berikutnya
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const sha = (prefix: string) => prefix.padEnd(40, '0');
const mfe = 'microfrontend-dashboard';
const payment = 'svc-payment';

let nextId = 0;
const finding = (extra: Partial<Finding>): Finding => ({
  id: ++nextId,
  endpoint: 'GET /orders',
  consumer_repo: mfe,
  file: 'src/api/orders.ts',
  line: 42,
  kind: 'removed',
  severity: 'break',
  detail: 'detail',
  confidence: 'high',
  via_symbol: null,
  snippet: null,
  ...extra,
});

const lines = (from: number, ...texts: string[]) =>
  texts.map((text, index) => ({ n: from + index, text }));

/** Laporan #128 di mockup (artboard 6): 3 break, 2 warn, 1 info, 1 endpoint tanpa consumer. */
const findings128: Finding[] = [
  finding({
    detail: 'Consumer mengirim query page_size, yang sudah dihapus dari provider (head).',
    snippet: {
      lines: lines(
        40,
        'export const listOrders = (p: Params) =>',
        "  http.get('/orders', {",
        '    params: { page_size: p.size, status: p.status },',
        '  })',
      ),
      highlight: 42,
      tokens: ['page_size'],
    },
  }),
  finding({
    file: 'src/pages/OrdersPage.tsx',
    line: 88,
    detail: 'Field response total dihapus di feature/xyz, tapi consumer masih membacanya.',
    via_symbol: 'useOrders',
    confidence: 'medium',
    snippet: {
      lines: lines(
        86,
        'const { data } = useOrders(filters)',
        'const pages = Math.ceil(',
        '  data.total / PAGE_SIZE',
        ')',
      ),
      highlight: 88,
      tokens: ['total'],
    },
  }),
  finding({
    endpoint: 'POST /orders',
    consumer_repo: payment,
    file: 'internal/clients/order_client.go',
    line: 63,
    kind: 'required_added',
    detail: 'Field request currency kini required, tapi consumer tidak mengirimnya.',
    confidence: 'medium',
    snippet: {
      lines: lines(63, 'body := CreateOrderReq{', '    CustomerID: in.CustomerID,', '}'),
      highlight: 63,
      tokens: ['CreateOrderReq'],
    },
  }),
  finding({
    endpoint: 'POST /orders',
    consumer_repo: payment,
    file: 'internal/clients/order_client.go',
    line: 66,
    kind: 'param_mismatch',
    severity: 'warn',
    detail: 'Consumer mengirim note yang tidak ada di spec head.',
    snippet: {
      lines: lines(65, '    Items:      in.Items,', '    Note:       in.Note,', '}'),
      highlight: 66,
      tokens: ['Note'],
    },
  }),
  finding({
    endpoint: 'GET /orders/{param}',
    file: 'src/components/OrderSummary.tsx',
    line: 31,
    kind: 'type_changed',
    severity: 'warn',
    detail: 'Field response grand_total berubah tipe number → string.',
    confidence: 'low',
  }),
  finding({
    endpoint: 'GET /orders/{param}',
    file: 'src/components/OrderLines.tsx',
    line: 18,
    kind: 'type_changed',
    severity: 'info',
    detail: 'Field response quantity melebar dari integer ke number.',
    snippet: {
      lines: lines(17, 'items.map((line) => (', '  <Row qty={line.quantity} />'),
      highlight: 18,
      tokens: ['line.quantity'],
    },
  }),
];

// Jam lokal seperti yang ditampilkan layar: selesai 13:43, 48 dtk.
const STARTED = new Date(2026, 10, 4, 13, 42, 12).toISOString();
const FINISHED = new Date(2026, 10, 4, 13, 43, 0).toISOString();

const SUMMARY: CheckSummary = {
  counts: { break: 3, warn: 2, info: 1 },
  files_checked: 12,
  files_via_hop2: 1,
  endpoints_without_consumer: ['POST /orders/{param}/cancel'],
  consumer_shas: {
    [mfe]: sha('7c4d2e1'),
    [payment]: sha('3b9a0f8'),
    'svc-inventory': sha('e5f6a7b'),
  },
  matched_fields: {
    'GET /orders': ['status', 'items'],
    'POST /orders': ['customer_id', 'items'],
    'GET /orders/{param}': ['id', 'status'],
  },
  incomplete: false,
  skipped_files: 0,
  tool_versions: {},
  spec_unpinned: false,
  fetch_errors: [],
};

const report = (extra: Partial<CheckDetail> = {}): CheckDetail => ({
  check: {
    id: 128,
    project_id: 1,
    provider_repo_id: 11,
    base_ref: 'main',
    head_ref: 'feature/xyz',
    base_sha: sha('a1b2c3d'),
    head_sha: sha('9f8e7d6'),
    status: 'findings',
    started_at: STARTED,
    finished_at: FINISHED,
    error: null,
  },
  project_name: 'Order Platform',
  provider_repo_name: 'svc-order',
  findings: findings128,
  summary: SUMMARY,
  ...extra,
});

const FETCHED = new Date(2026, 10, 4, 13, 41).toISOString();
const routes = (detail: CheckDetail = report()) => ({
  'GET /api/checks/128': () => detail,
  'GET /api/repos/11': () => repo({ id: 11, name: 'svc-order', last_fetch_at: FETCHED }),
  'GET /api/projects/1/repos': () => [
    repo({ id: 11, name: 'svc-order', role: 'service' }),
    repo({ id: 12, name: mfe, role: 'microfrontend' }),
    repo({ id: 13, name: payment, role: 'service' }),
  ],
});

/** Check baru yang dibuat "Jalankan ulang", dan detailnya selama masih berjalan. */
const created = { ...report().check, id: 129, status: 'running', finished_at: null };
const running = (id: number) => ({
  check: { ...created, id },
  project_name: 'Order Platform',
  provider_repo_name: 'svc-order',
  findings: [],
  summary: null,
});
const posted = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === '/api/checks' && init?.method === 'POST');

async function openReport(detail?: CheckDetail) {
  serve(routes(detail));
  const view = renderAt('/checks/128');
  await screen.findByRole('heading', { level: 1, name: 'svc-order · main → feature/xyz' });
  return view;
}

/** Kartu endpoint, berurutan seperti di layar. */
const cards = () =>
  screen
    .getAllByRole('region')
    .filter((el) => /^(GET|POST) /.test(el.getAttribute('aria-label') ?? ''));
const cardNames = () => cards().map((el) => el.getAttribute('aria-label'));
const card = (name: string) => screen.getByRole('region', { name });
const chip = (name: string) => screen.getByRole('button', { name });
const chipLabels = () =>
  within(screen.getByRole('group', { name: 'Filter laporan' }))
    .getAllByRole('button')
    .map((button) => button.textContent);

describe('Laporan #128 (artboard 6)', () => {
  it('header: ringkasan selesai, durasi, file, endpoint terdampak, dan tanpa consumer', async () => {
    await openReport();

    expect(
      screen.getByText(
        'Selesai 13:43 · 48 dtk · 12 file diperiksa di 3 repo (1 via hop 2) · 3 endpoint terdampak · 1 tanpa consumer',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salin ringkasan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Jalankan ulang' })).toBeTruthy();
  });

  it('callout "Tanpa check ini" muncul bila ada break, tidak bila hanya warn dan info', async () => {
    await openReport();
    expect(screen.getByRole('complementary', { name: 'Tanpa check ini' })).toBeTruthy();
    cleanup();

    await openReport(
      report({
        findings: findings128.filter((f) => f.severity !== 'break'),
        summary: { ...SUMMARY, counts: { break: 0, warn: 2, info: 1 } },
      }),
    );
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('chip filter: Semua 7, Break 3, Warn 2, Info 1, Tanpa consumer 1', async () => {
    await openReport();

    expect(chipLabels()).toEqual(['Semua 7', 'Break 3', 'Warn 2', 'Info 1', 'Tanpa consumer 1']);
    expect(chip('Semua 7').getAttribute('aria-pressed')).toBe('true');
  });

  it('satu kartu per endpoint: severity terburuk dulu, endpoint tanpa consumer terakhir', async () => {
    await openReport();

    expect(cardNames()).toEqual([
      'GET /orders',
      'POST /orders',
      'GET /orders/{param}',
      'POST /orders/{param}/cancel',
    ]);
    expect(within(card('GET /orders')).getByText('2 break')).toBeTruthy();
    const postOrders = within(card('POST /orders'));
    expect(postOrders.getByText('1 break')).toBeTruthy();
    expect(postOrders.getByText('1 warn')).toBeTruthy();
    // Dalam satu kartu: severity, lalu repo, file, baris.
    expect(
      within(card('GET /orders'))
        .getAllByText(/^src\/.*:\d+$/)
        .map((el) => el.textContent),
    ).toEqual(['src/api/orders.ts:42', 'src/pages/OrdersPage.tsx:88']);
  });

  it('finding: chip severity dan kind, kalimat, file:line, repo, keyakinan, tanda via hop 2', async () => {
    await openReport();
    const orders = within(card('GET /orders'));

    expect(orders.getAllByText('Break')).toHaveLength(2);
    expect(orders.getAllByText('removed')).toHaveLength(2);
    expect(
      orders.getByText(
        'Consumer mengirim query page_size, yang sudah dihapus dari provider (head).',
      ),
    ).toBeTruthy();
    expect(orders.getByText(`${mfe} · keyakinan tinggi`)).toBeTruthy();
    // AC3: finding via hop 2 tampil "sedang".
    expect(orders.getByText(`${mfe} · via hop 2 (useOrders) · keyakinan sedang`)).toBeTruthy();
    expect(
      within(card('GET /orders/{param}')).getByText(
        `${mfe} · keyakinan rendah (tidak pernah jadi Break)`,
      ),
    ).toBeTruthy();
  });

  it('cuplikan: baris tersorot sesuai severity (break, warn, info) dan token ditebalkan', async () => {
    await openReport();
    const highlighted = (name: string) => [
      ...card(name).querySelectorAll<HTMLElement>('[data-highlight]'),
    ];

    const [breakLine] = highlighted('GET /orders');
    expect(breakLine?.className).toContain('bg-code-highlight-break');
    expect(breakLine?.textContent).toBe('42    params: { page_size: p.size, status: p.status },');
    expect(breakLine?.querySelector('b')?.textContent).toBe('page_size');

    const [, warnLine] = highlighted('POST /orders');
    expect(warnLine?.className).toContain('bg-code-highlight-warn');
    expect(warnLine?.querySelector('b')?.textContent).toBe('Note');

    const [infoLine] = highlighted('GET /orders/{param}');
    expect(infoLine?.className).toContain('bg-code-highlight-info');

    // Baris lain di cuplikan yang sama tidak disorot.
    const plain = card('GET /orders').querySelector('[data-highlight] ~ div');
    expect(plain?.className).not.toContain('bg-code-highlight');
  });

  it('baris "Cocok:" per endpoint', async () => {
    await openReport();

    const matched = within(card('GET /orders')).getByText('Cocok:').parentElement as HTMLElement;
    expect(matched.textContent).toBe('Cocok:statusitems');
    expect(
      within(matched)
        .getAllByText(/./, { selector: 'code' })
        .map((el) => el.textContent),
    ).toEqual(['status', 'items']);
  });

  it('endpoint tanpa consumer: catatan keterbatasan, tanpa daftar finding', async () => {
    await openReport();
    const none = within(card('POST /orders/{param}/cancel'));

    expect(none.getByText('tanpa consumer')).toBeTruthy();
    expect(none.getByText('Consumer tidak ditemukan')).toBeTruthy();
    expect(none.getByText('Dicari di 3 repo: path dan operationId')).toBeTruthy();
    expect(none.getByText(/Tidak ketemu bukan berarti aman/)).toBeTruthy();
    expect(none.queryByText('Break')).toBeNull();
  });

  it('footer: base, head, fetch terakhir, SHA tiap consumer, legenda keyakinan, path artefak', async () => {
    await openReport();

    expect(screen.getByText('a1b2c3d')).toBeTruthy();
    expect(screen.getByText('feature/xyz @ 9f8e7d6')).toBeTruthy();
    expect(await screen.findByText(/Fetch terakhir .*13:41/)).toBeTruthy();
    expect(screen.getByText(`${mfe} @ 7c4d2e1`)).toBeTruthy();
    expect(screen.getByText(`${payment} @ 3b9a0f8`)).toBeTruthy();
    expect(screen.getByText('svc-inventory @ e5f6a7b')).toBeTruthy();
    expect(screen.getByText(/^Keyakinan: tinggi = baris memuat nama field atau path/)).toBeTruthy();
    expect(
      screen.getByText(
        'Artefak tersimpan di runs/checks/128/ (spec base & head, diff, JSON ekstraksi).',
      ),
    ).toBeTruthy();
  });
});

describe('filter', () => {
  it('chip severity menyaring kartu dan temuan; endpoint tanpa consumer ikut hilang', async () => {
    await openReport();

    await userEvent.click(chip('Break 3'));

    expect(chip('Break 3').getAttribute('aria-pressed')).toBe('true');
    expect(cardNames()).toEqual(['GET /orders', 'POST /orders']);
    expect(within(card('POST /orders')).queryByText('1 warn')).toBeNull();
    expect(within(card('POST /orders')).queryByText('param_mismatch')).toBeNull();
  });

  it('chip "Tanpa consumer" hanya menampilkan endpoint tanpa consumer', async () => {
    await openReport();

    await userEvent.click(chip('Tanpa consumer 1'));

    expect(cardNames()).toEqual(['POST /orders/{param}/cancel']);
  });

  it('severity digabung dengan consumer, dan jumlah di chip ikut berubah', async () => {
    await openReport();
    const consumer = screen.getByRole('combobox', { name: 'Filter consumer' });

    await userEvent.selectOptions(consumer, payment);

    expect(chipLabels()).toEqual(['Semua 2', 'Break 1', 'Warn 1']);
    expect(cardNames()).toEqual(['POST /orders']);

    await userEvent.selectOptions(consumer, mfe);
    expect(chipLabels()).toEqual(['Semua 4', 'Break 2', 'Warn 1', 'Info 1']);

    await userEvent.click(chip('Warn 1'));
    expect(cardNames()).toEqual(['GET /orders/{param}']);
    expect(within(card('GET /orders/{param}')).getAllByText('Warn')).toHaveLength(1);
  });

  it('kombinasi tanpa hasil → pesan, bukan layar kosong', async () => {
    await openReport();

    // "Info" masih aktif saat consumer berganti: chipnya tetap tampil walau jumlahnya 0.
    await userEvent.click(chip('Info 1'));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter consumer' }),
      payment,
    );

    expect(chipLabels()).toEqual(['Semua 2', 'Break 1', 'Warn 1', 'Info 0']);
    expect(cardNames()).toEqual([]);
    expect(screen.getByText('Tidak ada temuan yang cocok dengan filter ini.')).toBeTruthy();
  });
});

describe('aksi', () => {
  it('Salin ringkasan menyalin teks CC-050 ke clipboard dan memberi konfirmasi', async () => {
    const user = userEvent.setup();
    await openReport();

    await user.click(screen.getByRole('button', { name: 'Salin ringkasan' }));

    expect(await screen.findByText('Ringkasan disalin')).toBeTruthy();
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('Contract Check #128 · svc-order');
    expect(copied).toContain('Base: main (merge-base a1b2c3d)');
    expect(copied).toContain('Head: feature/xyz @ 9f8e7d6');
    expect(copied).toContain('3 break · 2 warn · 1 info · 1 endpoint tanpa consumer');
  });

  it('clipboard menolak → pemberitahuan gagal, bukan konfirmasi', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('ditolak'));
    await openReport();

    await user.click(screen.getByRole('button', { name: 'Salin ringkasan' }));

    expect(await screen.findByText('Ringkasan gagal disalin')).toBeTruthy();
    expect(screen.queryByText('Ringkasan disalin')).toBeNull();
  });

  it('Jalankan ulang memulai check dengan ref yang sama lalu membuka check baru', async () => {
    serve({
      ...routes(),
      'POST /api/checks': () => created,
      'GET /api/checks/129': () => running(129),
    });
    const { router } = renderAt('/checks/128');
    await screen.findByRole('heading', { level: 1, name: 'svc-order · main → feature/xyz' });

    await userEvent.click(screen.getByRole('button', { name: 'Jalankan ulang' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/checks/129'));
    expect(posted()).toHaveLength(1);
    expect(JSON.parse(String(posted()[0]?.[1]?.body))).toEqual({
      provider_repo_id: 11,
      head_ref: 'feature/xyz',
      base_ref: 'main',
    });
  });

  it('project sudah punya check berjalan (409) → membuka check itu', async () => {
    serve({
      ...routes(),
      'POST /api/checks': () =>
        json(
          {
            error: {
              code: 'check_already_running',
              message: 'Project ini sudah punya check yang sedang berjalan.',
              details: { project_id: 1, check_id: 7 },
            },
          },
          409,
        ),
      'GET /api/checks/7': () => running(7),
    });
    const { router } = renderAt('/checks/128');
    await screen.findByRole('heading', { level: 1, name: 'svc-order · main → feature/xyz' });

    await userEvent.click(screen.getByRole('button', { name: 'Jalankan ulang' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/checks/7'));
  });
});

describe('dari check berjalan', () => {
  it('check selesai dengan temuan → layar pindah dari progres ke laporan', async () => {
    let finished = false;
    const inProgress = report({ findings: [], summary: null });
    serve({
      ...routes(),
      'GET /api/checks/128': () =>
        finished
          ? report()
          : { ...inProgress, check: { ...inProgress.check, status: 'running', finished_at: null } },
    });
    renderAt('/checks/128');
    await screen.findByRole('heading', { level: 1, name: 'Check berjalan' });
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    finished = true;
    act(() => FakeEventSource.instances[0]?.emit({ type: 'done', seq: 1, status: 'findings' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'svc-order · main → feature/xyz' }),
    ).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

const STALE_DETAIL = 'Kode di handler_dirs berubah, tetapi docs/swagger.json tidak ikut diubah';
const stale = finding({
  endpoint: 'spec',
  consumer_repo: null,
  file: null,
  line: null,
  kind: 'spec_stale',
  severity: 'warn',
  detail: STALE_DETAIL,
  confidence: null,
});

/** Ringkasan check yang tidak menemukan apa pun; menimpa lewat spread. */
const EMPTY: CheckSummary = {
  ...SUMMARY,
  counts: { break: 0, warn: 0, info: 0 },
  files_checked: 0,
  files_via_hop2: 0,
  endpoints_without_consumer: [],
  consumer_shas: {},
  matched_fields: {},
};

const withStatus = (status: CheckDetail['check']['status'], extra: Partial<CheckDetail>) => {
  const base = report();
  return report({ check: { ...base.check, status }, ...extra });
};

describe('varian: spec_stale (artboard 7)', () => {
  it('spec_stale saja → catatan spec usang + hasil diff, tanpa chip, kartu, dan footer', async () => {
    await openReport(
      report({ findings: [stale], summary: { ...EMPTY, counts: { break: 0, warn: 1, info: 0 } } }),
    );

    expect(screen.getByText('Selesai 13:43 · 48 dtk')).toBeTruthy();
    const note = screen.getByRole('complementary', { name: 'Spec mungkin usang' });
    expect(note.textContent).toContain('spec_stale');
    expect(note.textContent).toContain(STALE_DETAIL);
    expect(note.textContent).toContain(
      'Perbarui spec di svc-order, commit, lalu jalankan ulang check.',
    );
    const diff = within(screen.getByRole('region', { name: 'Hasil diff spec' }));
    expect(
      diff.getByText(/Diff spec antara main dan feature\/xyz tidak menemukan perubahan/),
    ).toBeTruthy();
    expect(
      diff.getByText(/Consumer tidak dicari karena tidak ada endpoint yang berubah/),
    ).toBeTruthy();
    // Hanya Jalankan ulang, seperti mockup; tanpa filter, kartu endpoint, atau footer.
    expect(screen.getByRole('button', { name: 'Jalankan ulang' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salin ringkasan' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filter laporan' })).toBeNull();
    expect(cardNames()).toEqual([]);
    expect(screen.queryByText('Base: merge-base')).toBeNull();
  });

  it('spec_stale bersama temuan lain → catatan di atas, bukan kartu "spec", dan tidak dihitung di chip', async () => {
    await openReport(
      report({
        findings: [...findings128, stale],
        summary: { ...SUMMARY, counts: { break: 3, warn: 3, info: 1 } },
      }),
    );

    expect(screen.getByRole('complementary', { name: 'Spec mungkin usang' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'spec' })).toBeNull();
    expect(chipLabels()).toEqual(['Semua 7', 'Break 3', 'Warn 2', 'Info 1', 'Tanpa consumer 1']);
    expect(screen.getByRole('complementary', { name: 'Tanpa check ini' })).toBeTruthy();
  });
});

describe('varian: bersih (artboard 8)', () => {
  const infoOnly: Finding[] = [
    finding({
      endpoint: 'GET /stock',
      consumer_repo: 'mfe-warehouse-ui',
      file: 'src/api/stock.ts',
      line: 12,
      kind: 'type_changed',
      severity: 'info',
      detail: 'Query sku ditambahkan sebagai parameter opsional; tidak memengaruhi consumer.',
      snippet: {
        lines: lines(11, 'export const listStock = () =>', "  http.get('/stock')"),
        highlight: 12,
        tokens: [],
      },
    }),
    finding({
      endpoint: 'POST /stock/adjust',
      consumer_repo: 'svc-shipping',
      file: 'internal/stock/client.go',
      line: 44,
      kind: 'type_changed',
      severity: 'info',
      detail: 'Field response reason mendapat nilai baru recount.',
    }),
  ];
  const cleanSummary: CheckSummary = {
    ...EMPTY,
    counts: { break: 0, warn: 0, info: 2 },
    files_checked: 6,
    consumer_shas: { 'svc-shipping': sha('b1c2d3e'), 'mfe-warehouse-ui': sha('f4a5b6c') },
  };

  it('hanya info → "aman untuk merge", tanpa "Tanpa check ini", dan tanpa chip severity yang kosong', async () => {
    await openReport(report({ findings: infoOnly, summary: cleanSummary }));

    expect(
      screen.getByText(
        'Selesai 13:43 · 48 dtk · 6 file diperiksa di 2 repo · 2 perubahan non-breaking',
      ),
    ).toBeTruthy();
    const note = screen.getByRole('complementary', { name: 'Bersih: aman untuk merge' });
    expect(note.textContent).toContain('Tidak ada konflik dengan consumer.');
    expect(screen.queryByRole('complementary', { name: 'Tanpa check ini' })).toBeNull();
    // AC1: hanya chip yang berisi.
    expect(chipLabels()).toEqual(['Semua 2', 'Info 2']);
    expect(cardNames()).toEqual(['GET /stock', 'POST /stock/adjust']);
    expect(screen.getByRole('button', { name: 'Salin ringkasan' })).toBeTruthy();
  });

  it('daftar consumer yang diperiksa dan batas hasil bersih', async () => {
    await openReport(report({ findings: infoOnly, summary: cleanSummary }));

    const checked = within(screen.getByRole('region', { name: 'Consumer yang diperiksa' }));
    expect(checked.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'svc-shippingtidak ada konflik',
      'mfe-warehouse-uitidak ada konflik',
    ]);
    expect(screen.getByRole('complementary', { name: 'Batas hasil bersih' }).textContent).toContain(
      'Pemanggil dinamis atau komunikasi async tidak terlihat oleh tool ini.',
    );
  });

  it('status clean tanpa finding sama sekali → tetap laporan bersih, tanpa filter dan kartu', async () => {
    await openReport(withStatus('clean', { findings: [], summary: cleanSummary }));

    expect(screen.getByRole('complementary', { name: 'Bersih: aman untuk merge' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter laporan' })).toBeNull();
    expect(cardNames()).toEqual([]);
    expect(screen.getByRole('region', { name: 'Consumer yang diperiksa' })).toBeTruthy();
  });
});

describe('varian: backend ke backend (artboard 9)', () => {
  const serviceOnly = [findings128[2] as Finding];
  const summary: CheckSummary = { ...SUMMARY, counts: { break: 1, warn: 0, info: 0 } };

  it('semua consumer yang punya temuan berperan service → teks backend ke backend', async () => {
    await openReport(report({ findings: serviceOnly, summary }));

    const note = await screen.findByText(/Konflik backend ke backend seperti ini/);
    expect(note.closest('aside')?.getAttribute('aria-label')).toBe('Tanpa check ini');
  });

  it('ada consumer microfrontend → tetap teks frontend ke backend', async () => {
    await openReport();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/projects/1/repos')).toBe(true),
    );

    expect(screen.getByText(/Konflik frontend ke backend seperti ini/)).toBeTruthy();
    expect(screen.queryByText(/Konflik backend ke backend/)).toBeNull();
  });
});

describe('laporan tidak lengkap', () => {
  it('banner menyebut jumlah file yang dilewati', async () => {
    await openReport(report({ summary: { ...SUMMARY, incomplete: true, skipped_files: 7 } }));

    const banner = screen.getByRole('complementary', { name: 'Laporan tidak lengkap' });
    expect(banner.textContent).toContain('7 file tidak diperiksa');
  });

  it('laporan lengkap tanpa banner', async () => {
    await openReport();

    expect(screen.queryByRole('complementary', { name: 'Laporan tidak lengkap' })).toBeNull();
  });
});

describe('check gagal dan dibatalkan', () => {
  it('gagal: alasan dari checks.error dan Jalankan ulang, tanpa daftar finding', async () => {
    await openReport(
      withStatus('failed', {
        findings: [],
        summary: null,
        check: {
          ...report().check,
          status: 'failed',
          error: 'fetch svc-order gagal: remote tidak terjangkau',
        },
      }),
    );

    expect(screen.getByText('Gagal 13:43 · 48 dtk')).toBeTruthy();
    const note = screen.getByRole('complementary', { name: 'Check gagal' });
    expect(note.textContent).toContain('fetch svc-order gagal: remote tidak terjangkau');
    expect(screen.getByRole('button', { name: 'Jalankan ulang' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salin ringkasan' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filter laporan' })).toBeNull();
    expect(cardNames()).toEqual([]);
  });

  it('Jalankan ulang dari check gagal memulai check dengan ref yang sama', async () => {
    serve({
      ...routes(withStatus('failed', { findings: [], summary: null })),
      'POST /api/checks': () => created,
      'GET /api/checks/129': () => running(129),
    });
    const { router } = renderAt('/checks/128');
    await screen.findByRole('heading', { level: 1, name: 'svc-order · main → feature/xyz' });

    await userEvent.click(screen.getByRole('button', { name: 'Jalankan ulang' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/checks/129'));
    expect(JSON.parse(String(posted()[0]?.[1]?.body))).toEqual({
      provider_repo_id: 11,
      head_ref: 'feature/xyz',
      base_ref: 'main',
    });
  });

  it('dibatalkan: catatan netral dan Jalankan ulang', async () => {
    await openReport(withStatus('cancelled', { findings: [], summary: null }));

    expect(screen.getByText('Dibatalkan 13:43 · 48 dtk')).toBeTruthy();
    const note = screen.getByRole('complementary', { name: 'Check dibatalkan' });
    expect(note.textContent).toContain('Check dihentikan sebelum selesai, jadi tidak ada laporan.');
    expect(screen.getByRole('button', { name: 'Jalankan ulang' })).toBeTruthy();
    expect(cardNames()).toEqual([]);
  });
});
