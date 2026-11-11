import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Avatar from './Avatar';
import ColorPicker, { colorName } from './ColorPicker';
import type { ProfileResponse, ProfileUpdateRequest } from '../../api/auth';
import { uploadAvatar } from '../../api/auth';
import { Button, Dialog, Field, Input, Notice, Stack } from '../ui';

interface UserEditModalProps {
  profile: ProfileResponse;
  onSave: (req: ProfileUpdateRequest) => Promise<void>;
  onClose: () => void;
}

/**
 * Edit profile: photo, display name, phone and colour, in a kit Dialog (focus moves in and
 * comes back, Escape and the back gesture close it, and it is marked as a dialog so
 * pull-to-refresh leaves it alone; B-043). A tap outside doesn't close it once something
 * has been changed.
 */
export default function UserEditModal({ profile, onSave, onClose }: UserEditModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [phone, setPhone] = useState(profile.phone || '');
  const [accentColor, setAccentColor] = useState(profile.accentColor);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    displayName !== profile.displayName ||
    phone !== (profile.phone || '') ||
    accentColor !== profile.accentColor ||
    avatarUrl !== profile.avatarUrl;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const { avatarUrl: url } = await uploadAvatar(file);
      setAvatarUrl(url);
    } catch (err: any) {
      setUploadError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      // Let the same file be picked again after a failure: the browser fires no change for
      // a file the input already holds (B-161).
      input.value = '';
    }
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        displayName: displayName.trim(),
        // Sent as is, blank included: the server clears the number for a blank string but
        // leaves it alone when the field is missing, so `|| undefined` meant a cleared phone
        // number never went away (B-028). The photo works the same way.
        phone: phone.trim(),
        accentColor,
        avatarUrl: avatarUrl ?? '',
      });
      onClose();
    } catch (err: any) {
      setSaveError(err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const colour = colorName(accentColor);

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Profile"
      title="Edit profile"
      closeOnBackdrop={!dirty}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => handleSubmit()}
            disabled={!displayName.trim() || uploading}
            busy={saving}
            busyLabel="Saving…"
          >
            Save changes
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="l">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label={avatarUrl ? 'Change photo' : 'Add a photo'}
              className="relative shrink-0 rounded-full"
            >
              <Avatar displayName={displayName} avatarUrl={avatarUrl} accentColor={accentColor} size={88} />
            </button>
            <Stack gap="xs" className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon="image" onClick={() => fileRef.current?.click()} busy={uploading} busyLabel="Uploading…">
                  {avatarUrl ? 'Change photo' : 'Add a photo'}
                </Button>
                {avatarUrl && (
                  <Button size="sm" variant="danger-quiet" icon="trash" onClick={() => setAvatarUrl(null)} disabled={uploading}>
                    Remove photo
                  </Button>
                )}
              </div>
              {uploadError && <p className="fp-small fp-t-problem" role="alert">{uploadError}</p>}
            </Stack>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
          </div>

          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required />
          </Field>
          <Field label="Phone number" optional help="Clear it to remove your number.">
            <Input type="tel" mono value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="214-555-0199" autoComplete="tel" />
          </Field>

          <Stack gap="s">
            <span className="fp-label">Your colour{colour ? ` · ${colour}` : ''}</span>
            <ColorPicker selected={accentColor} onChange={setAccentColor} />
          </Stack>

          {saveError && <Notice tone="problem" live="assertive">{saveError}</Notice>}
          {/* Enter in a field saves, as the old form did. */}
          <button type="submit" hidden />
        </Stack>
      </form>
    </Dialog>
  );
}
