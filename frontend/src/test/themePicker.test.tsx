import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import ThemePicker from '../components/ThemePicker';
import { deriveAppTokens, hexToHsv, hsvToHex } from '../utils/appColour';

const renderPicker = () => render(<ThemeProvider><ThemePicker /></ThemeProvider>);
const group = (name: string) => screen.getByRole('radiogroup', { name });
const checked = (name: string) =>
  within(group(name)).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent || r.getAttribute('aria-label'));
const root = document.documentElement;
const pageColour = () => root.style.getPropertyValue('--appbg');
const hexField = () => screen.getByRole('textbox', { name: 'Hex code' }) as HTMLInputElement;
const saved = () => localStorage.getItem('app-colour');

describe('ThemePicker', () => {
  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('style');
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
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('moves the theme with the arrow keys and keeps only the chosen key in the tab order', () => {
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

  it('starts on Enamel: the preset checked, the field empty, reset off', () => {
    renderPicker();
    expect(checked('Presets')).toEqual(['Enamel']);
    expect(screen.getByText("App colour").parentElement!.textContent).toContain('Enamel');
    expect(hexField().value).toBe('');
    expect(screen.getByRole('button', { name: 'Reset to Enamel' })).toBeDisabled();
  });

  it('names the presets (the old finishes first) and applies one to the whole page', () => {
    renderPicker();
    const names = within(group('Presets')).getAllByRole('radio').map((r) => r.getAttribute('aria-label'));
    expect(names.slice(0, 4)).toEqual(['Enamel', 'Sea glass', 'Sandstone', 'Lilac']);
    expect(names.length).toBeGreaterThanOrEqual(8);

    fireEvent.click(within(group('Presets')).getByRole('radio', { name: 'Cobalt' }));
    expect(checked('Presets')).toEqual(['Cobalt']);
    expect(screen.getByText("App colour").parentElement!.textContent).toContain('Cobalt');
    expect(saved()).toBe('#1f4fbf');
    expect(hexField().value).toBe('#1F4FBF');
    expect(pageColour()).toBe(deriveAppTokens('#1f4fbf', 'light')['--appbg']);
  });

  it('moves through the presets with the arrow keys', () => {
    renderPicker();
    const radios = within(group('Presets')).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex).filter((t) => t === 0)).toHaveLength(1);
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(checked('Presets')).toEqual(['Sea glass']);
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1], { key: 'End' });
    expect(checked('Presets')).toEqual([radios[radios.length - 1].getAttribute('aria-label')]);
  });

  it('applies a typed #RRGGBB as you type, and a typed #RGB on Enter', () => {
    renderPicker();
    const field = hexField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '#1e7a' } });
    expect(saved()).toBeNull();
    fireEvent.change(field, { target: { value: '#1E7A4C' } });
    expect(saved()).toBe('#1e7a4c');
    expect(pageColour()).toBe(deriveAppTokens('#1e7a4c', 'light')['--appbg']);
    expect(screen.getByText("App colour").parentElement!.textContent).toContain('#1E7A4C');

    fireEvent.change(field, { target: { value: 'f29' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(saved()).toBe('#ff2299');
    expect(field.value).toBe('#FF2299');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('shows an error for something that is not a hex code, and changes nothing', () => {
    localStorage.setItem('app-colour', '#1f4fbf');
    renderPicker();
    const field = hexField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: '#12345' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Use a hex code like #1F4FBF or #14B.');
    expect(field.getAttribute('aria-describedby')).toBe(error.id);
    expect(saved()).toBe('#1f4fbf');
    // Typing again clears it; leaving the field empty puts the colour back.
    fireEvent.change(field, { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(field);
    expect(field.value).toBe('#1F4FBF');
  });

  it('takes a pasted colour, with or without #, in either length', () => {
    renderPicker();
    fireEvent.paste(hexField(), { clipboardData: { getData: () => ' ffd400 ' } });
    expect(saved()).toBe('#ffd400');
    fireEvent.paste(hexField(), { clipboardData: { getData: () => '#0af' } });
    expect(saved()).toBe('#00aaff');
  });

  it('turns the hue and moves saturation/brightness with the arrow keys on the wheel', () => {
    localStorage.setItem('app-colour', '#1f4fbf');
    renderPicker();
    const hue = screen.getByRole('slider', { name: 'Hue' });
    const sv = screen.getByRole('slider', { name: 'Saturation and brightness' });
    expect(hue).toHaveAttribute('tabindex', '0');
    expect(sv).toHaveAttribute('tabindex', '0');
    const start = hexToHsv('#1f4fbf');
    expect(Number(hue.getAttribute('aria-valuenow'))).toBe(Math.round(start.h));
    expect(hue.getAttribute('aria-valuetext')).toMatch(/degrees, blue/);

    fireEvent.keyDown(hue, { key: 'ArrowRight', shiftKey: true });
    const turned = { ...start, h: Math.round(start.h + 10) };
    expect(saved()).toBe(hsvToHex(turned));
    expect(Number(hue.getAttribute('aria-valuenow'))).toBe(turned.h);

    fireEvent.keyDown(sv, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(sv, { key: 'ArrowLeft' });
    const moved = { h: turned.h, s: Math.round((start.s - 0.01) * 100) / 100, v: Math.round((start.v - 0.1) * 100) / 100 };
    expect(saved()).toBe(hsvToHex(moved));
    expect(sv.getAttribute('aria-valuetext')).toBe(`Saturation ${Math.round(moved.s * 100)}%, brightness ${Math.round(moved.v * 100)}%`);
    expect(pageColour()).toBe(deriveAppTokens(hsvToHex(moved), 'light')['--appbg']);
    expect(checked('Presets')).toEqual([]);
  });

  it('paints while the system colour picker is open and saves when it closes', () => {
    renderPicker();
    const native = screen.getByLabelText('Open the system colour picker') as HTMLInputElement;
    expect(native.type).toBe('color');
    fireEvent.input(native, { target: { value: '#ff2d95' } });
    expect(pageColour()).toBe(deriveAppTokens('#ff2d95', 'light')['--appbg']);
    native.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saved()).toBe('#ff2d95');
  });

  it('says when selected keys use a deeper shade than the pick, and resets to Enamel', () => {
    localStorage.setItem('app-colour', '#ffd400');
    renderPicker();
    const shade = deriveAppTokens('#ffd400', 'light')['--appaccent'].toUpperCase();
    expect(screen.getByText(`Selected keys use ${shade} in light so their labels stay readable.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Enamel' }));
    expect(saved()).toBeNull();
    expect(pageColour()).toBe('');
    expect(checked('Presets')).toEqual(['Enamel']);
    expect(hexField().value).toBe('');
  });
});
