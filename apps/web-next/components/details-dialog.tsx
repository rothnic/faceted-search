'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SearchHit } from '@/lib/search';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

export default function DetailsDialog({ hit: loadedHit, id, onClose, onMap, returnFocus }: {
  hit: SearchHit | null;
  id: string;
  onClose: () => void;
  onMap: () => void;
  returnFocus: HTMLElement | null;
}) {
  const position = useRef<{ y: number; listY: number; width: number; height: number } | null>(null);
  const [fetchedHit, setFetchedHit] = useState<SearchHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const hit = loadedHit ?? fetchedHit;
  useEffect(() => {
    if (loadedHit) return;
    const controller = new AbortController();
    setError(null);
    setFetchedHit(null);
    void fetch(`/api/houses/${encodeURIComponent(id)}`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Home details are unavailable.');
      if (!controller.signal.aborted) setFetchedHit(body.house);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Home details are unavailable.');
    });
    return () => controller.abort();
  }, [id, loadedHit, retry]);
  useEffect(() => {
    position.current = { y: window.scrollY, listY: document.querySelector('.result-list')?.scrollTop ?? 0, width: innerWidth, height: innerHeight };
  }, []);
  const restoreFocus = () => {
    const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>('[data-testid=results-heading]');
    const map = document.querySelector<HTMLElement>('.results-workspace[data-view="map"] .map-column');
    if (map) { map.focus({ preventScroll: true }); return; }
    target?.focus({ preventScroll: true });
    const saved = position.current;
    if (!saved) return;
    if (saved.width !== innerWidth || saved.height !== innerHeight) target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    else { document.querySelector('.result-list')?.scrollTo(0, saved.listY); window.scrollTo(0, saved.y); }
  };

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="home-details max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader className="flex flex-row items-center justify-between text-left">
        <div className="space-y-2"><DialogTitle>Home details</DialogTitle><DialogDescription>Listing information from the search service.</DialogDescription></div>
        <Button variant="ghost" size="icon" type="button" className="min-h-11 min-w-11" onClick={onClose} aria-label="Close home details"><X aria-hidden="true" /></Button>
      </DialogHeader>
      {hit ? <Card className="gap-4 border-0 py-0 shadow-none">
        <CardHeader className="px-0">
          <div className="flex items-center justify-between gap-2"><CardTitle className="text-2xl">{money(hit.price)}</CardTitle><Badge variant="secondary">{label(hit.listingStatus)}</Badge></div>
          <CardTitle role="heading" aria-level={3}>{hit.title}</CardTitle>
          <CardDescription>{hit.city}{hit.neighborhood ? ` · ${hit.neighborhood}` : ''}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 px-0">
          <dl className="grid grid-cols-2 gap-4 text-sm">{[['Bedrooms', hit.bedrooms], ['Bathrooms', hit.bathrooms], ['Living area', `${hit.squareFeet.toLocaleString()} sqft`], ['Home type', label(hit.propertyType)]].map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
          <section className="space-y-2"><CardTitle role="heading" aria-level={4}>About this home</CardTitle><CardDescription className="leading-relaxed">{hit.description}</CardDescription></section>
          {hit.amenities.length > 0 && <section className="space-y-2"><CardTitle role="heading" aria-level={4}>Features</CardTitle><ul className="flex flex-wrap gap-2">{hit.amenities.map(amenity => <li key={amenity}><Badge variant="secondary">{label(amenity)}</Badge></li>)}</ul></section>}
        </CardContent>
        <CardFooter className="px-0"><Button type="button" onClick={onMap}>Show on map</Button></CardFooter>
      </Card> : <div role={error ? 'alert' : 'status'} className="space-y-3"><p>{error ?? 'Loading home…'}</p>{error && <Button variant="outline" type="button" onClick={() => setRetry(value => value + 1)}>Retry details</Button>}</div>}
    </DialogContent>
  </Dialog>;
}
