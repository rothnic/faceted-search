import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { SearchHit } from '@/lib/search';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

const Summary = memo(function Summary({ hit }: { hit: SearchHit }) {
  return <>
    <CardHeader>
      <div className="result-topline flex items-center justify-between gap-3"><CardTitle className="text-2xl tabular-nums">{money(hit.price)}</CardTitle><Badge variant="secondary">{label(hit.listingStatus)}</Badge></div>
      <CardTitle role="heading" aria-level={3}>{hit.title}</CardTitle>
      <CardDescription>{hit.city}{hit.neighborhood ? ` · ${hit.neighborhood}` : ''}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span>{hit.bedrooms} bd</span><span>{hit.bathrooms} ba</span><span>{hit.squareFeet.toLocaleString()} sqft</span>{hit.distanceMiles !== undefined && <span>{hit.distanceMiles.toFixed(1)} mi</span>}</div>
      <CardDescription className="line-clamp-2">{hit.description}</CardDescription>
    </CardContent>
  </>;
});

export default function ResultCard({ hit, selected, onSelect, onMap, onAmenity, ready, returnTo }: {
  hit: SearchHit; selected: boolean; ready: boolean; returnTo: string;
  onSelect: () => void; onMap: () => void; onAmenity: (value: string) => void;
}) {
  return <Card className={`result-card gap-0 overflow-hidden py-0 shadow-none ${selected ? 'border-primary' : ''}`} data-house-id={hit.id}>
    <a data-slot="result-link" className="result-select block space-y-3 rounded-t-xl py-4 outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      href={`/homes/${encodeURIComponent(hit.id)}?returnTo=${encodeURIComponent(returnTo)}`}
      onClick={event => { if (!ready || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onSelect(); }}
      aria-haspopup={ready ? 'dialog' : undefined} aria-label={`View details: ${hit.title}`}>
      <Summary hit={hit} />
    </a>
    <CardFooter className="flex flex-wrap items-center justify-between gap-2 pb-4 pt-0">
      <div className="flex flex-wrap gap-1">{hit.amenities.slice(0, 4).map(item => <Button size="xs" variant="secondary" type="button" disabled={!ready} key={item} onClick={() => onAmenity(item)}>{label(item)}</Button>)}</div>
      <Button size="sm" variant="ghost" type="button" disabled={!ready} onClick={onMap}>Show on map</Button>
    </CardFooter>
  </Card>;
}
