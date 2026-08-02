import { useEffect } from "react";
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
import ProjectsList from "@/pages/ProjectsList";
import ProjectDetail from "@/pages/ProjectDetail";
import Informed from "@/pages/Informed";
import Legal from "@/pages/Legal";
import Accomplishments from "@/pages/Accomplishments";
import { SignInPage } from "@/pages/AuthPages";
import { AppLayout } from "@/components/AppLayout";
import { useSyncStatus, deviceId, syncDevice, syncUser } from "@/lib/storage";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useAuth } from "@/lib/useAuth";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Always send device UUID as Bearer. Backend prefers Passport session (Google)
// over Bearer when a valid session cookie is present — so in production the
// Google user ID is used automatically. In the workspace iframe where SameSite
// blocks cookies, the device UUID Bearer keeps things working.
setAuthTokenGetter(() => deviceId);

function AppRoutes() {
  const { data: auth, isLoading: authLoading } = useAuth();
  const status = useSyncStatus();

  useEffect(() => {
    if (authLoading) return;
    if (auth?.authenticated && auth.user) {
      // Logged in with Google — try to sync under the stable Google account ID.
      // If the session cookie is available (production), the backend uses the
      // Google user ID; if blocked (iframe), falls back to device UUID Bearer.
      void syncUser(auth.user.id.toString());
    } else {
      void syncDevice();
    }
  }, [authLoading, auth?.authenticated, auth?.user?.id]);

  if (authLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Spinner className="h-5 w-5" /> Loading…
        </div>
      </div>
    );
  }

  if (!auth?.authenticated && !import.meta.env.DEV) {
    return <SignInPage />;
  }

  if (status === "loading" || status === "idle") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Spinner className="h-5 w-5" /> Loading your goals…
        </div>
      </div>
    );
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
        <Route path="/projects" component={ProjectsList} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/informed" component={Informed} />
        <Route path="/legal" component={Legal} />
        <Route path="/accomplishments" component={Accomplishments} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
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
