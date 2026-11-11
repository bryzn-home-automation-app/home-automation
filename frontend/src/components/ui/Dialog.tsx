import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useScrollLock } from '../../hooks/useScrollLock';
import { Button, IconButton, type ButtonVariant } from './Button';
import { cx } from './cx';

/*
 * The one dialog (it replaces 19 hand-built ones). A sheet from the bottom on a phone, centred
 * from 640px, on the kit's opaque panel (B-008), with everything the app's dialogs have had
 * to learn one at a time (B-043):
 *
 *   - role="dialog", aria-modal, labelled by its title (and described by `description`);
 *   - focus moves in, Tab stays in (useFocusTrap), and returns to whatever opened it on close;
 *   - Escape closes; so does the phone's back gesture (useBackToClose), instead of leaving the page;
 *   - the page behind can't scroll (useScrollLock), the body scrolls inside the dialog, and the
 *     panel never outgrows the screen (dvh max-height, safe-area padding);
 *   - a tap on the backdrop closes it, unless `closeOnBackdrop={false}` (a form with typing in it).
 *
 * It renders into document.body through a portal, so a transformed or scrolling ancestor (the
 * page scroller, PullToRefresh) can't clip or shift it. A dialog opened from inside another
 * renders inside its parent's panel, so the parent's focus trap and the child's agree, and only
 * the top dialog answers Escape and Back.
 *
 *   <Dialog open={open} onClose={close} title="Add a record" eyebrow="Maintenance"
 *     footer={<><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="primary" onClick={save}>Save record</Button></>}>
 *     …form…
 *   </Dialog>
 */

export type DialogSize = 'narrow' | 'default' | 'wide';

export interface DialogProps {
  open: boolean;
  /** Called for the close key, Escape, Back, and a backdrop tap. */
  onClose: () => void;
  /** The dialog's name (shown as its heading). */
  title: ReactNode;
  /** A silk-screen label above the title (the page it belongs to). */
  eyebrow?: ReactNode;
  /** One line under the title. Also describes the dialog to screen readers. */
  subtitle?: ReactNode;
  /**
   * The id of the element that describes the dialog, when that isn't the subtitle (a
   * ConfirmDialog's message is in the body). Wins over `subtitle`.
   */
  describedBy?: string;
  /** narrow 440 (confirmations) · default 600 · wide 880 (players, documents). */
  size?: DialogSize;
  /** The whole screen on a phone (players, documents, long forms); centred from 640px as usual. */
  fullOnPhone?: boolean;
  /** Default true. Set false while a form holds unsaved input, so a stray tap can't lose it. */
  closeOnBackdrop?: boolean;
  /** Extra header keys, left of the close key (IconButtons). */
  tools?: ReactNode;
  /** The action row. Put the primary last (rightmost on desktop). */
  footer?: ReactNode;
  /** Spread the footer (Older / Download / Newer). */
  footerSplit?: boolean;
  /** An enamel backdrop for the body (document viewers). */
  wellBody?: boolean;
  /** What gets focus first (default: the first focusable, usually the close key). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** "alertdialog" for a confirmation that interrupts. */
  role?: 'dialog' | 'alertdialog';
  /** The close key's name. */
  closeLabel?: string;
  /** Hide the close key (a ConfirmDialog has its own Cancel). */
  hideClose?: boolean;
  bodyClassName?: string;
  className?: string;
  children?: ReactNode;
}

// Dialogs open now, oldest first: only the last one answers Escape and Back.
const openStack: string[] = [];

/*
 * Back with two dialogs open. Each open dialog holds a history entry (useBackToClose) and
 * listens for popstate, and every listener hears every pop. So:
 *   - a real Back closes only the top dialog (the others see they aren't on top);
 *   - a dialog closed any other way while another stays open calls history.back() to drop its
 *     own entry, and that pop must not close the dialog underneath. It is counted in
 *     `pendingSkips`, and the first listener to hear the pop marks the whole dispatch as
 *     skipped (all listeners run in the same task, before the timeout clears the mark).
 */
let pendingSkips = 0;
let skippingThisPop = false;
function shouldSkipPop(): boolean {
  if (!skippingThisPop && pendingSkips > 0) {
    pendingSkips--;
    skippingThisPop = true;
    window.setTimeout(() => { skippingThisPop = false; }, 0);
  }
  return skippingThisPop;
}
// A nested dialog renders inside its parent's panel (see the header).
const ParentPanel = createContext<HTMLElement | null>(null);

export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  describedBy,
  size = 'default',
  fullOnPhone,
  closeOnBackdrop = true,
  tools,
  footer,
  footerSplit,
  wellBody,
  initialFocusRef,
  role = 'dialog',
  closeLabel = 'Close',
  hideClose,
  bodyClassName,
  className,
  children,
}: DialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const subId = `${uid}-sub`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const parentPanel = useContext(ParentPanel);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const isTop = useCallback(() => openStack[openStack.length - 1] === uid, [uid]);
  const closeIfTop = useCallback(() => { if (isTop()) closeRef.current(); }, [isTop]);
  // Set once useBackToClose has pushed this dialog's history entry; set when Back closed it.
  const holdsEntry = useRef(false);
  const closedByBack = useRef(false);
  const onBack = useCallback(() => {
    if (shouldSkipPop() || !isTop()) return;
    closedByBack.current = true;
    closeRef.current();
  }, [isTop]);

  // Join the stack before the hooks below can see a key press or a Back.
  useLayoutEffect(() => {
    if (!open) return;
    openStack.push(uid);
    closedByBack.current = false;
    return () => {
      const i = openStack.lastIndexOf(uid);
      if (i >= 0) openStack.splice(i, 1);
      // Closed by a key or a tap while another dialog stays open: our entry's back() is coming.
      if (holdsEntry.current && !closedByBack.current && openStack.length > 0) pendingSkips++;
      // The last one closed: nothing is left to protect, and a count left over (its pop came
      // after the dialog underneath had closed too) must not swallow a later, real Back.
      if (openStack.length === 0) pendingSkips = 0;
      holdsEntry.current = false;
    };
  }, [open, uid]);

  // Focus return. Captured as the dialog opens and restored when it closes or unmounts (a
  // dialog is often removed rather than closed, which useFocusTrap's own return can't see).
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener && opener.isConnected && opener !== document.body) {
        window.setTimeout(() => opener.focus(), 0);
      }
    };
  }, [open]);

  useScrollLock(open);
  useFocusTrap(open, panelRef, undefined, closeIfTop);
  useBackToClose(onBack, open);

  // Both wait a tick, queued after useFocusTrap's and useBackToClose's own: the chosen first
  // focus wins over the trap's default, and the history entry exists by then.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      holdsEntry.current = true;
      initialFocusRef?.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, initialFocusRef]);

  // Stable, so React doesn't detach and re-attach it on every render.
  const setPanelRef = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el;
    setPanel(el);
  }, []);

  if (!open) return null;

  const dialog = (
    <div
      className={cx('fp-dialog', size !== 'default' && `fp-dialog--${size}`, fullOnPhone && 'fp-dialog--full', className)}
      onClick={(e) => {
        // Only a tap on the scrim itself; a tap inside the panel bubbles here too.
        if (closeOnBackdrop && e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={setPanelRef}
        className="fp-dialog-panel"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy ?? (subtitle != null ? subId : undefined)}
      >
        <header className="fp-dialog-head">
          <div className="fp-dialog-heading">
            {eyebrow != null && <p className="fp-label">{eyebrow}</p>}
            <h2 className="fp-dialog-title" id={titleId}>{title}</h2>
            {subtitle != null && <p className="fp-dialog-sub" id={subId}>{subtitle}</p>}
          </div>
          {(tools != null || !hideClose) && (
            <div className="fp-dialog-tools">
              {tools}
              {!hideClose && <IconButton icon="x" variant="quiet" label={closeLabel} onClick={() => closeRef.current()} />}
            </div>
          )}
        </header>
        <div className={cx('fp-dialog-body', wellBody && 'fp-dialog-body--well', bodyClassName)}>
          <ParentPanel.Provider value={panel}>{children}</ParentPanel.Provider>
        </div>
        {footer != null && (
          <footer className={cx('fp-dialog-foot', footerSplit && 'fp-dialog-foot--split')}>
            <ParentPanel.Provider value={panel}>{footer}</ParentPanel.Provider>
          </footer>
        )}
      </div>
    </div>
  );

  return createPortal(dialog, parentPanel ?? document.body);
}

// ─── ConfirmDialog ──────────────────────────────────────────────────────

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** What will happen, plainly ("Mai changed Upstairs 4 minutes ago."). */
  children?: ReactNode;
  /** The verb that does it ("Delete record", "Change anyway"). Never "OK". */
  confirmLabel: string;
  /** null for an acknowledgement with one key (a window.alert replacement). */
  cancelLabel?: string | null;
  /** danger draws the destructive key. */
  tone?: 'default' | 'danger';
  /** Working on it: the confirm key shows `busyLabel` and the dialog stays open. */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  /** Cancel, Escape, Back and the backdrop. */
  onCancel: () => void;
  eyebrow?: ReactNode;
}

/**
 * A question before an action: the replacement for window.confirm (and, with
 * `cancelLabel={null}`, window.alert). Narrow, an alertdialog, Cancel focused first so Enter
 * never destroys by accident.
 */
export function ConfirmDialog({
  open, title, children, confirmLabel, cancelLabel = 'Cancel', tone = 'default', busy, busyLabel, onConfirm, onCancel, eyebrow,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // An alertdialog must say what it is about to do, not just its title: focus lands on Cancel,
  // so without this a screen reader never reads the consequence.
  const msgId = useId();
  const variant: ButtonVariant = tone === 'danger' ? 'danger' : 'primary';
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      eyebrow={eyebrow}
      size="narrow"
      role="alertdialog"
      describedBy={children != null ? msgId : undefined}
      hideClose
      initialFocusRef={cancelLabel === null ? confirmRef : cancelRef}
      footer={
        <>
          {cancelLabel !== null && (
            <Button ref={cancelRef} variant="quiet" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          )}
          <Button ref={confirmRef} variant={variant} onClick={onConfirm} busy={busy} busyLabel={busyLabel}>{confirmLabel}</Button>
        </>
      }
    >
      {children != null && <div className="fp-prose" id={msgId}>{children}</div>}
    </Dialog>
  );
}

// ─── useConfirm ─────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string | null;
  tone?: 'default' | 'danger';
}

/**
 * window.confirm as a promise, drawn as a ConfirmDialog:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (await confirm({ title: 'Delete this record?', confirmLabel: 'Delete record', tone: 'danger' })) remove();
 *   …
 *   return <>{page}{confirmDialog}</>;
 *
 * Resolves false on Cancel, Escape, Back or the backdrop (and if the component unmounts).
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        setPending({ ...opts, resolve });
      }),
    [],
  );
  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const element = (
    <ConfirmDialog
      open={pending != null}
      title={pending?.title ?? ''}
      confirmLabel={pending?.confirmLabel ?? 'OK'}
      cancelLabel={pending?.cancelLabel}
      tone={pending?.tone}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    >
      {pending?.message}
    </ConfirmDialog>
  );
  return [confirm, element];
}
