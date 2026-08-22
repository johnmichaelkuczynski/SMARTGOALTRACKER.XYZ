import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clearActiveSessionState } from "./storage";

export type AuthUser = {
  id: number;
  username: string;
  email?: string | null;
  displayName?: string | null;
};

export type AuthState = {
  authenticated: boolean;
  user: AuthUser | null;
};

export async function startGoogleSignIn(): Promise<void> {
  if (!import.meta.env.DEV) {
    window.location.assign("/api/auth/google");
    return;
  }
  const response = await fetch("/api/auth/dev-owner-login", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Could not open development workspace.");
  window.location.replace("/");
}

export function useAuth() {
  return useQuery<AuthState>({
    queryKey: ["auth"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/auth/user", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return { authenticated: false, user: null };
        return response.json() as Promise<AuthState>;
      } catch {
        return { authenticated: false, user: null };
      }
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Logout failed");
    },
    onMutate: async () => {
      const cancellation = queryClient.cancelQueries({ queryKey: ["auth"] });
      clearActiveSessionState();
      queryClient.setQueryData<AuthState>(["auth"], {
        authenticated: false,
        user: null,
      });
      await cancellation;
    },
    onSuccess: () => {
      queryClient.setQueryData<AuthState>(["auth"], {
        authenticated: false,
        user: null,
      });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}