"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { ApiError } from "@/lib/api";

type Toast = { id: number; tone: "success" | "error"; message: string };
const ToastContext = createContext<(tone: Toast["tone"], message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Free-tier API cold starts return 503: retry a few times; don't retry 4xx.
            retry: (count, err) => (err instanceof ApiError && err.status > 0 && err.status < 500 ? false : count < 3),
            retryDelay: (n) => Math.min(1500 * 2 ** n, 8000),
          },
        },
      }),
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastContext.Provider value={push}>
          {children}
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
            <AnimatePresence>
              {toasts.map((t) => (
                <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
                  className="glass pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-xl">
                  {t.tone === "success" ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <AlertTriangle className="size-5 shrink-0 text-error" />}
                  <span className="flex-1">{t.message}</span>
                  <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="text-text-2 hover:text-text">
                    <X className="size-4" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </ToastContext.Provider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
