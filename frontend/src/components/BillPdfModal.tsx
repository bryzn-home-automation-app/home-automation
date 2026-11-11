import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { fetchBillPdf } from '../api/coservBills';
import { Button, Dialog, ErrorState, ExternalButton, Loading, SkelBlock } from './ui';

// Firefox for iOS (and some other mobile browsers) doesn't honor the HTML
// `download` attribute and intercepts direct PDF navigation into a broken
// download handler — a link/anchor to the PDF just does nothing on those
// browsers. Rendering the PDF ourselves via pdf.js sidesteps the browser's
// download/navigation decision entirely, so it works identically everywhere.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface BillPdfModalProps {
  /** The bill's stored `pdfPath` (e.g. "bills/…pdf"); null = closed. */
  pdfPath: string | null;
  onClose: () => void;
  /** The dialog's heading ("CoServ statement, Oct 7 – Nov 5"). */
  title?: string;
  /** One line under it ("Electric and gas · due Mon, Nov 30"). */
  subtitle?: string;
}

/**
 * The bill viewer: the kit Dialog (full screen on a phone, wide and centred from 640px) with
 * the PDF drawn by pdf.js on the enamel well. A download that fails says so and offers Try
 * again; "Open the PDF" only appears once there is a file to open (B-094).
 */
export default function BillPdfModal({ pdfPath, onClose, title = 'Bill', subtitle }: BillPdfModalProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  /** The download failed (network, missing file, not allowed). */
  const [loadFailed, setLoadFailed] = useState(false);
  /** The file arrived but pdf.js couldn't draw it. */
  const [renderFailed, setRenderFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pageWidth, setPageWidth] = useState(560);
  const [viewer, setViewer] = useState<HTMLDivElement | null>(null);

  // Bills aren't publicly served: fetch through the API (with the session), then
  // hand pdf.js the bytes and give "Open the PDF" a local blob URL.
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    setNumPages(null);
    setPageNumber(1);
    setLoadFailed(false);
    setRenderFailed(false);
    setPdf(null);
    if (!pdfPath) return;
    let cancelled = false;
    fetchBillPdf(pdfPath)
      .then((buf) => {
        if (cancelled) return;
        objectUrl.current = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        setRawUrl(objectUrl.current);
        setPdf(buf);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      setRawUrl(null);
    };
  }, [pdfPath, attempt]);

  // pdf.js transfers (detaches) the buffer it's given, so pass a copy; memoized
  // so re-renders don't reload the document.
  const file = useMemo(() => (pdf ? { data: new Uint8Array(pdf.slice(0)) } : null), [pdf]);

  // Fill the dialog body's width (full screen on a phone, capped on desktop)
  // instead of a fixed pixel width, which rendered far too small on a phone.
  useEffect(() => {
    if (!viewer) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setPageWidth(Math.min(width, 900));
    });
    ro.observe(viewer);
    return () => ro.disconnect();
  }, [viewer]);

  const loading = (
    <Loading label="Loading the bill">
      <SkelBlock height={480} />
    </Loading>
  );

  return (
    <Dialog
      open={pdfPath != null}
      onClose={onClose}
      eyebrow="Bill"
      title={title}
      subtitle={subtitle}
      size="wide"
      fullOnPhone
      wellBody
      tools={
        rawUrl ? (
          <ExternalButton href={rawUrl} size="sm" variant="quiet" aria-label="Open the PDF">
            <span className="fp-hide-phone">Open the PDF</span>
          </ExternalButton>
        ) : undefined
      }
      footerSplit
      footer={
        numPages && numPages > 1 ? (
          <>
            <Button size="sm" icon="chevron-left" disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span className="fp-mono fp-muted">Page {pageNumber} of {numPages}</span>
            <Button size="sm" iconEnd="chevron-right" disabled={pageNumber >= numPages} onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}>
              Next
            </Button>
          </>
        ) : undefined
      }
    >
      <div ref={setViewer} className="flex justify-center">
        {loadFailed ? (
          <ErrorState title="Couldn't load this bill" onRetry={() => setAttempt((n) => n + 1)}>
            The home server didn&rsquo;t send the file. Nothing was lost.
          </ErrorState>
        ) : renderFailed ? (
          <ErrorState title="Couldn't show this bill here">
            {rawUrl ? 'Open the PDF at the top to read it in your browser.' : 'The file may be damaged.'}
          </ErrorState>
        ) : !file ? (
          loading
        ) : (
          <Document
            file={file}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            onLoadError={() => setRenderFailed(true)}
            loading={loading}
          >
            {/* The bill is paper: white in both themes, with a hairline edge. */}
            <Page pageNumber={pageNumber} width={pageWidth} className="overflow-hidden rounded border border-[var(--appplate-edge)]" />
          </Document>
        )}
      </div>
    </Dialog>
  );
}
