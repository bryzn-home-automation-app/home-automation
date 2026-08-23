import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The child pages pull live usage data; stub them so this test covers only the
// Utility switcher behavior.
vi.mock('../pages/ElectricalUsage', () => ({ default: () => <div>ELECTRIC_CONTENT</div> }));
vi.mock('../pages/GasUsage', () => ({ default: () => <div>GAS_CONTENT</div> }));

async function renderUtility(initialPath = '/utility') {
  const { default: Utility } = await import('../pages/Utility');
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Utility />
    </MemoryRouter>,
  );
}

describe('Utility tab', () => {
  it('defaults to Electric with no monthly note', async () => {
    await renderUtility();
    expect(screen.getByText('ELECTRIC_CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('GAS_CONTENT')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /electric/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText(/only reported monthly/i)).not.toBeInTheDocument();
  });

  it('switches to Gas, showing the monthly note and gas content', async () => {
    await renderUtility();
    fireEvent.click(screen.getByRole('tab', { name: /gas/i }));
    expect(screen.getByText('GAS_CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('ELECTRIC_CONTENT')).not.toBeInTheDocument();
    expect(screen.getByText(/only reported monthly/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /gas/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches back to Electric', async () => {
    await renderUtility();
    fireEvent.click(screen.getByRole('tab', { name: /gas/i }));
    fireEvent.click(screen.getByRole('tab', { name: /electric/i }));
    expect(screen.getByText('ELECTRIC_CONTENT')).toBeInTheDocument();
    expect(screen.queryByText(/only reported monthly/i)).not.toBeInTheDocument();
  });

  it('opens on Gas when deep-linked with ?view=gas', async () => {
    await renderUtility('/utility?view=gas');
    expect(screen.getByText('GAS_CONTENT')).toBeInTheDocument();
    expect(screen.getByText(/only reported monthly/i)).toBeInTheDocument();
  });
});
