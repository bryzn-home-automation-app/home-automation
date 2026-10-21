import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { base64UrlToBytes, pushSupport, type PushEnv } from '../utils/push';

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isGuest: false }) }));

const ready: PushEnv = { secure: true, ios: true, standalone: true, hasServiceWorker: true, hasPush: true, permission: 'default' };

describe('push support', () => {
  it('walks through what stands in the way, in order', () => {
    expect(pushSupport({ ...ready, secure: false })).toBe('insecure');
    expect(pushSupport({ ...ready, standalone: false })).toBe('install'); // iPhone Safari tab
    expect(pushSupport({ ...ready, ios: false, standalone: false })).toBe('ok'); // desktop browser is fine
    expect(pushSupport({ ...ready, hasPush: false })).toBe('unsupported');
    expect(pushSupport({ ...ready, permission: 'denied' })).toBe('denied');
    expect(pushSupport(ready)).toBe('ok');
  });

  it('decodes the base64url VAPID key to raw bytes', () => {
    // "BAEC" = 0x04 0x01 0x02 (uncompressed-point prefix + 2 bytes), url-safe & unpadded
    expect(Array.from(base64UrlToBytes('BAEC'))).toEqual([4, 1, 2]);
    expect(Array.from(base64UrlToBytes('-_8'))).toEqual([251, 255]);
  });
});

describe('PushSettings', () => {
  it('on the plain http address, points to the secure one', async () => {
    const { default: PushSettings, SECURE_APP_URL } = await import('../components/PushSettings');
    render(<PushSettings />); // jsdom is not a secure context
    expect(screen.getByText('Phone alerts')).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toBe(SECURE_APP_URL);
  });
});

describe('app update check', () => {
  it('finds the hashed entry bundle in index.html', async () => {
    const { entryScript } = await import('../utils/appUpdate');
    const html = '<head><script type="module" crossorigin src="/assets/index-CqA4vaMr.js"></script><link rel="modulepreload" href="/assets/react-D_Q0CZ0m.js"></head>';
    expect(entryScript(html)).toBe('/assets/index-CqA4vaMr.js');
    expect(entryScript('<html><script src="/src/main.tsx"></script></html>')).toBeNull();
  });
});
