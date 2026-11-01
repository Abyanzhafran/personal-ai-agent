import { createFileRoute } from '@tanstack/react-router';
import { Folder, ListChecks, Play, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Chip } from '../components/ui/chip';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { NavRail, NavRailItem } from '../components/ui/nav-rail';
import { Progress } from '../components/ui/progress';
import { Select } from '../components/ui/select';
import { SeverityChip, type ChipSeverity } from '../components/ui/severity-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { TextField } from '../components/ui/text-field';
import { toast } from '../components/ui/toast';

export const Route = createFileRoute('/dev/ui')({
  component: UiPage,
});

const SEVERITIES: ChipSeverity[] = [
  'break',
  'warn',
  'info',
  'clean',
  'spec_stale',
  'cancelled',
  'failed',
];

// Halaman alat bantu pengembang untuk memeriksa komponen dengan mata. Bukan layar produk, jadi
// teksnya sengaja tidak lewat kamus i18n (aturan #6 berlaku untuk layar produk).
function UiPage() {
  return (
    <section data-testid="ui-page" className="flex flex-col gap-10 p-8">
      <h1 className="text-headline font-normal">Komponen UI</h1>

      <Demo name="button" title="Button">
        <Button>Filled</Button>
        <Button variant="tonal">Tonal</Button>
        <Button variant="outlined">Outlined</Button>
        <Button variant="text">Text</Button>
        <Button>
          <RefreshCw aria-hidden />
          Dengan ikon
        </Button>
        <Button disabled>Nonaktif</Button>
        <Button size="large">
          <Play aria-hidden />
          Large
        </Button>
        <Button size="large" variant="tonal">
          Large tonal
        </Button>
        <Button size="large" variant="outlined">
          Large outlined
        </Button>
      </Demo>

      <Demo name="text-field" title="TextField">
        <div className="w-72">
          <TextField
            label="Nama project"
            defaultValue="Customer Support"
            supporting="Wajib dan unik"
          />
        </div>
        <div className="w-72">
          <TextField label="Path repo" placeholder="/path/ke/repo" />
        </div>
        <div className="w-72">
          <TextField label="Nonaktif" defaultValue="tidak bisa diubah" disabled />
        </div>
      </Demo>

      <Demo name="textarea" title="Textarea">
        <div className="w-96">
          <Textarea label="Deskripsi" placeholder="Mis. portal pelanggan" supporting="Opsional" />
        </div>
      </Demo>

      <Demo name="select" title="Select">
        <div className="w-72">
          <Select
            label="Provider (service)"
            supporting="Spec: api/openapi.yaml"
            defaultValue="svc-order"
          >
            <option>svc-order</option>
            <option>svc-payment</option>
          </Select>
        </div>
        <div className="w-72">
          <Select label="Base ref" className="font-mono" defaultValue="main">
            <option>main</option>
            <option>release/1.8</option>
          </Select>
        </div>
      </Demo>

      <Demo name="checkbox" title="Checkbox">
        <label className="flex items-center gap-3">
          <Checkbox /> Tidak dicentang
        </label>
        <label className="flex items-center gap-3">
          <Checkbox defaultChecked /> Dicentang
        </label>
        <label className="flex items-center gap-3">
          <Checkbox disabled /> Nonaktif
        </label>
      </Demo>

      <Demo name="chip" title="Chip">
        <Chip>deterministik</Chip>
        <Chip tone="tonal">Claude</Chip>
      </Demo>

      <Demo name="severity-chip" title="SeverityChip">
        {SEVERITIES.map((severity) => (
          <SeverityChip key={severity} severity={severity}>
            {severity}
          </SeverityChip>
        ))}
      </Demo>

      <Demo name="tabs" title="Tabs">
        <Tabs defaultValue="satu" className="w-96">
          <TabsList>
            <TabsTrigger value="satu">Satu</TabsTrigger>
            <TabsTrigger value="dua">Dua</TabsTrigger>
          </TabsList>
          <TabsContent value="satu" className="py-4">
            Isi tab satu
          </TabsContent>
          <TabsContent value="dua" className="py-4">
            Isi tab dua
          </TabsContent>
        </Tabs>
      </Demo>

      <Demo name="table" title="Table">
        <div className="w-full overflow-hidden rounded-md border border-outline-variant bg-surface-container-lowest">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Hasil</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>128</TableCell>
                <TableCell>svc-order</TableCell>
                <TableCell>
                  <SeverityChip severity="break">3 break</SeverityChip>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>126</TableCell>
                <TableCell>svc-order</TableCell>
                <TableCell>
                  <SeverityChip severity="clean">Bersih</SeverityChip>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Demo>

      <Demo name="progress" title="Progress">
        <div className="flex w-96 flex-col gap-3">
          <Progress value={0} aria-label="0 persen" />
          <Progress value={50} aria-label="50 persen" />
          <Progress value={100} aria-label="100 persen" />
        </div>
      </Demo>

      <Demo name="dialog" title="Dialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="tonal">Buka dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Project baru</DialogTitle>
            <div className="flex flex-col gap-5">
              <TextField label="Nama project" />
              <Textarea label="Deskripsi" supporting="Opsional" />
            </div>
            <DialogDescription className="mt-5">
              Setelah dibuat, tambahkan repo satu per satu.
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="text">Batal</Button>
              </DialogClose>
              <Button>Buat project</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Demo>

      <Demo name="toast" title="Toast">
        <Button variant="outlined" onClick={() => toast('Fetch selesai untuk 3 repo')}>
          Tampilkan toast
        </Button>
      </Demo>

      <Demo name="nav-rail" title="NavRail">
        <div className="rounded-md bg-surface-container-lowest">
          <NavRail aria-label="Navigasi utama">
            <NavRailItem href="#projects" icon={<Folder aria-hidden />}>
              Projects
            </NavRailItem>
            <NavRailItem href="#checks" icon={<ListChecks aria-hidden />} active>
              Checks
            </NavRailItem>
          </NavRail>
        </div>
      </Demo>
    </section>
  );
}

function Demo({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <div data-component={name} className="flex flex-col gap-3">
      <h2 className="text-title font-medium">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </div>
  );
}
