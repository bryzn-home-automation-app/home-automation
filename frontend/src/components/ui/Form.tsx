import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

/*
 * Forms (KIT.md §7.13). A Field is a silk-screen label, one control, and an optional help or
 * error line, and it wires them together: the label's htmlFor, the control's id,
 * aria-describedby (help and error) and aria-invalid all come from the Field, so a control
 * inside one can't end up nameless (B-042).
 *
 *   <Field label="Job title" help="A few words" error={errors.title}>
 *     <Input value={title} onChange={(e) => setTitle(e.target.value)} />
 *   </Field>
 *
 * Every text control is 16px (iOS zooms into anything smaller; B-009). Checkbox and Radio
 * carry their own label and need no Field; group radios in a <Fieldset legend>.
 */

interface FieldWiring {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required?: boolean;
}
const FieldContext = createContext<FieldWiring | null>(null);

/** The wiring a control inside a Field picks up; explicit props win. */
function useFieldWiring(props: Pick<InputHTMLAttributes<HTMLElement>, 'id' | 'aria-describedby' | 'aria-invalid' | 'required'>) {
  const f = useContext(FieldContext);
  return {
    id: props.id ?? f?.id,
    'aria-describedby': cx(f?.describedBy, props['aria-describedby']) || undefined,
    'aria-invalid': props['aria-invalid'] ?? (f?.invalid || undefined),
    required: props.required ?? f?.required,
  };
}

export interface FieldProps {
  label: ReactNode;
  /** One line of guidance under the control. */
  help?: ReactNode;
  /** What is wrong and how to fix it ("Enter an amount like 38.97"). Marks the control invalid. */
  error?: ReactNode;
  /** Marks the control required; the label says "(optional)" on the others only if you pass `optional`. */
  required?: boolean;
  optional?: boolean;
  /** Spans both columns of a FormGrid. */
  wide?: boolean;
  /** The control's id, if it needs a known one. */
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, help, error, required, optional, wide, id, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto.replace(/[^a-zA-Z0-9]/g, '')}`;
  const helpId = help != null ? `${controlId}-help` : undefined;
  const errorId = error != null && error !== false ? `${controlId}-error` : undefined;
  const wiring: FieldWiring = { id: controlId, describedBy: cx(errorId, helpId) || undefined, invalid: !!errorId, required };
  return (
    <div className={cx('fp-field', errorId && 'fp-is-invalid', wide && 'fp-is-wide', className)}>
      <label className="fp-label" htmlFor={controlId}>
        {label}
        {optional && <span className="fp-muted"> (optional)</span>}
      </label>
      <FieldContext.Provider value={wiring}>{children}</FieldContext.Provider>
      {errorId && (
        <span className="fp-field-error" id={errorId}>
          <Icon name="alert-circle" />
          {error}
        </span>
      )}
      {helpId && <span className="fp-field-help" id={helpId}>{help}</span>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** A leading icon inside the box (search). */
  icon?: IconName;
  /** Mono text: codes, passwords, IDs. */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ icon, mono, className, type = 'text', ...rest }, ref) {
  const wiring = useFieldWiring(rest);
  const input = <input ref={ref} type={type} className={cx('fp-input', mono && 'fp-input--mono', className)} {...rest} {...wiring} />;
  if (!icon) return input;
  return (
    <div className="fp-input-wrap">
      <Icon name={icon} />
      {input}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  const wiring = useFieldWiring(rest);
  return <textarea ref={ref} className={cx('fp-textarea', className)} {...rest} {...wiring} />;
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** The choices; or pass <option>s as children. */
  options?: readonly SelectOption[];
}

/** A native select (the phone's own picker) in the kit's recessed box. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, className, children, ...rest }, ref) {
  const wiring = useFieldWiring(rest);
  return (
    <span className={cx('fp-select', className)}>
      <select ref={ref} {...rest} {...wiring}>
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
        {children}
      </select>
      <Icon name="chevron-down" />
    </span>
  );
});

export interface CheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  help?: ReactNode;
}

/** A checkbox with its label; the whole row (44px) toggles it. */
export const Checkbox = forwardRef<HTMLInputElement, CheckProps>(function Checkbox({ label, help, className, ...rest }, ref) {
  return (
    <label className={cx('fp-check', className)}>
      <input ref={ref} type="checkbox" {...rest} />
      <CheckText label={label} help={help} />
    </label>
  );
});

/** A radio with its label. Group them in a <Fieldset legend="Priority"> with one `name`. */
export const Radio = forwardRef<HTMLInputElement, CheckProps>(function Radio({ label, help, className, ...rest }, ref) {
  return (
    <label className={cx('fp-radio', className)}>
      <input ref={ref} type="radio" {...rest} />
      <CheckText label={label} help={help} />
    </label>
  );
});

function CheckText({ label, help }: { label: ReactNode; help?: ReactNode }) {
  if (help == null) return <span>{label}</span>;
  return (
    <span className="fp-check-text">
      <span>{label}</span>
      <span className="fp-check-help">{help}</span>
    </span>
  );
}

/** A labelled group of checkboxes or radios. */
export function Fieldset({ legend, className, children }: { legend: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cx('fp-fieldset', className)}>
      <legend className="fp-label">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** Two fields side by side from 640px (a Field with `wide` spans both). */
export function FormGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('fp-form-grid', className)}>{children}</div>;
}

/** An input with a key beside it (a password + Copy). */
export function InputGroup({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('fp-input-group', className)}>{children}</div>;
}
