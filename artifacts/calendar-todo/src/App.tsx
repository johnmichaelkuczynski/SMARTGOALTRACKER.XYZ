import {
  Switch,
  Route,
  Router as WouterRouter,
} from "wouter";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import DayView from "@/pages/DayView";
import AllTasks from "@/pages/AllTasks";
import Rules from "@/pages/Rules";
import Upcoming from "@/pages/Upcoming";
import Goals from "@/pages/Goals";
import Analytics from "@/pages/Analytics";
import Journal from "@/pages/Journal";
import Mind from "@/pages/Mind";
import Assistant from "@/pages/Assistant";
import Documents from "@/pages/Documents";
import AdminPage from "@/pages/AdminPage";
import { AppLayout } from "@/components/AppLayout";
import { useServerSync } from "@/lib/useServerSync";
import { deviceId } from "@/lib/storage";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useAuth } from "@/lib/useAuth";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

setAuthTokenGetter(() => deviceId);

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function LoadingScreen({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Spinner className="h-5 w-5" />
        {message ?? "Loading…"}
      </div>
    </div>
  );
}

function LoginWall() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-1">
          <div className="font-serif text-4xl tracking-tight text-foreground">
            Goal Tracker
          </div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Honest follow-through
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-8 space-y-6">
          <div className="space-y-1 text-center">
            <h2 className="font-serif text-xl text-foreground">
              Sign in to continue
            </h2>
            <p className="text-sm text-muted-foreground">
              This app is private. A Google account is required.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = "/api/auth/google";
            }}
            className="w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <GoogleIcon className="h-5 w-5 shrink-0" />
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const status = useServerSync();

  if (status === "loading" || status === "idle") {
    return <LoadingScreen message="Loading your goals…" />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DayView} />
        <Route path="/all" component={AllTasks} />
        <Route path="/commands" component={Rules} />
        <Route path="/upcoming" component={Upcoming} />
        <Route path="/goals" component={Goals} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/journal" component={Journal} />
        <Route path="/mind" component={Mind} />
        <Route path="/assistant" component={Assistant} />
        <Route path="/documents" component={Documents} />
        <Route path="/admin" component={AdminPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function AppRoutes() {
  const { data: auth, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!auth?.authenticated) return <LoginWall />;
  return <AuthenticatedApp />;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppRoutes />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
