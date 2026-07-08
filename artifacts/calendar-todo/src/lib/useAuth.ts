import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
        const res = await fetch("/api/auth/user");
        if (!res.ok) return { authenticated: false, user: null };
        return res.json() as Promise<AuthState>;
      } catch {
        return { authenticated: false, user: null };
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/logout", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth"] });
    },
  });
}
