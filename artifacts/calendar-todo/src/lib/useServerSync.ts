import { useEffect } from "react";
import { syncDevice, useSyncStatus } from "./storage";

export function useServerSync() {
  const status = useSyncStatus();
  useEffect(() => {
    void syncDevice();
  }, []);
  return status;
}
