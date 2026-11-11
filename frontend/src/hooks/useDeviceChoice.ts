import { useCallback, useState } from 'react';

/**
 * A choice remembered on this device (localStorage), for a view someone picks once and expects
 * to find again (Home's Week / 24 hours weather). Anyone who hasn't chosen gets `fallback`; an
 * unknown stored value falls back too. Storage can be missing or refuse (private mode, blocked
 * site data): the choice then simply lasts for the visit.
 */
export function useDeviceChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback((next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* not remembered on this device; the choice still holds for the visit */
    }
  }, [key]);
  return [value, set];
}
