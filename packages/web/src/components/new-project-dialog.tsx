import { PROJECT_NAME_MAX } from '@cc/shared';
import { useNavigate } from '@tanstack/react-router';
import { Info, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { fieldError } from '../lib/api';
import { useT } from '../lib/i18n';
import { useCreateProject } from '../lib/projects';
import { Button } from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Textarea } from './ui/textarea';
import { TextField } from './ui/text-field';

/** Tombol "Project baru" beserta dialognya (CC-077). Setelah tersimpan, project itu dipilih. */
export function NewProjectDialog() {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const nameError = fieldError(create.error, 'name');

  function close() {
    setOpen(false);
    setName('');
    setDescription('');
    create.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { name, description },
      {
        onSuccess: (project) => {
          close();
          void navigate({ to: '/projects/$projectId', params: { projectId: String(project.id) } });
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="tonal">
          <Plus aria-hidden />
          {t('projects.new')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogTitle>{t('projects.new')}</DialogTitle>
          <div className="flex flex-col gap-5">
            <TextField
              label={t('projects.field.name')}
              supporting={
                nameError ? <span role="alert">{nameError}</span> : t('projects.field.nameHint')
              }
              value={name}
              maxLength={PROJECT_NAME_MAX}
              aria-invalid={nameError ? true : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            <Textarea
              label={t('projects.field.description')}
              supporting={t('projects.field.descriptionHint')}
              placeholder={t('projects.field.descriptionPlaceholder')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <DialogDescription className="mt-5 flex items-start gap-2">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('projects.newNote')}
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="text">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={name.trim() === '' || create.isPending}>
              {t('projects.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
