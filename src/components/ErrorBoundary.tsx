import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center bg-white rounded-3xl border border-red-200 shadow-xl max-w-2xl mx-auto my-12 animate-in fade-in zoom-in-95">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 font-black text-2xl">
            ⚠️
          </div>
          <h3 className="text-xl font-extrabold text-gray-900 mb-2">Si è verificato un errore temporaneo</h3>
          <p className="text-xs text-gray-500 font-semibold leading-relaxed mb-4">
            Si è verificato un problema imprevisto durante il rendering della pagina.
          </p>
          <pre className="p-4 bg-gray-900 text-red-400 rounded-xl text-left text-xs overflow-x-auto font-mono mb-6 max-h-48 border border-gray-800">
            {this.state.error?.toString()}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="bg-gray-800 hover:bg-gray-900 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition cursor-pointer"
            >
              Ricarica Pagina
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition cursor-pointer"
            >
              Torna alla Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
export default ErrorBoundary;
