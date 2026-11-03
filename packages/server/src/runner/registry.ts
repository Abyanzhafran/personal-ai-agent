/** Satu check yang sedang berjalan. */
export interface ActiveJob {
  readonly checkId: number;
  readonly projectId: number;
  /** Provider dan consumer (bukan e2e) yang dibaca check ini; DELETE repo-nya ditolak (G-7). */
  readonly repoIds: ReadonlySet<number>;
  /** `abort()` menghentikan child process dan panggilan Claude job ini (CC-062 memakainya). */
  readonly abort: AbortController;
  /** Selesai (tidak pernah ditolak) setelah job terakhir menulis statusnya. */
  readonly done: Promise<void>;
}

/** Job aktif disimpan di memori, satu per project (arsitektur: diagram 3). Hilang saat server mati. */
export function createCheckRegistry() {
  const byProject = new Map<number, ActiveJob>();

  return {
    /** Pemanggil memastikan project belum punya job lewat {@link forProject}, tanpa `await` di antaranya. */
    add(job: ActiveJob): void {
      if (byProject.has(job.projectId)) {
        throw new Error(`Project ${job.projectId} sudah punya check berjalan`);
      }
      byProject.set(job.projectId, job);
    },

    remove(checkId: number): void {
      for (const [projectId, job] of byProject) {
        if (job.checkId === checkId) byProject.delete(projectId);
      }
    },

    forProject: (projectId: number): ActiveJob | undefined => byProject.get(projectId),

    byCheck(checkId: number): ActiveJob | undefined {
      for (const job of byProject.values()) if (job.checkId === checkId) return job;
      return undefined;
    },

    /** True bila repo ini provider atau consumer check yang sedang berjalan. */
    usesRepo(repoId: number): boolean {
      for (const job of byProject.values()) if (job.repoIds.has(repoId)) return true;
      return false;
    },

    /** Mengabort semua job lalu menunggu masing-masing selesai (shutdown). */
    async stopAll(): Promise<void> {
      const jobs = [...byProject.values()];
      for (const job of jobs) job.abort.abort();
      await Promise.all(jobs.map((job) => job.done));
    },
  };
}

export type CheckRegistry = ReturnType<typeof createCheckRegistry>;
