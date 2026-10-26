import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';

vi.mock('../api/presence', () => ({
  startDeviceLink: vi.fn(),
  checkDeviceLink: vi.fn(),
}));
const auth = { isGuest: false };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

import * as presenceApi from '../api/presence';
import LinkDeviceCard from '../components/LinkDeviceCard';

describe('Link this device', () => {
  beforeEach(() => {
    auth.isGuest = false;
    vi.mocked(presenceApi.startDeviceLink).mockResolvedValue({
      token: 'tok123', url: 'http://192.168.4.228:8099/identify?t=tok123', expiresAt: new Date().toISOString(),
    });
    vi.mocked(presenceApi.checkDeviceLink).mockReset();
  });

  it('opens the NUC page on this device, then reports the linked device', async () => {
    vi.mocked(presenceApi.checkDeviceLink)
      .mockResolvedValueOnce({ status: 'PENDING', name: null, type: null, mac: null })
      .mockResolvedValue({ status: 'LINKED', name: "Bryan's iPhone", type: 'MOBILE', mac: '5e:cb:e7:41:80:1a' });
    render(<LinkDeviceCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Link this device' }));
    const confirm = await screen.findByRole('link', { name: 'Tap to confirm this device' });
    expect(confirm).toHaveAttribute('href', 'http://192.168.4.228:8099/identify?t=tok123');
    expect(confirm).toHaveAttribute('target', '_blank');

    expect(await screen.findByText(/Linked: Bryan's iPhone \(mobile\)/, {}, { timeout: 6000 })).toBeInTheDocument();
    expect(presenceApi.checkDeviceLink).toHaveBeenCalledWith('tok123');
  }, 10_000);

  it('says why it can’t start', async () => {
    vi.mocked(presenceApi.startDeviceLink).mockRejectedValue(new AxiosError('503', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 503, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
      data: { error: "Who's home isn't running on the NUC right now" },
    }));
    render(<LinkDeviceCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Link this device' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Who's home isn't running"));
  });

  it('is hidden from guests', () => {
    auth.isGuest = true;
    const { container } = render(<LinkDeviceCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
