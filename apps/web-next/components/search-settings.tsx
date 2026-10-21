'use client';

import { useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { SearchMode, SearchProvider, SearchSort } from '@/lib/search';

const providers = [
  { value: 'postgres_native', label: 'PostgreSQL' },
  { value: 'pg_search', label: 'PostgreSQL · BM25' },
  { value: 'meilisearch', label: 'Meilisearch' },
  { value: 'typesense', label: 'Typesense' }
];
const methods = [{ value: 'keyword', label: 'Keyword' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'semantic', label: 'Semantic' }];
const sorts = [{ value: 'relevance', label: 'Relevance' }, { value: 'price_asc', label: 'Price ↑' }, { value: 'price_desc', label: 'Price ↓' }, { value: 'newest', label: 'Newest' }];

type Settings = { provider: SearchProvider; mode: SearchMode; ready: boolean; onProvider: (value: SearchProvider) => void; onMode: (value: SearchMode) => void };

function SettingSelect({ label, value, options, disabled, onChange, className }: { label: string; value: string; options: Array<{ value: string; label: string }>; disabled: boolean; onChange: (value: string) => void; className?: string }) {
  const id = useId();
  return <div className={className}>
    <Label htmlFor={id} className="sr-only">{label}</Label>
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="min-h-11 w-full min-w-0"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

export function ServiceSelects({ provider, mode, ready, onProvider, onMode }: Settings) {
  return <>
    <SettingSelect className="desktop-setting" label="Search method" value={mode} disabled={!ready} options={methods} onChange={value => onMode(value as SearchMode)} />
    <SettingSelect className="desktop-setting" label="Search service" value={provider} disabled={!ready} options={providers} onChange={value => onProvider(value as SearchProvider)} />
  </>;
}

export function SearchSettingsMenu({ provider, mode, ready, onProvider, onMode, className, children }: Settings & { className: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className={className}><DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11" disabled={!ready} aria-label="Search service and method"><Settings2 aria-hidden="true" />{children}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuLabel>Search service</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={provider} onValueChange={value => { setOpen(false); onProvider(value as SearchProvider); }}>
        {providers.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Search method</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={value => { setOpen(false); onMode(value as SearchMode); }}>
        {methods.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu></div>;
}

export function SortSelect({ value, onChange, ready, className }: { value: SearchSort; onChange: (value: SearchSort) => void; ready: boolean; className: string }) {
  return <SettingSelect className={className} label="Sort results" value={value} disabled={!ready} options={sorts} onChange={value => onChange(value as SearchSort)} />;
}
