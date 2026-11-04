import type { AxeMatchers } from 'vitest-axe/matchers';

// vitest-axe 0.1.0 menambah tipe ke namespace `Vi` lama; Vitest 4 memakai modul `vitest`.
declare module 'vitest' {
  // `T` harus sama dengan deklarasi Vitest walau tidak dipakai di sini.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
