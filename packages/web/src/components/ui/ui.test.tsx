import { cleanup, render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Chip } from './chip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './dialog';
import { NavRail, NavRailItem } from './nav-rail';
import { Progress } from './progress';
import { Select } from './select';
import { SeverityChip, type ChipSeverity } from './severity-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Textarea } from './textarea';
import { TextField } from './text-field';
import { Toaster } from './toast';

afterEach(cleanup);

// Komponen dirender tanpa children dan tanpa label: yang tampil hanya yang diberikan lewat props.
const WITHOUT_TEXT: Record<string, ReactElement> = {
  Button: <Button />,
  TextField: <TextField label="" />,
  Textarea: <Textarea label="" />,
  Select: <Select label="" />,
  Checkbox: <Checkbox />,
  Chip: <Chip />,
  SeverityChip: <SeverityChip severity="break" />,
  Tabs: (
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a" />
      </TabsList>
      <TabsContent value="a" />
    </Tabs>
  ),
  Table: (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell />
        </TableRow>
      </TableBody>
    </Table>
  ),
  Progress: <Progress value={50} />,
  Dialog: (
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle />
        <DialogDescription />
        <DialogFooter />
      </DialogContent>
    </Dialog>
  ),
  Toaster: <Toaster containerAriaLabel="" />,
  NavRail: (
    <NavRail>
      <NavRailItem icon={null} />
    </NavRail>
  ),
};

describe('komponen ui', () => {
  it.each(Object.entries(WITHOUT_TEXT))(
    '%s tidak memuat teks apa pun dari dirinya sendiri',
    (_n, el) => {
      render(el);
      expect(document.body.textContent).toBe('');
      // Atribut berteks (nama aksesibel, tooltip, placeholder) juga harus datang dari props.
      expect(document.body.querySelector('[title], [placeholder], [alt]')).toBeNull();
      // Satu-satunya sisa yang diizinkan: petunjuk pintasan "alt+T" dari sonner pada wadah toast.
      // Itu nama tombol, bukan kalimat berbahasa, jadi tidak ikut kamus i18n.
      const labels = [...document.body.querySelectorAll('[aria-label]')].map((node) =>
        (node.getAttribute('aria-label') ?? '').replace('alt+T', '').trim(),
      );
      expect(labels.filter(Boolean)).toEqual([]);
    },
  );

  it('cakupan: setiap komponen di daftar kartu CC-072 ada', () => {
    expect(Object.keys(WITHOUT_TEXT)).toEqual(
      expect.arrayContaining([
        'Button',
        'TextField',
        'Select',
        'Dialog',
        'Checkbox',
        'Chip',
        'Tabs',
        'Table',
        'Progress',
        'Textarea',
        'Toaster',
        'NavRail',
      ]),
    );
  });
});

describe('SeverityChip', () => {
  // Tujuh nilai dari kartu CC-072: break, warn, info, bersih, spec_stale, dibatalkan, gagal.
  const BACKGROUNDS: Record<ChipSeverity, string> = {
    break: 'bg-error-container',
    warn: 'bg-warning-container',
    info: 'bg-info-container',
    clean: 'bg-success-container',
    spec_stale: 'bg-warning-container',
    cancelled: 'bg-neutral-container',
    failed: 'bg-error-container',
  };

  it.each(Object.entries(BACKGROUNDS))('severity %s memakai %s', (severity, background) => {
    const { container } = render(
      <SeverityChip severity={severity as ChipSeverity}>label</SeverityChip>,
    );
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.dataset.severity).toBe(severity);
    expect(chip.className.split(' ')).toContain(background);
    // Latar bawaan Chip (neutral) tergantikan, bukan menumpuk.
    if (severity !== 'cancelled') expect(chip.className).not.toContain('bg-neutral-container');
    expect(chip.textContent).toBe('label');
  });

  it('spec_stale memakai font mono', () => {
    const { container } = render(<SeverityChip severity="spec_stale" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('font-mono');
  });
});

describe('cn', () => {
  it('skala teks (text-body, text-label, ...) dikenali sebagai ukuran, bukan warna', () => {
    expect(cn('text-body text-on-surface')).toBe('text-body text-on-surface');
    expect(cn('text-label text-on-primary', 'text-body')).toBe('text-on-primary text-body');
  });

  it('kelas bentrok: yang terakhir menang', () => {
    expect(cn('bg-primary', 'bg-secondary-container')).toBe('bg-secondary-container');
    expect(cn('px-6', false, 'px-3')).toBe('px-3');
  });
});

describe('fokus keyboard', () => {
  const css = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'styles', 'globals.css'),
    'utf8',
  );

  it('outline primary tebal 2 offset 2, dan primary adalah #0B57D0', () => {
    const rule = /(?:[\w]+:focus-visible,?\s*)+\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/outline:\s*2px solid var\(--color-primary\)/);
    expect(rule).toMatch(/outline-offset:\s*2px/);
    expect(/--color-primary:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]?.toUpperCase()).toBe('#0B57D0');
  });

  it('daftar selektor mencakup elemen interaktif yang dipakai komponen', () => {
    for (const el of ['a', 'button', 'select', 'input', 'textarea']) {
      expect(css).toContain(`${el}:focus-visible`);
    }
  });
});
