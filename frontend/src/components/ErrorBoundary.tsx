import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '../utils/chunkError';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors (and failed lazy chunks) so one broken page doesn't blank the app. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-[40vh] items-center justify-center p-4">
        <div className="max-w-md rounded-[28px] border border-appborder bg-appsurface-raised px-6 py-5 text-center shadow-[0_10px_30px_var(--appshadow)]">
          <h2 className="text-lg font-semibold text-apptext">Something went wrong</h2>
          <p className="mt-2 text-sm text-apptext-soft">
            {isChunkLoadError(this.state.error)
              ? 'A new version of the app is available.'
              : 'This page hit an unexpected error.'}{' '}
            Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl border border-appborder bg-appinset px-4 py-2 text-sm font-semibold text-apptext hover:border-appaccent"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
