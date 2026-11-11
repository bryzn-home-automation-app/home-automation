import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

// The child pages pull live usage data; stub them so this test covers only the
// Utility switcher behavior.
vi.mock('../pages/ElectricalUsage', () => ({ default: () => <div>ELECTRIC_CONTENT</div> }));
vi.mock('../pages/GasUsage', () => ({ default: () => <div>GAS_CONTENT</div> }));
vi.mock('../pages/WaterUsage', () => ({ default: () => <div>WATER_CONTENT</div> }));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

async function renderUtility(initialPath = '/utility') {
  const { default: Utility } = await import('../pages/Utility');
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Utility />
      <Where />
    </MemoryRouter>,
  );
}

describe('Utility tab', () => {
  it('defaults to Electric, in a tab panel labelled by its tab', async () => {
    await renderUtility();
    expect(await screen.findByText('ELECTRIC_CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('GAS_CONTENT')).not.toBeInTheDocument();
    const tab = screen.getByRole('tab', { name: /electric/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab.id);
    expect(screen.getByTestId('where')).toHaveTextContent('/utility');
  });

  it('switches to Gas and keeps the choice in the URL (B-075)', async () => {
    await renderUtility();
    await screen.findByText('ELECTRIC_CONTENT');
    fireEvent.click(screen.getByRole('tab', { name: /gas/i }));
    expect(await screen.findByText('GAS_CONTENT')).toBeInTheDocument();
    expect(screen.queryByText('ELECTRIC_CONTENT')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /gas/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('where')).toHaveTextContent('/utility?view=gas');
  });

  it('switches back to Electric and drops the default from the URL', async () => {
    await renderUtility('/utility?view=gas');
    await screen.findByText('GAS_CONTENT');
    fireEvent.click(screen.getByRole('tab', { name: /electric/i }));
    expect(await screen.findByText('ELECTRIC_CONTENT')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/utility'));
  });

  it('opens on Water when deep-linked with ?view=water, and moves with the arrow keys', async () => {
    await renderUtility('/utility?view=water');
    expect(await screen.findByText('WATER_CONTENT')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: /water/i }), { key: 'ArrowLeft' });
    expect(await screen.findByText('GAS_CONTENT')).toBeInTheDocument();
  });
});
