import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DueReminder, HeadsUpOption, Reminder, ReminderInput } from '../api/reminders';
import { homeToday } from '../utils/format';

const state = vi.hoisted(() => ({
  isGuest: false,
  reminders: [] as Reminder[],
  due: [] as DueReminder[],
  calls: [] as Array<[string, ...unknown[]]>,
  failComplete: false,
  dueFetches: 0,
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isGuest: state.isGuest }) }));

const OPTIONS: HeadsUpOption[] = [
  { kind: 'DAYS_BEFORE', label: 'Days before', daysBefore: null, time: '09:00', custom: true },
  { kind: 'MORNING_BEFORE', label: 'Morning before', daysBefore: 1, time: '08:00', custom: false },
  { kind: 'AFTERNOON_BEFORE', label: 'Afternoon before', daysBefore: 1, time: '14:00', custom: false },
  { kind: 'EVENING_BEFORE', label: 'Evening before', daysBefore: 1, time: '18:00', custom: false },
  { kind: 'NIGHT_BEFORE', label: 'Night before', daysBefore: 1, time: '20:00', custom: false },
  { kind: 'MORNING_OF', label: 'Morning of', daysBefore: 0, time: '07:00', custom: false },
  { kind: 'AT_TIME', label: 'At a time on the day', daysBefore: 0, time: null, custom: true },
];

vi.mock('../api/reminders', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/reminders')>();
  return {
    ...real,
    fetchReminders: async () => state.reminders.map((r) => ({ ...r })),
    fetchDueReminders: async () => {
      state.dueFetches++;
      return state.due.map((r) => ({ ...r }));
    },
    fetchHeadsUpOptions: async () => OPTIONS,
    createReminder: async (input: ReminderInput) => {
      state.calls.push(['create', input]);
      return { ...trash(), ...input, id: 99 };
    },
    updateReminder: async (id: number, input: ReminderInput) => {
      state.calls.push(['update', id, input]);
      return { ...trash(), ...input, id };
    },
    deleteReminder: async (id: number) => {
      state.calls.push(['delete', id]);
      state.reminders = state.reminders.filter((r) => r.id !== id);
    },
    setReminderAlerts: async (id: number, on: boolean) => {
      state.calls.push(['alerts', id, on]);
      return { ...trash(), alerts: on };
    },
    completeReminder: async (id: number, date: string) => {
      state.calls.push(['complete', id, date]);
      if (state.failComplete) throw new Error('nope');
      state.due = state.due.filter((r) => r.id !== id);
      return trash();
    },
    undoReminder: async (id: number, date: string) => {
      state.calls.push(['undo', id, date]);
      return trash();
    },
  };
});

vi.mock('../api/notifications', () => ({
  fetchAlertPreferences: async () => [
    { type: 'ENERGY_BILL', category: 'ELECTRICAL', label: 'Monthly bill estimate', description: 'Early each month', inApp: true, push: false, defaultInApp: true, defaultPush: false },
    { type: 'REMINDER', category: 'REMINDER', label: 'Reminders', description: 'Heads-ups for household reminders, like trash day', inApp: true, push: true, defaultInApp: true, defaultPush: true },
  ],
  setAlertPreference: async () => ({}),
  resetAlertPreferences: async () => [],
}));

import AlertTypeSettings from '../components/AlertTypeSettings';
import RemindersPanel, { UNDO_MS } from '../components/RemindersPanel';
import Reminders from '../pages/Reminders';
import {
  clockText,
  draftToInput,
  dueLine,
  emptyDraft,
  headsUpWords,
  ordinal,
  repeatWords,
  ruleWords,
  validateDraft,
} from '../utils/reminders';

/** Strip no-break spaces so text compares plainly. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ');

/** "YYYY-MM-DD" n days after the home's today. */
function dayAfter(n: number): string {
  const [y, m, d] = homeToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function trash(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 1,
    name: 'Trash day',
    note: 'Take the bins out tonight.',
    repeat: 'WEEKLY',
    weekdays: ['FRI'],
    dayOfMonth: null,
    date: null,
    dueBy: '08:00',
    headsUps: [
      { key: 'AFTERNOON_BEFORE', kind: 'AFTERNOON_BEFORE', label: 'Afternoon before', days: 1, time: '14:00' },
      { key: 'EVENING_BEFORE', kind: 'EVENING_BEFORE', label: 'Evening before', days: 1, time: '18:00' },
    ],
    alerts: true,
    occurrence: {
      date: dayAfter(2),
      showFrom: `${dayAfter(1)}T14:00`,
      dueAt: `${dayAfter(2)}T08:00`,
      visible: false,
      completed: false,
      completedBy: null,
      completedAt: null,
    },
    nextOccurrence: null,
    createdBy: 'Bryan',
    updatedAt: null,
    ...over,
  };
}

function due(over: Partial<DueReminder> = {}): DueReminder {
  return {
    id: 1,
    name: 'Trash day',
    note: 'Take the bins out tonight.',
    date: dayAfter(1),
    dueBy: '08:00',
    showFrom: `${homeToday()}T14:00`,
    dueAt: `${dayAfter(1)}T08:00`,
    ...over,
  };
}

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.isGuest = false;
  state.reminders = [];
  state.due = [];
  state.calls = [];
  state.failComplete = false;
  state.dueFetches = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Words ──────────────────────────────────────────────────────────────

describe('rule in plain words', () => {
  it("reads the owner's trash example as one line", () => {
    expect(plain(ruleWords(trash()))).toBe('Every Friday · heads-up the afternoon and evening before · done by 8:00 AM');
  });

  it('names weekly sets, monthly days and one-time dates plainly', () => {
    expect(repeatWords({ repeat: 'WEEKLY', weekdays: ['MON', 'THU'], dayOfMonth: null, date: null })).toBe('Every Monday and Thursday');
    expect(repeatWords({ repeat: 'WEEKLY', weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], dayOfMonth: null, date: null })).toBe('Every weekday');
    expect(repeatWords({ repeat: 'WEEKLY', weekdays: ['SUN', 'SAT', 'FRI', 'THU', 'WED', 'TUE', 'MON'], dayOfMonth: null, date: null })).toBe('Every day');
    expect(repeatWords({ repeat: 'MONTHLY', weekdays: [], dayOfMonth: 1, date: null })).toBe('Monthly on the 1st');
    expect(repeatWords({ repeat: 'MONTHLY', weekdays: [], dayOfMonth: 31, date: null })).toBe("Monthly on the 31st (or the month's last day)");
    expect(plain(repeatWords({ repeat: 'ONCE', weekdays: [], dayOfMonth: null, date: '2026-11-20' }))).toMatch(/^Once, on Fri, Nov 20/);
  });

  it('lists heads-ups earliest first, grouping the ones the day before', () => {
    expect(
      plain(
        headsUpWords([
          { kind: 'MORNING_OF', days: 0, time: '07:00' },
          { kind: 'NIGHT_BEFORE', days: 1, time: '20:00' },
          { kind: 'DAYS_BEFORE', days: 3, time: '09:00' },
          { kind: 'AT_TIME', days: 0, time: '06:30' },
        ]),
      ),
    ).toBe('3 days before, the night before, the morning of and at 6:30 AM on the day');
    expect(headsUpWords([{ kind: 'DAYS_BEFORE', days: 1, time: '09:00' }])).toBe('1 day before');
    expect(headsUpWords([])).toBeNull();
    expect(ruleWords({ ...trash(), headsUps: [], dueBy: null })).toBe('Every Friday · shows on the day');
  });

  it('reads the due day against the home clock', () => {
    const now = '2026-11-12T15:00:00-06:00'; // Thursday afternoon at home
    expect(plain(dueLine('2026-11-13', '08:00', now))).toBe('Tomorrow · Fri, Nov 13 · by 8:00 AM');
    expect(plain(dueLine('2026-11-13', null, now))).toBe('Tomorrow · Fri, Nov 13');
    expect(plain(dueLine('2026-11-12', '20:00', now))).toBe('Today, by 8:00 PM');
    expect(dueLine('2026-11-12', null, now)).toBe('Today');
    expect(plain(dueLine('2026-11-16', null, now))).toBe('In 4 days · Mon, Nov 16');
  });

  it('formats clock times and ordinals', () => {
    expect(plain(clockText('08:00'))).toBe('8:00 AM');
    expect(plain(clockText('14:30'))).toBe('2:30 PM');
    expect(clockText(null)).toBe('');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
  });
});

describe('the form draft', () => {
  it('checks what the server checks', () => {
    const d = { ...emptyDraft('2026-11-11'), kinds: [] };
    expect(validateDraft(d, { today: '2026-11-11' })).toMatchObject({ name: 'Give the reminder a name.', weekdays: 'Pick at least one day of the week.' });
    expect(validateDraft({ ...d, name: 'Vet', repeat: 'ONCE', date: '2026-11-10' }, { today: '2026-11-11' }).date).toBe('That date has already passed.');
    expect(validateDraft({ ...d, name: 'Vet', repeat: 'ONCE', date: '2026-11-10' }, { today: '2026-11-11', originalDate: '2026-11-10' }).date).toBeUndefined();
    const late = validateDraft({ ...d, name: 'Trash', weekdays: ['FRI'], hasDueBy: true, dueBy: '08:00', kinds: ['AT_TIME'], atTime: '09:00' }, { today: '2026-11-11' });
    expect(plain(late.headsUps)).toBe('The heads-up at 9:00 AM comes after the 8:00 AM done-by time.');
    const morning = validateDraft({ ...d, name: 'Trash', weekdays: ['FRI'], hasDueBy: true, dueBy: '06:00', kinds: ['MORNING_OF'] }, { today: '2026-11-11', options: OPTIONS });
    expect(plain(morning.headsUps)).toBe('The heads-up at 7:00 AM comes after the 6:00 AM done-by time.');
  });

  it('sends only what the chosen repeat needs, heads-ups in order', () => {
    const input = draftToInput({
      ...emptyDraft('2026-11-11'),
      name: ' Trash day ',
      weekdays: ['FRI', 'MON'],
      kinds: ['EVENING_BEFORE', 'DAYS_BEFORE', 'AFTERNOON_BEFORE'],
      daysBefore: 3,
      hasDueBy: true,
      dueBy: '08:00',
    });
    expect(input).toEqual({
      name: 'Trash day',
      note: null,
      repeat: 'WEEKLY',
      weekdays: ['MON', 'FRI'],
      dayOfMonth: null,
      date: null,
      dueBy: '08:00',
      headsUps: [{ kind: 'DAYS_BEFORE', days: 3, time: '09:00' }, { kind: 'AFTERNOON_BEFORE' }, { kind: 'EVENING_BEFORE' }],
      alerts: true,
    });
  });
});

// ─── Home panel ─────────────────────────────────────────────────────────

describe('RemindersPanel (Home)', () => {
  it('renders nothing when no reminder is showing', async () => {
    const { container } = renderWith(<RemindersPanel />);
    await waitFor(() => expect(state.dueFetches).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a guest and never asks the server', async () => {
    state.isGuest = true;
    state.due = [due()];
    const { container } = renderWith(<RemindersPanel />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(state.dueFetches).toBe(0);
  });

  it('lists what is due with a plain due line and the note, and links to the page', async () => {
    state.due = [due(), due({ id: 2, name: 'Water the plants', note: null, date: homeToday(), dueBy: null, dueAt: `${dayAfter(1)}T00:00` })];
    renderWith(<RemindersPanel />);
    const panel = await screen.findByRole('region', { name: 'Reminders' });
    expect(within(panel).getByText('Trash day')).toBeInTheDocument();
    expect(within(panel).getByText((_, el) => el?.tagName === 'P' && /^Tomorrow · .* · by 8:00 AM$/.test(plain(el.textContent)))).toBeInTheDocument();
    expect(within(panel).getByText('Take the bins out tonight.')).toBeInTheDocument();
    expect(within(panel).getByText('Today')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /All reminders/ })).toHaveAttribute('href', '/reminders');
  });

  it('Done hides it at once and offers Undo, which brings it back', async () => {
    state.due = [due()];
    renderWith(<RemindersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Done: Trash day' }));
    await waitFor(() => expect(state.calls).toContainEqual(['complete', 1, dayAfter(1)]));
    expect(screen.queryByRole('button', { name: 'Done: Trash day' })).not.toBeInTheDocument();
    expect(screen.getByText('Trash day: done for everyone.')).toBeInTheDocument();

    state.due = [due()]; // the server has it again after the undo
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(state.calls).toContainEqual(['undo', 1, dayAfter(1)]));
    expect(await screen.findByRole('button', { name: 'Done: Trash day' })).toBeInTheDocument();
    expect(screen.queryByText('Trash day: done for everyone.')).not.toBeInTheDocument();
  });

  it('Undo goes after a few seconds, and then the empty panel goes too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.due = [due()];
    const { container } = renderWith(<RemindersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Done: Trash day' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 100);
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('a Done the server refuses puts the row back and says so', async () => {
    state.failComplete = true;
    state.due = [due()];
    renderWith(<RemindersPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Done: Trash day' }));
    expect(await screen.findByText("Couldn't save that. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done: Trash day' })).toBeInTheDocument();
  });
});

// ─── The page ───────────────────────────────────────────────────────────

describe('Reminders page', () => {
  it('explains the feature when empty and adds the trash example in one tap', async () => {
    renderWith(<Reminders />);
    expect(await screen.findByText('No reminders yet')).toBeInTheDocument();
    expect(screen.getByText(/Trash goes out on Friday/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add trash day' }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe('create'));
    expect(state.calls[0][1]).toMatchObject({ name: 'Trash day', weekdays: ['FRI'], dueBy: '08:00' });
  });

  it('lists each reminder with its rule in plain words, next date and alerts switch', async () => {
    state.reminders = [trash(), trash({ id: 2, name: 'Rent', repeat: 'MONTHLY', weekdays: [], dayOfMonth: 1, dueBy: null, headsUps: [], alerts: false, note: null })];
    renderWith(<Reminders />);
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && plain(el.textContent) === 'Every Friday · heads-up the afternoon and evening before · done by 8:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Monthly on the 1st · shows on the day')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Phone alerts for Trash day' })).toHaveAttribute('aria-checked', 'true');
    const rent = screen.getByRole('switch', { name: 'Phone alerts for Rent' });
    expect(rent).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(rent);
    await waitFor(() => expect(state.calls).toContainEqual(['alerts', 2, true]));
  });

  it('shows what is due now, with Mark done', async () => {
    const r = trash();
    state.reminders = [{ ...r, occurrence: { ...r.occurrence!, date: dayAfter(1), visible: true } }];
    renderWith(<Reminders />);
    expect(await screen.findByText('Trash day is due tomorrow.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(state.calls).toContainEqual(['complete', 1, dayAfter(1)]));
  });

  it('adds a reminder through the dialog, checking it first', async () => {
    state.reminders = [trash()];
    renderWith(<Reminders />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a reminder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a reminder' });

    // Nothing filled in: the mistakes show at their fields and nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reminder' }));
    expect(await within(dialog).findByText('Give the reminder a name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Pick at least one day of the week.')).toBeInTheDocument();
    expect(state.calls).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Recycling' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tue' }));
    // Preset chips carry their time from the server.
    await waitFor(() => expect(plain(within(dialog).getByRole('button', { name: /Afternoon before/ }).textContent)).toContain('2:00 PM'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Evening before/ })); // off (on by default)
    fireEvent.click(within(dialog).getByRole('button', { name: /Night before/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Days before/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raise days before' }));
    expect(plain(within(dialog).getByText(/^Every Tuesday ·/).textContent)).toBe('Every Tuesday · heads-up 3 days before and the night before');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reminder' }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe('create'));
    expect(state.calls[0][1]).toEqual({
      name: 'Recycling',
      note: null,
      repeat: 'WEEKLY',
      weekdays: ['TUE'],
      dayOfMonth: null,
      date: null,
      dueBy: null,
      headsUps: [{ kind: 'DAYS_BEFORE', days: 3, time: '09:00' }, { kind: 'NIGHT_BEFORE' }],
      alerts: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits a reminder, then deletes it after confirming', async () => {
    state.reminders = [trash()];
    renderWith(<Reminders />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Trash day' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Trash day' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Trash day');
    expect(within(dialog).getByRole('button', { name: 'Fri' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Trash and recycling' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Monthly' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe('update'));
    expect(state.calls[0][1]).toBe(1);
    expect(state.calls[0][2]).toMatchObject({ name: 'Trash and recycling', repeat: 'MONTHLY', dueBy: '08:00' });

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Trash day' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Edit Trash day' })).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Trash day?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete reminder' }));
    await waitFor(() => expect(state.calls).toContainEqual(['delete', 1]));
  });

  it("shows the server's refusal inside the dialog", async () => {
    const api = await import('../api/reminders');
    const spy = vi.spyOn(api, 'createReminder').mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { error: 'There are already 100 reminders. Delete one first' } },
    });
    state.reminders = [trash()];
    renderWith(<Reminders />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a reminder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a reminder' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'One more' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sat' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reminder' }));
    expect(await within(dialog).findByText(/There are already 100 reminders/)).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('Profile → Alert types', () => {
  it('lists Reminders, on in the app and on the phone by default', async () => {
    renderWith(<AlertTypeSettings />);
    const group = await screen.findByRole('region', { name: 'Reminders' });
    expect(within(group).getByRole('switch', { name: 'Reminders alerts' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('switch', { name: 'Reminders on phone' })).toHaveAttribute('aria-checked', 'true');
  });
});
