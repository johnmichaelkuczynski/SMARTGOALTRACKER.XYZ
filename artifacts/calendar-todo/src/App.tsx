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
import { SignInPage } from "@/pages/AuthPages";
import { AppLayout } from "@/components/AppLayout";
import { useServerSync } from "@/lib/useServerSync";
import { deviceId } from "@/lib/storage";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { useAuth } from "@/lib/useAuth";

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

setAuthTokenGetter(() => deviceId);

function AppRoutes() {
  const { data: auth, isLoading: authLoading } = useAuth();
  const status = useServerSync();

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
