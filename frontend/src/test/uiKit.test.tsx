import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  Avatar,
  avatarInk,
  Badge,
  Button,
  Checkbox,
  Chips,
  contrastRatio,
  Count,
  DataTable,
  Dial,
  Field,
  initials,
  Input,
  InstrumentPanel,
  Lamp,
  LampMatrix,
  Panel,
  Progress,
  QueryState,
  Readout,
  Readouts,
  Ring,
  Row,
  List,
  Select,
  ShareBar,
  Spark,
  Stepper,
  Switch,
  Timeline,
  Verdict,
  type QueryLike,
} from '../components/ui';
import { severityStatus } from '../utils/status';

const query = <T,>(over: Partial<QueryLike<T>>): QueryLike<T> => ({ data: undefined, isError: false, refetch: vi.fn(), ...over });

describe('QueryState: failed loads are never shown as empty (B-005, B-187)', () => {
  const body = (rows: string[]) => <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul>;

  it('shows a skeleton, announced once, while nothing has loaded', () => {
    render(<QueryState query={query<string[]>({})} what="the bills">{body}</QueryState>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the bills');
  });

  it('shows what failed and a working Try again when the first load fails', () => {
    const q = query<string[]>({ isError: true });
    render(<QueryState query={q} what="the bills" empty={<p>No bills yet</p>}>{body}</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the bills");
    expect(screen.queryByText('No bills yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('says what will appear when the data is empty (and a 204 null counts as empty)', () => {
    const { rerender } = render(<QueryState query={query<string[]>({ data: [] })} empty={<p>Bills appear a day after they arrive.</p>}>{body}</QueryState>);
    expect(screen.getByText('Bills appear a day after they arrive.')).toBeInTheDocument();
    rerender(<QueryState query={query<string[] | null>({ data: null })} empty={<p>Nothing yet</p>}>{(d) => body(d)}</QueryState>);
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });

  it('keeps the data on a failed refresh and adds a slim notice', () => {
    const q = query<string[]>({ data: ['Oct bill'], isError: true, dataUpdatedAt: Date.parse('2026-11-09T22:58:00Z') });
    render(<QueryState query={q} what="the bills">{body}</QueryState>);
    expect(screen.getByText('Oct bill')).toBeInTheDocument();
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent("Couldn't refresh the bills.");
    expect(notice.textContent?.replace(/ /g, ' ')).toContain('Showing what came in at 4:58 PM.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the data otherwise', () => {
    render(<QueryState query={query({ data: ['a', 'b'] })}>{body}</QueryState>);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('Avatar initials stay readable on any colour (B-158)', () => {
  it('picks ink or white, whichever contrasts more', () => {
    for (const pale of ['#34d399', '#FFD700', '#a78bfa', '#8bbdfa', '#f399ca', '#6cddb6']) {
      expect(avatarInk(pale)).toBe('#15181a');
      expect(contrastRatio(avatarInk(pale)!, pale)).toBeGreaterThanOrEqual(4.5);
    }
    for (const dark of ['#334155', '#1e3a8a', '#000000']) {
      expect(avatarInk(dark)).toBe('#ffffff');
      expect(contrastRatio(avatarInk(dark)!, dark)).toBeGreaterThanOrEqual(4.5);
    }
    expect(avatarInk('var(--appavatar-default)')).toBeNull();
  });

  it("writes initials by the shell's rule and sets the colours inline", () => {
    expect(initials('Bryan')).toBe('B');
    expect(initials('Mai Thi Tran')).toBe('MT');
    expect(initials('Danny Tran')).toBe('DT');
    expect(initials('  ')).toBe('?');
    render(<Avatar name="Mai" color="#f399ca" />);
    const img = screen.getByRole('img', { name: 'Mai' });
    expect(img).toHaveTextContent('M');
    expect(img.style.getPropertyValue('--fp-who')).toBe('#f399ca');
    expect(img.style.color).toBe('rgb(21, 24, 26)');
  });

  it('falls back to initials when the photo fails', () => {
    render(<Avatar name="Linh" photoUrl="/broken.jpg" />);
    const img = screen.getByRole('img', { name: 'Linh' });
    fireEvent.error(img.querySelector('img')!);
    expect(img).toHaveTextContent('L');
  });
});

describe('Field wires its label, help and error to the control (B-042)', () => {
  it('names and describes the input and marks it invalid', () => {
    render(
      <Field label="Cost" help="In dollars" error="Enter an amount like 38.97">
        <Input defaultValue="38.9.7" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Cost' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter an amount like 38.97 In dollars');
    expect(input).toHaveClass('fp-input');
  });

  it('works for selects too, and a valid field is not invalid', () => {
    render(
      <Field label="Category">
        <Select options={[{ value: 'hvac', label: 'HVAC' }]} />
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: 'Category' });
    expect(select).not.toHaveAttribute('aria-invalid');
  });

  it('labels a checkbox by its own text', () => {
    render(<Checkbox label="Daily report" help="Every morning" />);
    expect(screen.getByRole('checkbox', { name: /Daily report/ })).toBeInTheDocument();
  });
});

describe('toggles say their state (B-041)', () => {
  it('Chips: a labelled group of aria-pressed buttons, single choice', () => {
    function Range() {
      const [v, setV] = useState<'24h' | '7d'>('24h');
      return <Chips label="Range" value={v} onChange={setV} options={[{ value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }]} />;
    }
    render(<Range />);
    const group = screen.getByRole('group', { name: 'Range' });
    expect(within(group).getByRole('button', { name: '24 h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: '7 days' }));
    expect(within(group).getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: '24 h' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Chips: multiple choice toggles each', () => {
    const onChange = vi.fn();
    render(<Chips multiple label="Alert types" value={['rain']} onChange={onChange} options={[{ value: 'rain', label: 'Rain' }, { value: 'freeze', label: 'Freeze' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze' }));
    expect(onChange).toHaveBeenCalledWith(['rain', 'freeze']);
    fireEvent.click(screen.getByRole('button', { name: 'Rain' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Switch: role switch with aria-checked and its help as description', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Rain overnight" help="A heads-up at 8 PM" />);
    const sw = screen.getByRole('switch', { name: /Rain overnight/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription('A heads-up at 8 PM');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Switch bare: still named, by a string or by JSX', () => {
    const { rerender } = render(<Switch bare checked onChange={() => {}} label="Daily report" />);
    expect(screen.getByRole('switch', { name: 'Daily report' })).toHaveAttribute('aria-checked', 'true');
    rerender(<Switch bare checked onChange={() => {}} label={<>Daily report <em>New</em></>} />);
    expect(screen.getByRole('switch', { name: 'Daily report New' })).toBeInTheDocument();
  });

  it('Stepper: named keys that stop at the limits', () => {
    const onChange = vi.fn();
    render(<Stepper label="Heat to" value={85} max={85} min={60} onChange={onChange} unit="°" />);
    expect(screen.getByRole('group', { name: 'Heat to' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Raise heat to' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lower heat to' }));
    expect(onChange).toHaveBeenCalledWith(84);
  });
});

describe('Button', () => {
  it('is type=button and ignores taps while busy', () => {
    const onClick = vi.fn();
    render(<Button variant="primary" busy busyLabel="Saving…" onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: 'Saving…' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveClass('fp-btn', 'fp-btn--primary');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('status display', () => {
  it('Badge shows a mapped status as a lamp and a word', () => {
    render(<Badge status={severityStatus('WARNING')} />);
    const badge = screen.getByText('Heads-up');
    expect(badge).toHaveClass('fp-badge', 'fp-badge--warn');
  });

  it('a Lamp with no word beside it says its word', () => {
    render(<Lamp tone="problem" label />);
    expect(screen.getByText('Problem')).toHaveClass('fp-sr-only');
  });

  it('Count hides at zero and caps at 99+', () => {
    const { container, rerender } = render(<Count value={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Count value={120} label="120 unread" />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByText('120 unread')).toBeInTheDocument();
  });
});

describe('layout and data', () => {
  it('a titled Panel is a section named by its heading', () => {
    render(<Panel title="Recent alerts" subtitle="3 unread"><p>…</p></Panel>);
    expect(screen.getByRole('region', { name: 'Recent alerts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Recent alerts' })).toBeInTheDocument();
  });

  it('InstrumentPanel is named by its verdict, and its lamp says the status', () => {
    render(
      <MemoryRouter>
        <InstrumentPanel
          instrument={<Ring value={0.87} tone="ok" size={80} label="87% charged" />}
          verdict={<Verdict tone="headsup" note="Partly cloudy.">A few things need a look.</Verdict>}
          readouts={
            <Readouts>
              <Readout label="Yesterday" value="35.5" unit="kWh" note="9% over forecast" />
              <Readout label="Bill" value="$114" to="/utility" />
            </Readouts>
          }
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'A few things need a look.' })).toBeInTheDocument();
    expect(screen.getByText('Heads-up')).toHaveClass('fp-sr-only');
    expect(screen.getByRole('link', { name: /Bill/ })).toHaveAttribute('href', '/utility');
    expect(screen.getByRole('img', { name: '87% charged' })).toBeInTheDocument();
  });

  it('Row is a link, a button or static, and says unread', () => {
    render(
      <MemoryRouter>
        <List>
          <Row to="/maintenance" icon="wrench" title="Replace filters" meta="Sun, Nov 15" value="$38.97" />
          <Row onClick={() => {}} lamp="headsup" title="Driveway battery 27%" unread compact />
          <Row title="Static" />
        </List>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Replace filters/ })).toHaveAttribute('href', '/maintenance');
    expect(screen.getByRole('button', { name: /Driveway battery 27%.*Unread/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('DataTable labels every cell for the stacked phone layout', () => {
    render(
      <DataTable
        rows={[{ id: 1, period: 'Oct 7 – Nov 5', total: '$108.39' }]}
        rowKey={(r) => r.id}
        columns={[
          { key: 'p', header: 'Period', kind: 'title', cell: (r) => r.period },
          { key: 't', header: 'Electric', kind: 'key', num: true, cell: (r) => r.total },
        ]}
      />,
    );
    const cells = screen.getAllByRole('cell');
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual(['Period', 'Electric']);
    expect(cells[1]).toHaveClass('fp-cell-key', 'fp-is-num');
    expect(screen.getByRole('columnheader', { name: 'Electric' })).toHaveAttribute('scope', 'col');
  });

  it('Timeline groups by the home day', () => {
    render(
      <Timeline
        now="2026-11-09T23:00:00Z"
        items={[
          { id: 1, at: '2026-11-09T22:56:00Z', time: '4:56 PM', title: 'Upstairs set to 70°', tone: 'info' },
          // 11:30 PM on the 8th at home, though already the 9th in UTC.
          { id: 2, at: '2026-11-09T05:30:00Z', time: '11:30 PM', title: 'Signed in' },
        ]}
      />,
    );
    const days = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace(/ /g, ' '));
    expect(days).toEqual(['TodayNov 9', 'YesterdayNov 8']);
  });

  it('Progress is a named progressbar', () => {
    render(<Progress value={62} label="Filter life" tone="ok" valueText="62% left" />);
    const bar = screen.getByRole('progressbar', { name: 'Filter life' });
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    expect(bar).toHaveAttribute('aria-valuetext', '62% left');
  });
});

describe('instruments draw from data alone', () => {
  it('Dial renders rings, segments, marks and a needle in a viewBox, with no layout reads', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const { container } = render(
      <Dial
        label="Downstairs 71 degrees"
        rings={[{ r: 88, w: 10, min: 60, max: 85, ticks: 25, major: 5, labels: [[60, '60°'], [85, '85°']], segments: [{ from: 60, to: 68, tone: 'heat' }], marks: [{ at: 75, tone: 'cool' }], needle: { at: 70.6 } }]}
      />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 240 240');
    expect(container.querySelectorAll('.fp-dl-tick')).toHaveLength(26);
    expect(container.querySelectorAll('.fp-dl-seg')).toHaveLength(1);
    expect(container.querySelector('.fp-dl-seg')!.getAttribute('style')).toContain('var(--appchart-heat)');
    expect(container.querySelector('.fp-dl-needle-g')).not.toBeNull();
    // The data arcs sit in the sweep mask, referenced by a valid id.
    const mask = container.querySelector('mask')!;
    expect(container.querySelector(`[mask="url(#${mask.id})"]`)).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Downstairs 71 degrees' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Spark skips gaps and ends on a dot', () => {
    const { container } = render(<Spark values={[1, null, 3, 2]} label="Rising" />);
    expect(container.querySelector('.fp-ch-line')!.getAttribute('d')).toBe('M0 29 L66.67 3 L100 16');
  });

  it('ShareBar names each part and its value', () => {
    render(<ShareBar label="Gas bill by charge" parts={[{ key: 'f', label: 'Flat', value: 20, tone: 'ink' }, { key: 'u', label: 'Gas used', value: 17, tone: 'gas' }]} format={(v) => `$${v}`} />);
    expect(screen.getByRole('figure', { name: 'Gas bill by charge' })).toHaveTextContent('Flat $20');
    expect(screen.getByText('Gas used', { exact: false })).toBeInTheDocument();
  });

  it('LampMatrix reads the latest cell, and the arrow keys move along', () => {
    render(
      <LampMatrix
        caption="13 of 14 days complete."
        words={{ ok: 'All 24 hours', warn: 'Partial day' }}
        cells={[
          { label: 'Sat, Nov 7', state: 'ok' },
          { label: 'Sun, Nov 8', state: 'warn', note: '21 of 24 hours' },
          { label: 'Mon, Nov 9', state: 'ok', short: 'Today' },
        ]}
      />,
    );
    const plot = screen.getByRole('group', { name: /13 of 14 days complete/ });
    const readout = plot.parentElement!.querySelector('.fp-chart-readout')!;
    expect(readout).toHaveTextContent('Mon, Nov 9All 24 hours');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(readout).toHaveTextContent('Sun, Nov 8Partial day · 21 of 24 hours');
  });
});

describe('final-pass kit additions', () => {
  it('a Ring with a size holds that width in a flex row (no wrapper needed)', async () => {
    const { Ring } = await import('../components/ui');
    const { container } = render(<div style={{ display: 'flex' }}><Ring value={0.5} size={48} label="Half" /></div>);
    const dial = container.querySelector('.fp-dial')!;
    expect(dial).toHaveClass('fp-dial--fixed');
    expect((dial as HTMLElement).style.getPropertyValue('--fp-dial-max')).toBe('48px');
  });

  it('Chips can be disabled one by one or as a row', async () => {
    const onChange = vi.fn();
    const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }] as const;
    const { rerender } = render(<Chips label="Pick" options={opts} value="a" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'B' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'A' })).toBeEnabled();
    rerender(<Chips label="Pick" options={opts} value="a" onChange={onChange} disabled />);
    expect(screen.getByRole('button', { name: 'A' })).toBeDisabled();
  });

  it('ShowMore keeps the first items in place and the rest behind "Show N more"', async () => {
    const { ShowMore } = await import('../components/ui');
    render(<ShowMore items={[1, 2, 3, 4, 5]} first={2} noun="days" render={(xs) => <ul>{xs.map((x) => <li key={x}>day {x}</li>)}</ul>} />);
    expect(screen.getByText('Show 3 more days')).toBeInTheDocument();
    expect(screen.getByText('Show fewer days')).toBeInTheDocument();
    expect(screen.getAllByText(/^day /)).toHaveLength(5);
  });

  it('ChartLegend and TooltipCard draw from the kit', async () => {
    const { ChartLegend, TooltipCard, TooltipLine } = await import('../components/ui');
    render(<><ChartLegend items={[{ label: 'Actual', value: '12 kWh', tone: 'ink' }]} /><TooltipCard title="Mon"><TooltipLine label="Used" value="3 kWh" /></TooltipCard></>);
    expect(screen.getByText('12 kWh')).toBeInTheDocument();
    expect(screen.getByText('Used')).toBeInTheDocument();
  });
});
