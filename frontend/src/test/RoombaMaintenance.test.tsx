import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RoombaMaintenance, { remainingText, usedText } from '../components/RoombaMaintenance';
import type { RoombaPart } from '../types';

const base = {
  hint: null,
  countType: 'minutes',
  counterCategory: 'replacement',
  action: 'replace',
  resetBy: 'user',
  minutesRemaining: null,
  lastUpdatedAt: null,
  updatedAt: new Date().toISOString(),
};

// Real values from the robot's parts record (Roomba Combo G2): 734 min used,
// 2,400 min left on the filter → 77 %.
const filter: RoombaPart = {
  ...base,
  partId: '72',
  label: 'Filter',
  unit: 'hours',
  countRemaining: 2400,
  countUsed: 734,
  pctRemaining: 77,
  status: 'ok',
};

const bag: RoombaPart = {
  ...base,
  partId: '147',
  label: 'Dock bag',
  countType: 'evacs',
  resetBy: 'cloud',
  unit: 'empties',
  countRemaining: 0,
  countUsed: 60,
  pctRemaining: 0,
  status: 'overdue',
};

describe('RoombaMaintenance', () => {
  it('renders one tile per part with its status, remaining life and a summary', () => {
    render(<RoombaMaintenance parts={[filter, bag]} loading={false} />);
    expect(screen.getByText('Filter')).toBeTruthy();
    expect(screen.getByText('40 hr left')).toBeTruthy();
    expect(screen.getByText('77%')).toBeTruthy();
    expect(screen.getByText('Dock bag')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('1 part overdue')).toBeTruthy();
  });

  it('formats remaining and used life per unit', () => {
    expect(remainingText({ ...filter, countRemaining: 30 })).toBe('Under 1 hr left');
    expect(remainingText({ ...filter, countRemaining: 0 })).toBe('Replace now');
    expect(remainingText({ ...filter, unit: 'missions', countRemaining: 1 })).toBe('1 mission left');
    expect(remainingText({ ...filter, unit: 'missions', countRemaining: 27 })).toBe('27 missions left');
    expect(remainingText(bag)).toBe('Bag full');
    expect(remainingText({ ...filter, countRemaining: null })).toBe('No counter');
    expect(usedText(filter)).toBe('12 hr used');
    expect(usedText({ ...bag, countUsed: 1 })).toBe('1 empty used');
  });

  it('shows an empty state before the first parts sync', () => {
    render(<RoombaMaintenance parts={[]} loading={false} />);
    expect(screen.getByText(/No maintenance data yet/)).toBeTruthy();
  });
});
