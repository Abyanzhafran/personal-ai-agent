import type { CheckEvent, StepStatus } from '@cc/shared';

/** Nama enam langkah, sama dengan layar "Check berjalan" di mockup (tanpa nomor di depan). */
export const STEP_NAMES = [
  'Resolve ref + diff spec',
  'Cari consumer',
  'Ekstraksi pemakaian API (hop 1)',
  'Cari pemakai simbol (hop 2)',
  'Bandingkan',
  'Laporan',
] as const;

/** `CheckEvent` tanpa `seq`; penyimpan yang memberi nomor. */
type EventInput = CheckEvent extends infer E ? (E extends unknown ? Omit<E, 'seq'> : never) : never;

/** Yang dipakai pipeline untuk melapor; tidak tahu apa-apa soal SSE. */
export interface StepReporter {
  /** `number` 1–6. `detail` kosong bila tak ada yang perlu ditampilkan. */
  step(number: number, status: StepStatus, detail?: string): void;
  log(category: string, message: string): void;
  /** Menandai langkah yang sedang `running` sebagai `failed`; tidak berbuat apa-apa bila tak ada. */
  failRunning(detail: string): void;
}

export interface EventSubscription {
  /** Semua event sampai saat ini, mulai dari `seq` 1. */
  readonly replay: readonly CheckEvent[];
  /** True bila `done` sudah ada di `replay`: tidak akan ada event lagi. */
  readonly finished: boolean;
  unsubscribe(): void;
}

interface Stream {
  readonly events: CheckEvent[];
  readonly listeners: Set<(event: CheckEvent) => void>;
  finished: boolean;
}

/** Berapa check selesai yang bufernya disimpan; yang lebih lama dibuang. */
const KEEP_FINISHED = 20;

/**
 * Buffer event per check di memori (CC-061): klien yang menyambung belakangan menerima semua event
 * dari awal, lalu event baru. Hilang saat server mati; check yang sudah selesai dibaca dari DB.
 */
export function createCheckEvents({ now = () => new Date() }: { now?: () => Date } = {}) {
  const streams = new Map<number, Stream>();

  function prune(): void {
    const finished = [...streams].filter(([, stream]) => stream.finished);
    for (const [checkId] of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) {
      streams.delete(checkId);
    }
  }

  function emit(checkId: number, event: EventInput): void {
    const stream = streams.get(checkId);
    if (!stream || stream.finished) return;
    const full = { ...event, seq: stream.events.length + 1 } as CheckEvent;
    stream.events.push(full);
    if (full.type === 'done') {
      stream.finished = true;
      prune();
    }
    for (const listener of [...stream.listeners]) {
      try {
        listener(full);
      } catch {
        // Pendengar yang rusak (mis. soket putus) tidak boleh menghentikan pipeline.
      }
    }
    // Tidak ada event lagi: pendengar yang lupa berhenti tidak boleh tertahan di memori.
    if (full.type === 'done') stream.listeners.clear();
  }

  return {
    /** Memulai buffer baru untuk check yang baru dibuat. */
    open(checkId: number): void {
      streams.set(checkId, { events: [], listeners: new Set(), finished: false });
    },

    emit,

    /** `undefined` bila check tidak punya buffer di memori (selesai lama atau server pernah mati). */
    subscribe(
      checkId: number,
      listener: (event: CheckEvent) => void,
    ): EventSubscription | undefined {
      const stream = streams.get(checkId);
      if (!stream) return undefined;
      const replay = [...stream.events];
      if (!stream.finished) stream.listeners.add(listener);
      return {
        replay,
        finished: stream.finished,
        unsubscribe: () => stream.listeners.delete(listener),
      };
    },

    /** Jumlah pendengar aktif, untuk membuktikan koneksi dilepas. */
    listenerCount: (checkId: number): number => streams.get(checkId)?.listeners.size ?? 0,

    reporter(checkId: number): StepReporter {
      let running: number | undefined;
      const step = (number: number, status: StepStatus, detail = ''): void => {
        if (status === 'running') running = number;
        else if (running === number) running = undefined;
        emit(checkId, {
          type: 'step',
          number,
          name: STEP_NAMES[number - 1] as string,
          status,
          detail,
        });
      };
      return {
        step,
        log: (category, message) =>
          emit(checkId, { type: 'log', at: now().toISOString(), category, message }),
        failRunning: (detail) => {
          if (running !== undefined) step(running, 'failed', detail);
        },
      };
    },
  };
}

export type CheckEvents = ReturnType<typeof createCheckEvents>;
