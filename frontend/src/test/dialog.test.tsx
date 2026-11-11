import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDialog, Dialog, useConfirm } from '../components/ui/Dialog';

function Opener({ closeOnBackdrop, onClose }: { closeOnBackdrop?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Add a record</button>
      <Dialog
        open={open}
        onClose={() => { onClose?.(); setOpen(false); }}
        title="Add a record"
        subtitle="Saved to Maintenance"
        closeOnBackdrop={closeOnBackdrop}
        footer={<button type="button" onClick={() => setOpen(false)}>Save record</button>}
      >
        <label>Job title <input /></label>
      </Dialog>
    </>
  );
}

const openIt = () => fireEvent.click(screen.getByRole('button', { name: 'Add a record' }));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

describe('Dialog (B-043, B-008)', () => {
  it('is a modal dialog named by its title and described by its subtitle', () => {
    render(<Opener />);
    openIt();
    const dialog = screen.getByRole('dialog', { name: 'Add a record' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Saved to Maintenance');
    // Rendered on the body through a portal, clear of the page's scroll box.
    expect(dialog.closest('.fp-dialog')?.parentElement).toBe(document.body);
  });

  it('takes focus, and gives it back to the opener when it closes', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Add a record' });
    opener.focus();
    openIt();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps Tab inside', async () => {
    render(<Opener />);
    openIt();
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save record' });
    await waitFor(() => expect(close).toHaveFocus());
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    openIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on a backdrop tap, but not on a tap inside the panel', () => {
    render(<Opener />);
    openIt();
    fireEvent.click(screen.getByRole('textbox'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores the backdrop when a form opts out', () => {
    render(<Opener closeOnBackdrop={false} />);
    openIt();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on the phone back gesture instead of leaving the page', async () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    openIt();
    // useBackToClose adds its history entry a tick after opening.
    await act(() => new Promise((r) => setTimeout(r, 5)));
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops the page behind from scrolling while open (screens without touch)', () => {
    render(<Opener />);
    openIt();
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('a dialog over a dialog', () => {
  function Nested({ onOuter, onInner }: { onOuter: () => void; onInner: () => void }) {
    const [inner, setInner] = useState(false);
    return (
      <Dialog open onClose={onOuter} title="Run details">
        <button type="button" onClick={() => setInner(true)}>Rename</button>
        <Dialog open={inner} onClose={() => { onInner(); setInner(false); }} title="Rename room" size="narrow">
          <input aria-label="Name" />
        </Dialog>
      </Dialog>
    );
  }

  it('lets only the top one answer Escape and Back', async () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<Nested onOuter={onOuter} onInner={onInner} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('dialog', { name: 'Rename room' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await act(() => new Promise((r) => setTimeout(r, 5)));
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(onInner).toHaveBeenCalledTimes(2);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it("doesn't close the outer one when the inner one drops its history entry", async () => {
    const onOuter = vi.fn();
    render(<Nested onOuter={onOuter} onInner={() => {}} />);
    await act(() => new Promise((r) => setTimeout(r, 5)));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await act(() => new Promise((r) => setTimeout(r, 5)));
    // Closed with a key: useBackToClose calls history.back() for the inner entry. Wait for
    // that pop to arrive (jsdom delivers it a task or more later).
    let pops = 0;
    const count = () => { pops++; };
    window.addEventListener('popstate', count);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(pops).toBe(1));
    window.removeEventListener('popstate', count);
    await act(() => new Promise((r) => setTimeout(r, 5)));
    expect(onOuter).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Run details' })).toBeInTheDocument();
    // A real Back now closes the outer one.
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(onOuter).toHaveBeenCalledTimes(1);
  });

  it('renders the inner dialog inside the outer panel, so their focus traps agree', () => {
    render(<Nested onOuter={() => {}} onInner={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const outer = screen.getByRole('dialog', { name: 'Run details' });
    expect(outer).toContainElement(screen.getByRole('dialog', { name: 'Rename room' }));
  });
});

describe('ConfirmDialog', () => {
  it('asks, with Cancel focused first so Enter never destroys by accident', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete this record?" confirmLabel="Delete record" tone="danger" onConfirm={onConfirm} onCancel={onCancel}>
        It can't be undone.
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this record?' });
    expect(dialog).toHaveTextContent("It can't be undone.");
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('holds still while busy', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open busy busyLabel="Deleting…" title="Delete?" confirmLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is described by its message, so a screen reader hears the consequence, not just the title', () => {
    render(
      <ConfirmDialog open title="Expire every guest?" confirmLabel="Expire all" tone="danger" onConfirm={() => {}} onCancel={() => {}}>
        All 4 guests lose Wi-Fi now.
      </ConfirmDialog>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Expire every guest?' })).toHaveAccessibleDescription('All 4 guests lose Wi-Fi now.');
  });

  it('has no description when there is no message', () => {
    render(<ConfirmDialog open title="Saved" confirmLabel="Got it" cancelLabel={null} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('alertdialog')).not.toHaveAttribute('aria-describedby');
  });

  it('works as an acknowledgement with one key', () => {
    render(<ConfirmDialog open title="Saved" confirmLabel="Got it" cancelLabel={null} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
  });
});

describe('useConfirm', () => {
  function Page({ onResult }: { onResult: (ok: boolean) => void }) {
    const [confirm, dialog] = useConfirm();
    return (
      <>
        <button
          type="button"
          onClick={async () => {
            onResult(await confirm({ title: 'Expire every guest?', confirmLabel: 'Expire all', tone: 'danger' }));
          }}
        >
          Expire all guests
        </button>
        {dialog}
      </>
    );
  }

  it('resolves true on confirm and false on cancel', async () => {
    const onResult = vi.fn();
    render(<Page onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expire all guests' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Expire all' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expire all guests' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
  });
});
