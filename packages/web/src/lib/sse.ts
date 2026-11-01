import { CheckEvent, EVENT_TYPES } from '@cc/shared';
import { useEffect, useState } from 'react';

/**
 * Event SSE satu check, urut `seq`, tanpa duplikat. `EventSource` menyambung ulang sendiri bila
 * koneksi putus; server lalu mengirim ulang buffer dari awal, jadi event dengan `seq` yang sudah
 * terlihat dibuang. Koneksi ditutup saat `done` (kalau tidak, browser menyambung lagi tanpa henti)
 * dan saat unmount. Event yang tidak sesuai skema melempar galat di konsol, tidak dibuang diam-diam.
 */
export function useCheckEvents(checkId: number): CheckEvent[] {
  const [events, setEvents] = useState<CheckEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    let lastSeq = 0;
    const source = new EventSource(`/api/checks/${checkId}/events`);
    const onEvent = (message: Event) => {
      const event = CheckEvent.parse(JSON.parse((message as MessageEvent<string>).data));
      if (event.seq <= lastSeq) return;
      lastSeq = event.seq;
      setEvents((previous) => [...previous, event]);
      if (event.type === 'done') source.close();
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onEvent);
    return () => source.close();
  }, [checkId]);

  return events;
}
