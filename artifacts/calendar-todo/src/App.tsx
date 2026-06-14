import { useEffect, useRef } from "react";
import {
  Switch,
  Route,
  Redirect,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";
import DayView from "@/pages/DayView";
import Upcoming from "@/pages/Upcoming";
import Goals from "@/pages/Goals";
import Analytics from "@/pages/Analytics";
import Journal from "@/pages/Journal";
import Mind from "@/pages/Mind";
import Assistant from "@/pages/Assistant";
import Documents from "@/pages/Documents";
import { SignInPage, SignUpPage } from "@/pages/AuthPages";
import { Landing } from "@/pages/Landing";
import { AppLayout } from "@/components/AppLayout";
import { useServerSync } from "@/lib/useServerSync";
import { clerkAppearance, clerkLocalization } from "@/lib/clerkAppearance";

const queryClient = new QueryClient();

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev, auto-set in prod. Do NOT gate on env.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

function AuthedApp() {
  const status = useServerSync();

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
        <Route path="/upcoming" component={Upcoming} />
        <Route path="/goals" component={Goals} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/journal" component={Journal} />
        <Route path="/mind" component={Mind} />
        <Route path="/assistant" component={Assistant} />
        <Route path="/documents" component={Documents} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function ProtectedRoutes() {
  const [location] = useLocation();
  return (
    <>
      <Show when="signed-in">
        <AuthedApp />
      </Show>
      <Show when="signed-out">
        {location === "/" ? <Landing /> : <Redirect to="/" />}
      </Show>
    </>
  );
}

// Invalidate cached data when the signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={clerkLocalization}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ProtectedRoutes} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
