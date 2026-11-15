import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics local; never send listener data or playback history to a server.
    console.error('Harmonia UI recovered from a render error.', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="grid min-h-screen place-items-center bg-[#09090b] px-6 text-white">
          <section role="alert" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#18181b] p-6 text-center">
            <h1 className="text-xl font-bold">Harmonia hit an unexpected error</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Your saved library and offline files have not been intentionally cleared. Reload the app to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black"
            >
              Reload Harmonia
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
