import type { GitAdapter } from '../git/adapter.js';
import { mapLimit } from '../util/concurrency.js';

// Konstanta, bukan config.ts (pola adapter.ts). Angka file dan kandidat dipilih pemilik (CC-017):
// terburuk ~400 KB per repo, itulah batas atas biaya input discovery.
const MAX_TREE_PATHS = 400;
const MAX_FILE_CHARS = 20_000;
const MAX_ROUTER_CANDIDATES = 15;
const MAX_SPEC_CANDIDATES = 5;
const EXCLUDED_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build']);
const MANIFESTS = ['package.json', 'go.mod', 'pyproject.toml', 'requirements.txt'];
// Tanpa membedakan huruf besar-kecil. Router: kata ada di path penuh (`app/routers/orders.py`
// harus terpilih) atau nama berkas persis; "memuat" untuk `main.go` salah cocok dengan `domain.go`.
const ROUTER_PATH_WORDS = ['router', 'routes'];
const ROUTER_FILES = ['main.go', 'app.py'];
const SPEC_NAME_WORDS = ['swagger', 'openapi'];

export interface DiscoveryFile {
  readonly path: string;
  /** Dipotong pada `MAX_FILE_CHARS` karakter. */
  readonly content: string;
  readonly truncated: boolean;
}

export interface DiscoveryInput {
  /** Ref yang dibaca, `origin/<default_branch>`. */
  readonly ref: string;
  readonly tree: { readonly paths: readonly string[]; readonly truncated: boolean };
  /** Hanya yang ada di root repo, urut seperti daftar kartu. */
  readonly manifests: readonly DiscoveryFile[];
  readonly routerCandidates: readonly DiscoveryFile[];
  readonly specCandidates: readonly DiscoveryFile[];
}

interface Deps {
  readonly git: Pick<GitAdapter, 'lsTree' | 'show'>;
  /** `GIT_CONCURRENCY`: paling banyak sekian `git show` berjalan bersamaan. */
  readonly concurrency: number;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).toLowerCase();
const depth = (path: string) => path.split('/').length;
const isExcluded = (path: string) =>
  path
    .split('/')
    .slice(0, -1)
    .some((dir) => EXCLUDED_DIRS.has(dir));

const isRouter = (path: string) =>
  ROUTER_PATH_WORDS.some((word) => path.toLowerCase().includes(word)) ||
  ROUTER_FILES.includes(baseName(path));
const isSpec = (path: string) => SPEC_NAME_WORDS.some((word) => baseName(path).includes(word));

/** Path paling dangkal dulu, lalu urut abjad (tanpa locale, hasil sama di semua mesin). */
function candidates(
  paths: readonly string[],
  matches: (path: string) => boolean,
  max: number,
): string[] {
  return paths
    .filter(matches)
    .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, max);
}

export function createDiscoveryInputCollector({ git, concurrency }: Deps) {
  return {
    /**
     * Input deterministik untuk discovery, hanya dari `origin/<defaultBranch>` (`ls-tree` dan
     * `show`), tidak pernah dari working tree. Kandidat dipilih dari pohon penuh sebelum
     * dipotong 400 path. Melempar `RefNotFoundError` bila ref itu tidak ada.
     */
    async collect({
      path: repo,
      defaultBranch,
    }: {
      path: string;
      defaultBranch: string;
    }): Promise<DiscoveryInput> {
      const ref = `origin/${defaultBranch}`;
      const all = (await git.lsTree(repo, ref))
        .filter((entry) => entry.type === 'blob')
        .map((entry) => entry.path)
        .filter((path) => !isExcluded(path));
      const present = new Set(all);

      const read = async (path: string): Promise<DiscoveryFile> => {
        const text = await git.show(repo, ref, path);
        return {
          path,
          content: text.slice(0, MAX_FILE_CHARS),
          truncated: text.length > MAX_FILE_CHARS,
        };
      };
      const readAll = (paths: readonly string[]) => mapLimit(paths, concurrency, read);

      return {
        ref,
        tree: { paths: all.slice(0, MAX_TREE_PATHS), truncated: all.length > MAX_TREE_PATHS },
        manifests: await readAll(MANIFESTS.filter((name) => present.has(name))),
        routerCandidates: await readAll(candidates(all, isRouter, MAX_ROUTER_CANDIDATES)),
        specCandidates: await readAll(candidates(all, isSpec, MAX_SPEC_CANDIDATES)),
      };
    },
  };
}
