// Karakter yang dilarang di nama folder Windows (sama dengan `assertSafeSegment` di workspace/layout.ts),
// ditambah spasi. Satu atau lebih berurutan menjadi satu '-'.
// eslint-disable-next-line no-control-regex
const SEPARATORS = /[\s\\/:*?"<>|\u0000-\u001f]+/g;

/**
 * Nama project → nama folder `contexts/projects/<slug>/`: huruf kecil, spasi menjadi '-'.
 * Karakter yang tidak boleh ada di nama folder juga menjadi '-', dan '-' atau '.' di ujung dibuang,
 * supaya hasilnya selalu lolos `assertSafeSegment`. Mengembalikan '' bila nama tidak punya karakter
 * yang bisa dipakai (mis. `///`); pemanggil harus menolaknya.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(SEPARATORS, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}
