import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

export function useAuth() {
  return useQuery<AuthState>({
    queryKey: ["auth"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/auth/user", {
          credentials: "include",
        });
        if (!response.ok) return { authenticated: false, user: null };
        return response.json() as Promise<AuthState>;
      } catch {
        return { authenticated: false, user: null };
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}