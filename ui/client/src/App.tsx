import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import AuthError from "./pages/AuthError";
import Workouts from "./pages/Workouts";
import WorkoutTimer from "./pages/workout-timer";
import MonthlyAnalytics from "./pages/MonthlyAnalytics";
import SportAnalyticsBadminton from "./pages/SportAnalyticsBadminton";
import SportAnalyticsRunning from "./pages/SportAnalyticsRunning";
import SportAnalyticsCalisthenics from "./pages/SportAnalyticsCalisthenics";
import CoachChat from "./pages/CoachChat";
import WidgetGallery from "./pages/WidgetGallery";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path="/workouts" component={Workouts} />
      <Route path="/workouts/:id" component={WorkoutTimer} />
      <Route path="/analytics/running" component={SportAnalyticsRunning} />
      <Route path="/analytics/monthly" component={MonthlyAnalytics} />
      <Route path="/analytics/badminton" component={SportAnalyticsBadminton} />
      <Route path="/analytics/calisthenics" component={SportAnalyticsCalisthenics} />
      <Route path="/coach-chat" component={CoachChat} />
      <Route path="/gallery" component={WidgetGallery} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Gate — on the hosted multi-tenant deployment, blocks the dashboard behind
 * GitHub sign-in and repo resolution. On local `npm run dev` (no /api routes
 * served), AuthContext resolves to "local" immediately and this is a no-op.
 */
function Gate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("auth_error");
  const switching = params.get("switch_repo") === "1";

  if (authError) return <AuthError type={authError} />;
  if (auth.status === "loading") return null;
  if (auth.status === "unauthenticated") return <Login />;
  if (auth.status === "onboarding") return <Onboarding />;
  if (switching && auth.status === "authenticated") return <Onboarding switchMode />;
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <Gate>
              <Router />
            </Gate>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
