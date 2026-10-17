'use client';

import { useEffect, useRef } from 'react';
import type { SearchResponse } from '@/lib/search';
import './diagnostics-dialog.css';

export default function DiagnosticsDialog({ response, onClose, returnFocus }: { response: SearchResponse; onClose: () => void; returnFocus: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; returnFocus?.focus({ preventScroll: true }); };
  }, [returnFocus]);
  const p = response.provenance;
  return <dialog ref={dialog} className="diagnostics-dialog" aria-labelledby="diagnostics-title" onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus(); } }} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id="diagnostics-title">Request details</h2><button type="button" className="compact-close" autoFocus aria-label="Close request details" onClick={onClose}><span aria-hidden="true">×</span></button></header>
    <div className="diagnostics-content backend-provenance">
      <p>Last completed search request. These timings do not measure page load or typing-to-paint time.</p>
      <dl>
        {response.browserFetchMs !== undefined && <><dt>Browser fetch and response parsing</dt><dd>{response.browserFetchMs} ms</dd></>}
        {response.gatewayTimingMs !== undefined && <><dt>Gateway request</dt><dd>{response.gatewayTimingMs} ms</dd></>}
        {p && <><dt>API service</dt><dd>{p.timing.apiMs} ms</dd><dt>Search operation</dt><dd>{p.timing.searchMs} ms</dd><dt>Selected provider</dt><dd>{p.selectedProvider}</dd><dt>Responding provider</dt><dd>{p.respondingProvider}</dd><dt>Execution</dt><dd>{p.execution}</dd><dt>Dataset</dt><dd>{p.dataset.id}</dd><dt>Source records</dt><dd>{p.dataset.count.toLocaleString()} · PostgreSQL</dd><dt>Database fingerprint</dt><dd>{p.dataset.databaseFingerprint}</dd><dt>Revision</dt><dd>{p.dataset.revision}</dd><dt>Observed</dt><dd>{p.observedAt}</dd></>}
        <dt>Matching records</dt><dd>{response.totalHits.toLocaleString()}</dd><dt>Total inventory</dt><dd>{response.totalInventory == null ? 'Unavailable' : response.totalInventory.toLocaleString()}</dd>
      </dl>
    </div>
  </dialog>;
}
