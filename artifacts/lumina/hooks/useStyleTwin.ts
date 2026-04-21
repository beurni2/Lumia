import { useCallback, useEffect, useState } from "react";
import { loadTwin, wipe, type StyleTwin } from "@workspace/style-twin";
import { ensureStyleTwinBackend } from "@/lib/styleTwinBackend";

export function useStyleTwin() {
  const [twin, setTwin] = useState<StyleTwin | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    ensureStyleTwinBackend();
    const t = await loadTwin();
    setTwin(t);
  }, []);

  const remove = useCallback(async () => {
    ensureStyleTwinBackend();
    await wipe();
    setTwin(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureStyleTwinBackend();
    loadTwin()
      .then((t) => {
        if (!cancelled) setTwin(t);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { twin, loading, isTrained: !!twin, refresh, remove };
}
