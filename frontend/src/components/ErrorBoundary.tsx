import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForChunkError } from '../utils/chunkError';
import { Icon } from './ui/Icon';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors (and failed lazy chunks) so one broken page doesn't blank the app.
 * The shell wraps each page in one (keyed on the path, so moving to another page clears
 * it); main.tsx wraps the whole tree in another, for errors outside any page.
 */
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
    const update = isChunkLoadError(this.state.error);
    return (
      <div role="alert" className="flex min-h-[40vh] items-center justify-center p-4">
        <div className={`fp-empty w-full max-w-md ${update ? 'bg-appsurface' : 'fp-empty--error'}`}>
          <Icon name={update ? 'refresh' : 'alert-triangle'} />
          <h2 className="fp-empty-title">{update ? 'A new version is ready' : 'Something went wrong'}</h2>
          <p className="fp-empty-text">
            {update ? 'The app was updated while it was open.' : 'This page hit an unexpected error.'} Reloading
            usually fixes it.
          </p>
          <button type="button" onClick={() => window.location.reload()} className="fp-btn fp-btn--primary">
            <Icon name="refresh" />
            Reload
          </button>
        </div>
      </div>
    );
  }
}
