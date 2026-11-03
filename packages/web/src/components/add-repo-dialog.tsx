import { ROLES, type Project, type Role } from '@cc/shared';
import { Check } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { fieldError } from '../lib/api';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import { useCreateRepo } from '../lib/projects';
import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { TextField } from './ui/text-field';

/** Nama folder terakhir dari path yang diketik (pemisah `/` atau `\`), tanpa tanda kutip di ujung. */
const folderName = (path: string) =>
  path
    .trim()
    .replace(/^"|"$/g, '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() ?? '';

/** Pilihan peran sebagai tombol bersambung (mockup artboard 2). */
function RolePicker({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  const t = useT();
  const labelId = useId();
  return (
    <div>
      <div id={labelId} className="mb-2 ml-1 text-label text-on-surface-variant">
        {t('repos.field.role')}
      </div>
      <div role="group" aria-labelledby={labelId} className="flex">
        {ROLES.map((role, index) => (
          <button
            key={role}
            type="button"
            aria-pressed={role === value}
            onClick={() => onChange(role)}
            className={cn(
              'inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 border border-outline text-body font-medium',
              index > 0 && 'border-l-0',
              index === 0 && 'rounded-l-lg',
              index === ROLES.length - 1 && 'rounded-r-lg',
              role === value
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-transparent text-on-surface',
            )}
          >
            {role === value && <Check aria-hidden className="size-[18px]" />}
            {role}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Isi dialog; hanya dipasang saat dialog terbuka, jadi isiannya kosong lagi di pembukaan berikutnya.
 * Tidak ada pemeriksaan sebelum Simpan: semua galat datang dari server dan tampil di isian yang ditunjuk.
 */
function AddRepoForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const t = useT();
  const create = useCreateRepo(project.id);
  const [role, setRole] = useState<Role>('service');
  const [path, setPath] = useState('');
  const [typedName, setTypedName] = useState<string>();
  const [branch, setBranch] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    // Nama yang tidak diubah user tidak dikirim: server mengisinya dari folder hasil normalisasi path.
    create.mutate(
      { role, local_path: path, name: typedName, default_branch: branch },
      { onSuccess: onDone },
    );
  }

  const field = (key: 'local_path' | 'name' | 'default_branch', hint: string) => {
    const error = fieldError(create.error, key);
    return {
      supporting: error ? <span role="alert">{error}</span> : hint,
      'aria-invalid': error ? true : undefined,
    };
  };

  return (
    <form onSubmit={submit}>
      <DialogTitle className="mb-1">{t('repos.add.title')}</DialogTitle>
      <DialogDescription className="mb-6 text-body">
        {t('repos.add.toProject', { name: project.name })}
      </DialogDescription>
      <div className="flex flex-col gap-5">
        <TextField
          label={t('repos.field.path')}
          className="font-mono"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          {...field('local_path', t('repos.field.pathHint'))}
        />
        <TextField
          label={t('repos.field.name')}
          value={typedName ?? folderName(path)}
          onChange={(event) => setTypedName(event.target.value)}
          {...field('name', t('repos.field.nameHint'))}
        />
        <RolePicker value={role} onChange={setRole} />
        <TextField
          label={t('repos.field.branch')}
          className="font-mono"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          {...field('default_branch', t('repos.field.branchHint'))}
        />
      </div>
      <p className="mt-5 text-label text-on-surface-variant">{t('repos.add.note')}</p>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="text">
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={create.isPending}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Dialog Tambah repo (CC-078). Tombol pembukanya milik pemanggil: ada di header dan di state kosong. */
export function AddRepoDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <AddRepoForm project={project} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
