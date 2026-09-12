import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

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
  url: string | null;
  onClose: () => void;
}

export default function BillPdfModal({ url, onClose }: BillPdfModalProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(560);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setNumPages(null);
    setPageNumber(1);
    setError(null);
  }, [url]);

  // Fill the actual available width (full-screen on mobile, capped on
  // desktop) instead of a fixed pixel width — a hardcoded width rendered
  // far too small to read on a phone screen.
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0) setPageWidth(Math.min(width - 16, 900));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, close]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="View Bill"
      onClick={close}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden border border-appborder bg-appsurface-raised shadow-[0_20px_60px_var(--appshadow)] sm:h-auto sm:max-h-[90vh] sm:w-full sm:max-w-3xl sm:rounded-[24px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-appborder p-4">
          <h3 className="text-lg font-semibold tracking-[-0.02em] text-apptext">Bill</h3>
          <div className="flex items-center gap-2">
            <a
              href={url}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-appaccent-text transition-colors hover:bg-appinset"
            >
              Open raw PDF
            </a>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="shrink-0 rounded-lg p-1.5 text-apptext-muted transition-colors hover:bg-appinset hover:text-apptext"
            >
              ✕
            </button>
          </div>
        </div>

        <div ref={viewerRef} className="flex-1 overflow-auto bg-appinset p-2 sm:p-4">
          {error ? (
            <p className="text-sm text-apptext-muted">
              Couldn't render this PDF inline ({error}). Try "Open raw PDF" above.
            </p>
          ) : (
            <Document
              file={url}
              onLoadSuccess={({ numPages: n }) => setNumPages(n)}
              onLoadError={(e) => setError(e.message)}
              loading={<p className="text-sm text-apptext-muted">Loading bill…</p>}
            >
              <Page pageNumber={pageNumber} width={pageWidth} />
            </Document>
          )}
        </div>

        {numPages && numPages > 1 && (
          <div className="flex items-center justify-center gap-4 border-t border-appborder p-3">
            <button
              type="button"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-appborder px-3 py-1.5 text-sm text-apptext-soft transition-colors hover:bg-appinset disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-sm text-apptext-muted">
              Page {pageNumber} of {numPages}
            </span>
            <button
              type="button"
              disabled={pageNumber >= numPages}
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              className="rounded-lg border border-appborder px-3 py-1.5 text-sm text-apptext-soft transition-colors hover:bg-appinset disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
