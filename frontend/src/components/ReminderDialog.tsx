import { useState, type ReactNode } from 'react';
import type { HeadsUpKind, HeadsUpOption, Reminder, ReminderInput, ReminderRepeat, Weekday } from '../api/reminders';
import {
  draftFrom,
  draftToInput,
  emptyDraft,
  HEADS_UP_LABEL,
  HEADS_UP_ORDER,
  MAX_DAYS_BEFORE,
  NAME_MAX,
  NOTE_MAX,
  ordinal,
  presetTime,
  ruleWords,
  validateDraft,
  WEEKDAYS,
  type DraftErrors,
  type ReminderDraft,
} from '../utils/reminders';
import { homeToday } from '../utils/format';
import { Button, Checkbox, Chips, Dialog, Field, Icon, Input, Notice, Seg, Stack, Stepper, Switch } from './ui';

const REPEATS: readonly { value: ReminderRepeat; label: string }[] = [
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'ONCE', label: 'One time' },
];

export interface ReminderDialogProps {
  open: boolean;
  /** The reminder being changed; none = adding one. */
  reminder?: Reminder | null;
  /** The heads-up choices with their preset times (from /reminders/heads-ups). */
  options?: readonly HeadsUpOption[];
  saving?: boolean;
  /** The server's answer when it refused the save. */
  error?: string | null;
  onSave: (input: ReminderInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * Add or change a reminder: its name and note, how it repeats, an optional done-by time, the
 * heads-ups (presets as chips; "Days before" and "At a time on the day" open their own inputs)
 * and its alerts switch. Checked here as the server checks it, so a mistake shows at its field.
 */
export default function ReminderDialog({ open, reminder, options, saving, error, onSave, onDelete, onClose }: ReminderDialogProps) {
  const today = homeToday();
  const [draft, setDraft] = useState<ReminderDraft>(() => (reminder ? draftFrom(reminder, today) : emptyDraft(today)));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<ReminderDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (tried) setErrors(validateDraft(next, { today, originalDate: reminder?.date, options }));
  };
  const dirty = reminder ? JSON.stringify(draft) !== JSON.stringify(draftFrom(reminder, today)) : draft.name.trim() !== '';

  const submit = () => {
    const found = validateDraft(draft, { today, originalDate: reminder?.date, options });
    setTried(true);
    setErrors(found);
    if (Object.keys(found).length === 0) onSave(draftToInput(draft));
  };

  const chipLabel = (k: HeadsUpKind) => {
    const t = presetTime(options, k);
    return t ? (
      <>
        {HEADS_UP_LABEL[k]}
        <span className="fp-mono opacity-80">{t}</span>
      </>
    ) : (
      HEADS_UP_LABEL[k]
    );
  };
  // The rule in words as it stands, so the choices read back as a sentence.
  const input = draftToInput(draft);
  const preview = ruleWords({
    repeat: input.repeat,
    weekdays: input.weekdays ?? [],
    dayOfMonth: draft.dayOfMonth,
    date: draft.date,
    dueBy: input.dueBy ?? null,
    headsUps: input.headsUps.map((h) => ({ kind: h.kind, days: h.days ?? 0, time: h.time ?? '' })),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow="Reminders"
      title={reminder ? `Edit ${reminder.name}` : 'Add a reminder'}
      closeOnBackdrop={!dirty}
      fullOnPhone
      footerSplit={!!onDelete}
      footer={
        <>
          {onDelete && (
            <Button variant="danger-quiet" icon="trash" onClick={onDelete}>
              Delete
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={saving} busyLabel="Saving…" onClick={submit}>
              {reminder ? 'Save changes' : 'Add reminder'}
            </Button>
          </div>
        </>
      }
    >
      <Stack gap="l">
        <Field label="Name" error={errors.name} help={`Up to ${NAME_MAX} characters, like “Trash day”.`}>
          <Input value={draft.name} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Note" optional error={errors.note} help="Shown on Home and in the alert, like “Take the bins out tonight.”">
          <Input value={draft.note} maxLength={NOTE_MAX} autoComplete="off" onChange={(e) => set({ note: e.target.value })} />
        </Field>

        <div className="fp-field">
          <span className="fp-label" aria-hidden="true">Repeats</span>
          <Seg kind="radio" fit="fill" label="Repeats" value={draft.repeat} onChange={(v) => set({ repeat: v })} options={REPEATS} />
        </div>

        {draft.repeat === 'WEEKLY' && (
          <div className="fp-field">
            <span className="fp-label" aria-hidden="true">On</span>
            <Chips<Weekday>
              multiple
              label="Days of the week"
              value={draft.weekdays}
              onChange={(v) => set({ weekdays: v })}
              options={WEEKDAYS.map((d) => ({ value: d.value, label: d.short }))}
            />
            {errors.weekdays && <ErrorLine>{errors.weekdays}</ErrorLine>}
          </div>
        )}
        {draft.repeat === 'MONTHLY' && (
          <div className="fp-field">
            <span className="fp-label" aria-hidden="true">On the</span>
            <Stepper label="Day of the month" value={draft.dayOfMonth} min={1} max={31} format={ordinal} onChange={(n) => set({ dayOfMonth: n })} />
            {draft.dayOfMonth >= 29 && <span className="fp-field-help">In shorter months, the last day of the month.</span>}
          </div>
        )}
        {draft.repeat === 'ONCE' && (
          <Field label="Date" error={errors.date}>
            <Input type="date" value={draft.date} min={today} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        )}

        <div className="fp-field">
          <Checkbox
            label="Has to be done by a time"
            help={draft.hasDueBy ? 'It clears from Home at this time.' : 'Off: by the end of the day.'}
            checked={draft.hasDueBy}
            onChange={(e) => set({ hasDueBy: e.target.checked })}
          />
          {draft.hasDueBy && (
            <Field label="Done by" error={errors.dueBy} className="mt-2 max-w-[12rem]">
              <Input type="time" step={900} value={draft.dueBy} onChange={(e) => set({ dueBy: e.target.value })} />
            </Field>
          )}
        </div>

        <div className="fp-field">
          <span className="fp-label" aria-hidden="true">Heads-ups</span>
          <span className="fp-field-help -mt-1 mb-1">It shows on Home from the first one. Pick as many as you like.</span>
          <Chips
            multiple
            label="Heads-ups"
            value={draft.kinds}
            onChange={(v) => set({ kinds: HEADS_UP_ORDER.filter((k) => v.includes(k)) })}
            options={HEADS_UP_ORDER.map((k) => ({ value: k, label: chipLabel(k) }))}
          />
          {(draft.kinds.includes('DAYS_BEFORE') || draft.kinds.includes('AT_TIME')) && (
            <div className="mt-3 grid gap-3 rounded-well border border-appborder p-3 sm:grid-cols-2">
              {draft.kinds.includes('DAYS_BEFORE') && (
                <>
                  <div className="fp-field">
                    <span className="fp-label" aria-hidden="true">Days before</span>
                    <Stepper label="Days before" value={draft.daysBefore} min={1} max={MAX_DAYS_BEFORE} onChange={(n) => set({ daysBefore: n })} />
                  </div>
                  <Field label={`At (${draft.daysBefore} ${draft.daysBefore === 1 ? 'day' : 'days'} before)`}>
                    <Input type="time" step={900} value={draft.daysBeforeTime} onChange={(e) => set({ daysBeforeTime: e.target.value })} />
                  </Field>
                </>
              )}
              {draft.kinds.includes('AT_TIME') && (
                <Field label="At a time on the day">
                  <Input type="time" step={900} value={draft.atTime} onChange={(e) => set({ atTime: e.target.value })} />
                </Field>
              )}
            </div>
          )}
          {errors.headsUps && <ErrorLine>{errors.headsUps}</ErrorLine>}
        </div>

        <ul className="fp-list">
          <li>
            <Switch
              label="Phone alerts"
              help="An alert at each heads-up for everyone who has Reminders on in Profile → Alert types. Off: it only shows on Home."
              checked={draft.alerts}
              onChange={(on) => set({ alerts: on })}
            />
          </li>
        </ul>

        <p className="fp-small fp-muted" aria-live="polite">
          {preview}
        </p>
        {error && (
          <Notice tone="problem" live="assertive">
            {error}
          </Notice>
        )}
      </Stack>
    </Dialog>
  );
}

/** A field-style error under a group that isn't a single Field (the day chips, the heads-ups). */
function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <span className="fp-field-error" role="alert">
      <Icon name="alert-circle" />
      {children}
    </span>
  );
}
