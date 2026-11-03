/** Penyebab check berstatus Gagal yang bisa dijelaskan ke user; `message` menjadi `checks.error`. */
export class CheckFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckFailure';
  }
}
