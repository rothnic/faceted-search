'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SearchResponse } from '@/lib/search';

export default function DiagnosticsDialog({ response, onClose, returnFocus }: { response: SearchResponse; onClose: () => void; returnFocus: HTMLElement | null }) {
  const p = response.provenance;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="diagnostics-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.focus({ preventScroll: true }); }}>
      <DialogHeader>
        <DialogTitle>Request details</DialogTitle>
        <DialogDescription>Last completed search request. These timings do not measure page load or typing-to-paint time.</DialogDescription>
        <Button variant="outline" type="button" aria-label="Close request details" onClick={onClose}>Close</Button>
      </DialogHeader>
    <div className="backend-provenance">
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
        {response.browserFetchMs !== undefined && <><dt>Browser fetch and response parsing</dt><dd>{response.browserFetchMs} ms</dd></>}
        {response.gatewayTimingMs !== undefined && <><dt>Gateway request</dt><dd>{response.gatewayTimingMs} ms</dd></>}
        {p && <><dt>API service</dt><dd>{p.timing.apiMs} ms</dd><dt>Search operation</dt><dd>{p.timing.searchMs} ms</dd><dt>Selected provider</dt><dd>{p.selectedProvider}</dd><dt>Responding provider</dt><dd>{p.respondingProvider}</dd><dt>Execution</dt><dd>{p.execution}</dd><dt>Dataset</dt><dd>{p.dataset.id}</dd><dt>Source records</dt><dd>{p.dataset.count.toLocaleString()} · PostgreSQL</dd><dt>Database fingerprint</dt><dd>{p.dataset.databaseFingerprint}</dd><dt>Revision</dt><dd>{p.dataset.revision}</dd><dt>Observed</dt><dd>{p.observedAt}</dd></>}
        <dt>Matching records</dt><dd>{response.totalHits.toLocaleString()}</dd><dt>Total inventory</dt><dd>{response.totalInventory == null ? 'Unavailable' : response.totalInventory.toLocaleString()}</dd>
      </dl>
    </div>
    </DialogContent>
  </Dialog>;
}
