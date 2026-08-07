import { useState, useRef, type FormEvent, type ChangeEvent } from 'react';
import Avatar from './Avatar';
import ColorPicker from './ColorPicker';
import type { ProfileResponse, ProfileUpdateRequest } from '../../api/auth';
import { uploadAvatar } from '../../api/auth';

interface UserEditModalProps {
  profile: ProfileResponse;
  onSave: (req: ProfileUpdateRequest) => Promise<void>;
  onClose: () => void;
}

export default function UserEditModal({ profile, onSave, onClose }: UserEditModalProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [phone, setPhone] = useState(profile.phone || '');
  const [accentColor, setAccentColor] = useState(profile.accentColor);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await onSave({
        displayName: displayName.trim(),
        phone: phone.trim() || undefined,
        accentColor,
        avatarUrl: avatarUrl || undefined,
      });
      onClose();
    } catch {
      // error handled upstream
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[32px] border border-appborder bg-appsurface p-6 shadow-[0_20px_60px_var(--appshadow-lg)] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-apptext">Edit Profile</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-appborder text-apptext-muted transition-colors hover:bg-appinset"
          >
            ✕
          </button>
        </div>

        {/* Photo upload area */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative"
            disabled={uploading}
          >
            <Avatar
              displayName={displayName}
              avatarUrl={avatarUrl}
              accentColor={accentColor}
              size={96}
            />
            {/* Hover overlay */}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-2xl text-white">📷</span>
            </div>
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <span className="text-xs text-apptext-muted">
            {avatarUrl ? 'Tap to change photo' : 'Tap to add a photo'}
          </span>
          {uploadError && (
            <p className="text-xs text-appdanger">{uploadError}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="214-555-0199"
              className="w-full rounded-2xl border border-appborder bg-appinset px-4 py-3 text-apptext placeholder:text-apptext-dim transition-colors focus:border-appaccent focus:outline-none focus:ring-2 focus:ring-appaccent/20"
            />
          </div>

          <div>
            <label className="mb-3 block text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Accent Color
            </label>
            <ColorPicker selected={accentColor} onChange={setAccentColor} />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-appborder bg-appinset px-4 py-3 text-sm font-semibold text-apptext-soft transition-colors hover:bg-appinset-strong"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !displayName.trim() || uploading}
              className="flex-1 rounded-2xl bg-appaccent px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_var(--appaccent-soft)] transition-all hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
