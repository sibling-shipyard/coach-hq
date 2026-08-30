/**
 * The app's render-crash net — and the only thing that reports one.
 *
 * React unwinds to the nearest boundary before `window.onerror` fires, so Sentry's global
 * handler never sees a render crash: without the `componentDidCatch` below, the most visible
 * failure the athlete can hit is the one failure we have no record of.
 *
 * Sentry ships its own `<Sentry.ErrorBoundary>`, but swapping to it would mean rewriting this
 * fallback against its render-prop contract. `captureReactException` is the exact call that
 * component makes internally, so we get its event shape — component stack linked as the error's
 * cause, so Sentry groups and renders it the same — and keep this UI untouched.
 */
import { cn } from "@/lib/utils";
import * as Sentry from "@sentry/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // `handled: true` because the fallback below renders — the athlete sees a screen, not a
    // white page. Same mechanism string Sentry's own boundary sends, so these group with it.
    Sentry.captureReactException(error, errorInfo, {
      mechanism: { handled: true, type: "auto.function.react.error_boundary" },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle size={48} className="text-destructive mb-6 flex-shrink-0" />

            <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer",
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
