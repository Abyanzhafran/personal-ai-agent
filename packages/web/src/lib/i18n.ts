import { id } from '../locales/id';

export type MessageKey = keyof typeof id;
/** Bentuk yang wajib dipenuhi setiap bahasa; bahasa baru cukup `const en: Messages`. */
export type Messages = Record<MessageKey, string>;

type Vars = Record<string, string | number | undefined>;

/** `{nama}` di dalam teks diganti `vars.nama`; placeholder tanpa nilai dibiarkan apa adanya. */
export const createT =
  (messages: Messages) =>
  (key: MessageKey, vars: Vars = {}) =>
    messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      String(vars[name] ?? placeholder),
    );

/** Locale `Intl` untuk bahasa aktif (nama bulan); dipilih bersama kamus di atas. */
export const locale = 'id-ID';

/** Untuk kode di luar komponen (mis. `lib/api.ts`); komponen memakai `useT()`. */
export const t = createT(id);

/** Bahasa aktif dipilih di sini, bukan di komponen. */
export const useT = () => t;
