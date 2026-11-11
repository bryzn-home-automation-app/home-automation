import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

/*
 * The one button. Variants (KIT.md §7.11):
 *   primary   the ink key: the one main action of a view
 *   secondary the raised key (default)
 *   quiet     a text key (Cancel, "See all")
 *   danger    destructive; confirm it in a ConfirmDialog first. danger-quiet: "Remove" in a row
 * Sizes: default 44px; sm 36px with a 44px hit area (in panel heads, rows, tables); lg 56px
 * (the page's big key: "Clean", "Show the code"). Labels are verbs in sentence case.
 *
 * <Button> is a <button type="button">; <LinkButton> is a router link that looks the same,
 * for navigation ("See all" to another page). Never colour a button by hand.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  /** A leading icon. */
  icon?: IconName;
  /** A trailing icon ("See all →"). */
  iconEnd?: IconName;
}

/** The class string for a button look, for the rare element that can't be <Button> (a <label> for a file input). */
export function buttonClass({ variant = 'secondary', size = 'md', block }: ButtonLook = {}, className?: string): string {
  return cx(
    'fp-btn',
    variant !== 'secondary' && `fp-btn--${variant}`,
    size === 'sm' && 'fp-btn--sm',
    size === 'lg' && 'fp-btn--lg',
    block && 'fp-btn--block',
    className,
  );
}

function Inner({ icon, iconEnd, busy, busyLabel, children }: { icon?: IconName; iconEnd?: IconName; busy?: boolean; busyLabel?: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon && <Icon name={busy ? 'refresh' : icon} />}
      {busy && busyLabel != null ? busyLabel : children}
      {iconEnd && <Icon name={iconEnd} />}
    </>
  );
}

export interface ButtonProps extends ButtonLook, ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Working on it: the button is disabled (aria-disabled keeps it focusable and announced) and
   * shows `busyLabel` ("Saving…") if given, so a double tap can't send twice.
   */
  busy?: boolean;
  busyLabel?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, block, icon, iconEnd, busy, busyLabel, className, type = 'button', disabled, onClick, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, block }, className)}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      <Inner icon={icon} iconEnd={iconEnd} busy={busy} busyLabel={busyLabel}>{children}</Inner>
    </button>
  );
});

export type LinkButtonProps = ButtonLook & LinkProps;

/** A router link styled as a button (navigation, not an action). */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant, size, block, icon, iconEnd, className, children, ...rest },
  ref,
) {
  return (
    <Link ref={ref} className={buttonClass({ variant, size, block }, className)} {...rest}>
      <Inner icon={icon} iconEnd={iconEnd}>{children}</Inner>
    </Link>
  );
});

/** An outside link (a PDF, CoServ) styled as a button; opens in a new tab with rel=noopener. */
export function ExternalButton({ variant, size, block, icon, iconEnd = 'external-link', className, children, ...rest }: ButtonLook & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={buttonClass({ variant, size, block }, className)} target="_blank" rel="noopener noreferrer" {...rest}>
      <Inner icon={icon} iconEnd={iconEnd}>{children}</Inner>
    </a>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: an icon-only control is named by this. */
  label: string;
  /** quiet: no key face (dialog close, toolbars); primary: the ink key. */
  variant?: 'secondary' | 'quiet' | 'primary';
  /** 36px with a 44px hit area. */
  small?: boolean;
  /** A toggle's state (aria-pressed); the key inverts while on. */
  pressed?: boolean;
}

/** An icon-only key, always named. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'secondary', small, pressed, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('fp-icon-btn', variant !== 'secondary' && `fp-icon-btn--${variant}`, small && 'fp-icon-btn--sm', className)}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
});

/** A row of buttons; `end` aligns them right (a form's actions). */
export function ButtonRow({ end, className, children }: { end?: boolean; className?: string; children: ReactNode }) {
  return <div className={cx('fp-btn-row', end && 'fp-btn-row--end', className)}>{children}</div>;
}
