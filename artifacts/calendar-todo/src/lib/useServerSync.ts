import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import { resetForSignOut, syncUser, useSyncStatus } from "./storage";

/**
 * Drives the per-user server sync lifecycle: loads the signed-in user's state
 * on sign-in and clears it on sign-out. Returns the current sync status.
 */
export function useServerSync() {
  const { isLoaded, userId } = useAuth();
  const status = useSyncStatus();

  useEffect(() => {
    if (!isLoaded) return;
    if (userId) {
      void syncUser(userId);
    } else {
      resetForSignOut();
    }
  }, [isLoaded, userId]);

  return status;
}
