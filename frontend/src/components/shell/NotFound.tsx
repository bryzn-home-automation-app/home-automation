import { Link } from 'react-router-dom';
import { Icon } from '../ui/Icon';

/**
 * An address the app doesn't have. It sits outside the shell (signed out, a guest
 * link, a typo), so it brings its own bare faceplate: enamel, one panel, one way on.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-appbg px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div className="fp-panel fp-stack fp-stack--m w-full max-w-sm items-center text-center">
        <p className="fp-label">Not found</p>
        <h1 className="text-title font-semibold text-apptext">There's no page here</h1>
        <p className="fp-small fp-muted">The address may be old or mistyped.</p>
        <Link to="/" className="fp-btn fp-btn--primary fp-mt-s">
          <Icon name="home" />
          Go to Home
        </Link>
      </div>
    </main>
  );
}
