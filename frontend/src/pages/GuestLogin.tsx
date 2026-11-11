import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { guestLogin } from '../api/auth';
import { PRESET_COLORS } from '../components/profile/ColorPicker';
import { Button, Field, FormGrid, Icon, Input, InstrumentPanel, Lamp, LinkButton, Notice, Stack, Swatches, Verdict } from '../components/ui';
import { formatDate, formatTime } from '../utils/format';
import DoorFrame from './door/DoorFrame';
import VisitorBadge from './guest/VisitorBadge';

const GUEST_DAYS = 30;
const SWATCHES = PRESET_COLORS.map(({ hex, name }) => ({ value: hex, label: name, color: hex }));

/**
 * The new guest's photo goes up only after they are signed in, with their own token (B-033):
 * /api/upload/avatar needs a session, which a first-time visitor doesn't have until guest-login
 * answers. Plain axios, not the app's client, so a family member's token stored in this browser
 * can't be sent instead and put the guest's photo on the family member's profile. Returns the
 * saved photo's URL.
 */
async function saveGuestPhoto(file: File, token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}` };
  const form = new FormData();
  form.append('file', file);
  const { data } = await axios.post<{ avatarUrl: string }>('/api/upload/avatar', form, { headers, timeout: 30_000 });
  await axios.put('/api/auth/profile', { avatarUrl: data.avatarUrl }, { headers, timeout: 30_000 });
  return data.avatarUrl;
}

/*
 * Guest welcome: a visitor makes their badge (name, the code from their host, a colour, an
 * optional photo) and checks in. Then a short "you're in" with the way to the lobby.
 */
export default function GuestLogin() {
  const [name, setName] = useState('');
  const [code, setCode] = useState(() =>
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('code') ?? ''
      : ''
  );
  const [accentColor, setAccentColor] = useState('#A855F7');
  // The picked photo stays on this device (a preview) until check-in.
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [savedPhoto, setSavedPhoto] = useState<string | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submittedName, setSubmittedName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Free the preview's object URL when it is replaced or the page goes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // Let the same file be picked again after removing it (B-161).
    input.value = '';
    if (!file) return;
    setError('');
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const removePhoto = () => {
    setPhoto(null);
    setPreview(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    setError('');

    if (!trimmed) {
      setError('Please enter your name to continue.');
      return;
    }
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }

    setLoading(true);
    try {
      const resp = await guestLogin({ displayName: trimmed, accentColor }, code.trim());
      let avatar = '';
      if (photo) {
        try {
          avatar = await saveGuestPhoto(photo, resp.token);
          setSavedPhoto(avatar);
        } catch {
          // Checked in either way; the welcome says the photo didn't make it.
          setPhotoFailed(true);
        }
      }
      sessionStorage.setItem('guestName', resp.displayName);
      sessionStorage.setItem('guestToken', resp.token);
      sessionStorage.setItem('guestAccent', accentColor);
      sessionStorage.setItem('guestAvatar', avatar);
      setSubmittedName(trimmed);
      setCheckedInAt(new Date());
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const foot = <>Live here? <Link className="fp-link text-apptext" to="/login">Sign in instead</Link></>;

  if (submitted && checkedInAt) {
    const until = new Date(checkedInAt.getTime() + GUEST_DAYS * 24 * 60 * 60 * 1000);
    return (
      <DoorFrame foot={foot}>
        <InstrumentPanel
          instrument={
            <VisitorBadge
              label={`Visitor badge for ${submittedName}`}
              name={submittedName}
              color={accentColor}
              photoUrl={savedPhoto}
              role={<><Lamp tone="ok" size="s" />Checked in at {formatTime(checkedInAt)}</>}
              foot={[['Here since', formatTime(checkedInAt)], ['Pass until', formatDate(until)]]}
            />
          }
          verdict={
            <Verdict tone="ok" note="Your host can see that you’ve joined. Your pass ends by itself after 30 days.">
              You’re in, {submittedName}.
            </Verdict>
          }
        >
          {photoFailed && (
            <Notice tone="headsup" title="Your photo didn’t upload.">You’re checked in without it; your colour stands in.</Notice>
          )}
          <LinkButton to="/guest/home" variant="primary" size="lg" block icon="users">See who’s here</LinkButton>
        </InstrumentPanel>
      </DoorFrame>
    );
  }

  const shownName = name.trim() || 'Your name';

  return (
    <DoorFrame foot={foot}>
      <form onSubmit={handleSubmit} noValidate>
        <InstrumentPanel
          instrument={
            <VisitorBadge
              label={`Visitor badge for ${name.trim() || 'a guest'}`}
              name={shownName}
              faceName={name.trim()}
              color={accentColor}
              photoUrl={preview}
              role="Guest at the house"
              foot={[['Pass', `${GUEST_DAYS} days`], ['Invite code', code.trim().toUpperCase() || '—']]}
              faceKey={
                <>
                  {/* A small round key riveted to the face, with a 44px hit area (B-160: named). */}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    aria-label={preview ? 'Change photo' : 'Add a photo'}
                    className="absolute -bottom-1.5 -right-2 grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--appplate-edge)] bg-appplate text-appplate-ink after:absolute after:-inset-[7px] after:rounded-full after:content-[''] active:translate-y-px"
                  >
                    <Icon name="image" className="text-base" />
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" tabIndex={-1} aria-hidden="true" />
                </>
              }
            />
          }
          verdict={
            <Verdict tone="info" note="Your name, the code from your host, and a colour so the family can tell guests apart. A photo is optional.">
              Welcome! Make yourself a visitor badge.
            </Verdict>
          }
        >
          <FormGrid>
            <Field label="Your name">
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(''); }}
                placeholder="Sarah or Mike"
                autoComplete="name"
                maxLength={40}
                autoFocus
              />
            </Field>
            <Field label="Invite code">
              <Input
                mono
                value={code}
                onChange={(e) => { setCode(e.target.value); if (error) setError(''); }}
                placeholder="From your host"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </Field>
          </FormGrid>

          <div className="fp-field">
            <span className="fp-label">Your colour</span>
            <Swatches label="Your colour" value={accentColor} onChange={setAccentColor} options={SWATCHES} />
          </div>

          {photo && (
            <p className="fp-small fp-muted flex flex-wrap items-center gap-x-2">
              Photo picked. It goes up when you check in.
              <Button variant="quiet" size="sm" onClick={removePhoto}>Remove photo</Button>
            </p>
          )}

          {/* Announced the moment it appears (B-060). */}
          {error && <Notice tone="problem" title={error} live="assertive" />}

          <Stack gap="s">
            <Button type="submit" variant="primary" size="lg" block icon="log-in" busy={loading} busyLabel="Checking in…">
              Check in
            </Button>
            <p className="fp-small fp-muted">
              Your pass lasts {GUEST_DAYS} days, then ends by itself. By checking in you agree to the home’s guest access policy.
            </p>
          </Stack>
        </InstrumentPanel>
      </form>
    </DoorFrame>
  );
}
