import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

function Probe() {
  const { palette, theme, setPalette, setMode } = useTheme();
  return (
    <div>
      <span data-testid="palette">{palette}</span>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setPalette('violet')}>violet</button>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => setMode('dark')}>dark</button>
    </div>
  );
}

const renderProbe = () => render(<ThemeProvider><Probe /></ThemeProvider>);

describe('palette', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
  });

  it('is shared by light and dark mode', () => {
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'violet' }));
    fireEvent.click(screen.getByRole('button', { name: 'light' }));

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('palette')).toHaveTextContent('violet');
    expect(localStorage.getItem('palette')).toBe('violet');
  });

  it('adopts a palette an older build stored for only one mode', () => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('palette-light', 'default');
    localStorage.setItem('palette-dark', 'violet');

    renderProbe();

    expect(screen.getByTestId('palette')).toHaveTextContent('violet');
  });
});
