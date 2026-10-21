'use client';

import { useId, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { activeFilterCount, type SearchFilters, type SearchResponse } from '@/lib/search';

const title = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

export default function FilterPanel({ filters, facets, definitions, onToggle, onRange, onClear, ready }: {
  filters: SearchFilters; facets: SearchResponse['facets']; definitions: SearchResponse['facetDefinitions'];
  onToggle: (key: string, value: string | number, checked: boolean) => void;
  onRange: (key: string, value: number | undefined) => void;
  onClear: () => void; ready: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return <Card className="filter-panel gap-4 border-0 py-4 shadow-none">
    <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
      <CardTitle role="heading" aria-level={2}>Refine results</CardTitle><Button variant="ghost" size="sm" type="button" disabled={!ready} onClick={onClear}>Clear all</Button>
    </CardHeader>
    <CardContent className="space-y-4 px-4">
      <fieldset disabled={!ready} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Price range</legend>
        <div className="grid grid-cols-2 gap-2">
          <Label className="sr-only" htmlFor={id + '-min'}>Minimum price</Label><Input id={id + '-min'} inputMode="numeric" type="number" min={0} placeholder="$0" value={typeof filters.minPrice === 'number' ? filters.minPrice : ''} onChange={event => onRange('minPrice', event.target.value === '' ? undefined : Number(event.target.value))} />
          <Label className="sr-only" htmlFor={id + '-max'}>Maximum price</Label><Input id={id + '-max'} inputMode="numeric" type="number" min={0} placeholder="No maximum" value={typeof filters.maxPrice === 'number' ? filters.maxPrice : ''} onChange={event => onRange('maxPrice', event.target.value === '' ? undefined : Number(event.target.value))} />
        </div>
      </fieldset>
      <Accordion type="multiple" defaultValue={['bedrooms', 'amenities']}>
        {(definitions ?? []).map(group => {
          const buckets = facets[group.key] ?? [];
          if (!buckets.length) return null;
          const selected = Array.isArray(filters[group.key]) ? filters[group.key] as Array<string | number> : [];
          return <AccordionItem data-facet={group.key} value={group.key} key={group.key}>
            <AccordionTrigger>{group.label}</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {(expanded[group.key] ? buckets : buckets.slice(0, 8)).map((bucket, index) => {
                  const value = group.valueType === 'number' ? Number(bucket.value) : bucket.value;
                  const control = `${id}-${group.key}-${index}`;
                  return <div className="facet-option flex min-h-9 items-center gap-2" data-facet-value={bucket.value} data-facet-count={bucket.count} key={bucket.value}>
                    <Checkbox id={control} disabled={!ready} checked={selected.some(item => String(item) === bucket.value)} onCheckedChange={checked => onToggle(group.key, value, checked === true)} />
                    <Label className="min-w-0 flex-1 cursor-pointer leading-normal" htmlFor={control}>{group.key === 'bedrooms' ? `${bucket.value} beds` : title(bucket.value)}</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">{bucket.count}</span>
                  </div>;
                })}
              </div>
              {buckets.length > 8 && <Button variant="ghost" size="sm" className="mt-2" type="button" onClick={() => setExpanded(current => ({ ...current, [group.key]: !current[group.key] }))}>{expanded[group.key] ? 'Show fewer' : `Show all ${buckets.length}`}</Button>}
            </AccordionContent>
          </AccordionItem>;
        })}
      </Accordion>
      {!definitions && <p className="text-sm text-muted-foreground" role="status">Filter configuration is unavailable from this search service.</p>}
      {activeFilterCount(filters) > 0 && <p className="text-sm text-muted-foreground">{activeFilterCount(filters)} active filters</p>}
    </CardContent>
  </Card>;
}
