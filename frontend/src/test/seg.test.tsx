import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Seg, SegPanel, useSearchParamState, type SegOption } from '../components/ui/Seg';

const VIEWS: SegOption<'electric' | 'gas' | 'water'>[] = [
  { value: 'electric', label: 'Electric' },
  { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Water' },
];

function Tabs({ initial = 'electric' as 'electric' | 'gas' | 'water', disabledGas = false }) {
  const [view, setView] = useState(initial);
  const options = VIEWS.map((o) => (o.value === 'gas' ? { ...o, disabled: disabledGas } : o));
  return (
    <>
      <Seg id="utility-view" label="Utility" value={view} onChange={setView} options={options} />
      <SegPanel id="utility-view" value={view}>
        <p>{view} view</p>
      </SegPanel>
    </>
  );
}

describe('Seg as tabs (B-074)', () => {
  it('is a named tablist whose selected tab controls a labelled panel', () => {
    render(<Tabs />);
    expect(screen.getByRole('tablist', { name: 'Utility' })).toBeInTheDocument();
    const electric = screen.getByRole('tab', { name: 'Electric' });
    expect(electric).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Gas' })).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: 'Electric' });
    expect(electric).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('electric view');
  });

  it('keeps only the selected tab in the Tab order', () => {
    render(<Tabs initial="gas" />);
    expect(screen.getByRole('tab', { name: 'Gas' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Electric' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Water' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves with the arrow keys, Home and End, wrapping, and focus follows', () => {
    render(<Tabs />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Gas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Gas' })).toHaveFocus();
    fireEvent.keyDown(list, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Water' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Electric' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Water' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Electric' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('electric view');
  });

  it('skips a disabled key', () => {
    render(<Tabs disabledGas />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Water' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects on click', () => {
    render(<Tabs />);
    fireEvent.click(screen.getByRole('tab', { name: 'Water' }));
    expect(screen.getByRole('tabpanel', { name: 'Water' })).toHaveTextContent('water view');
  });
});

describe('Seg as a radio group', () => {
  it('uses aria-checked and no tab panels', () => {
    function Mode() {
      const [mode, setMode] = useState<'heat' | 'cool'>('heat');
      return <Seg kind="radio" label="Mode" value={mode} onChange={setMode} options={[{ value: 'heat', label: 'Heat' }, { value: 'cool', label: 'Cool' }]} />;
    }
    render(<Mode />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Heat' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Heat' })).not.toHaveAttribute('aria-controls');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'Cool' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('useSearchParamState (B-075)', () => {
  function UrlTabs() {
    const [view, setView] = useSearchParamState('view', ['electric', 'gas', 'water'] as const, 'electric');
    const location = useLocation();
    return (
      <>
        <Seg id="u" label="Utility" value={view} onChange={setView} options={VIEWS} />
        <output data-testid="url">{location.search}</output>
      </>
    );
  }
  const at = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <UrlTabs />
      </MemoryRouter>,
    );

  it('starts on the view in the URL, so a reload or Back lands where you were', () => {
    at('/utility?view=water');
    expect(screen.getByRole('tab', { name: 'Water' })).toHaveAttribute('aria-selected', 'true');
  });

  it('writes the choice to the URL, keeps other params, and leaves the default out', () => {
    at('/utility?from=home');
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Gas' })); });
    expect(screen.getByTestId('url').textContent).toBe('?from=home&view=gas');
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Electric' })); });
    expect(screen.getByTestId('url').textContent).toBe('?from=home');
  });

  it('falls back to the default for an unknown value', () => {
    at('/utility?view=steam');
    expect(screen.getByRole('tab', { name: 'Electric' })).toHaveAttribute('aria-selected', 'true');
  });
});
