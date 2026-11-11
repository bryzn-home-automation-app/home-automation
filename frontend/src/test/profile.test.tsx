import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProfileResponse } from '../api/auth';
import UserEditModal from '../components/profile/UserEditModal';
import ColorPicker, { PRESET_COLORS } from '../components/profile/ColorPicker';
import { phoneVerdict } from '../pages/ProfilePage';

vi.mock('../api/auth', () => ({ uploadAvatar: vi.fn() }));

const PROFILE: ProfileResponse = {
  id: 1, username: 'bryan', email: 'bryan@example.com', displayName: 'Bryan', phone: '214-555-0142',
  avatarUrl: '/uploads/b.jpg', accentColor: '#0EA5E9', role: 'ADMIN', status: 'ACTIVE',
};

describe('Edit profile', () => {
  it('sends a cleared phone number and a removed photo as blanks, which the server clears (B-028)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<UserEditModal profile={PROFILE} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ phone: '', avatarUrl: '' });
  });

  it('names its fields and the photo key (B-042)', () => {
    render(<UserEditModal profile={{ ...PROFILE, avatarUrl: null }} onSave={vi.fn()} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Edit profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Display name')).toHaveValue('Bryan');
    expect(screen.getAllByRole('button', { name: 'Add a photo' }).length).toBeGreaterThan(0);
  });
});

describe('Colour picker', () => {
  it('names the brown swatch for what it is and marks the chosen one (B-159, B-160)', () => {
    expect(PRESET_COLORS.find((c) => c.hex === '#7C2D12')?.name).toBe('Chestnut');
    expect(PRESET_COLORS.some((c) => c.name === 'Plum')).toBe(false);
    render(<ColorPicker selected="#0ea5e9" onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Your colour' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sky Blue' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Profile verdict', () => {
  it('says whether alerts reach this device, and what is in the way', () => {
    expect(phoneVerdict('ok', true).tone).toBe('ok');
    expect(phoneVerdict('ok', false).text).toBe("Alerts don't reach this device yet.");
    expect(phoneVerdict('install', undefined).text).toBe('Alerts need the Home Screen app.');
    expect(phoneVerdict('denied', undefined).tone).toBe('headsup');
  });
});
