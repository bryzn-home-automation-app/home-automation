import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import ThemePicker from '../components/ThemePicker';

const renderPicker = () => render(<ThemeProvider><ThemePicker /></ThemeProvider>);
const group = (name: string) => screen.getByRole('radiogroup', { name });
const checked = (name: string) =>
  within(group(name)).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent || r.getAttribute('aria-label'));

describe('ThemePicker', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes('dark'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  it('offers Light, Dark, Auto and Device, with Light chosen for someone who never chose', () => {
    renderPicker();
    expect(within(group('Theme')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Light', 'Dark', 'Auto', 'Device']);
    expect(checked('Theme')).toEqual(['Light']);
    expect(screen.getByText('Always light.')).toBeInTheDocument();
  });

  it('can go back to following the device', () => {
    localStorage.setItem('theme', 'light');
    renderPicker();
    fireEvent.click(within(group('Theme')).getByRole('radio', { name: 'Device' }));
    expect(checked('Theme')).toEqual(['Device']);
    expect(localStorage.getItem('theme')).toBe('system');
    // This test's device is dark.
    expect(screen.getByText(/Follows this device's light or dark setting\. Dark right now\./)).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('moves the choice with the arrow keys and keeps only the chosen key in the tab order', () => {
    renderPicker();
    const radios = within(group('Theme')).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(checked('Theme')).toEqual(['Dark']);
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' });
    expect(checked('Theme')).toEqual(['Device']); // wraps
  });

  it('names the finishes in plain words and applies one to the page', () => {
    renderPicker();
    const finishes = within(group('Finish')).getAllByRole('radio');
    expect(finishes.map((r) => r.getAttribute('aria-label'))).toEqual(['Enamel', 'Sea glass', 'Sandstone', 'Lilac']);
    expect(checked('Finish')).toEqual(['Enamel']);

    fireEvent.click(within(group('Finish')).getByRole('radio', { name: 'Lilac' }));
    expect(checked('Finish')).toEqual(['Lilac']);
    expect(screen.getByText(/· Lilac/)).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-palette')).toBe('violet');
    expect(localStorage.getItem('palette')).toBe('violet');
  });
});
