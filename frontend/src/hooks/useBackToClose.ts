import { useEffect, useRef } from 'react';

/**
 * While `active` (an overlay is open), the phone's back gesture or button closes it
 * instead of leaving the page underneath. Opening adds a history entry for the same
 * URL; going back pops it and calls `onClose`. Closing any other way removes the entry
 * again, unless the app has since navigated somewhere else.
 */
export function useBackToClose(onClose: () => void, active = true): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const token = Math.random().toString(36).slice(2);
    let pushed = false;
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    // Deferred so StrictMode's mount-unmount-mount in dev doesn't leave a stray entry
    // whose asynchronous back() would then close the overlay it just reopened.
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...window.history.state, overlay: token }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', onPop);
      if (pushed && !popped && window.history.state?.overlay === token) window.history.back();
    };
  }, [active]);
}

export default useBackToClose;
