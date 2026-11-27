"use client";

export type RazorpayInstance = { open: () => void; on: (event: string, cb: (r: { error?: { description?: string } }) => void) => void };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

/** Loads Razorpay Checkout.js once, on demand (only when someone actually pays). */
export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay]");
    const s = existing ?? Object.assign(document.createElement("script"), { src: "https://checkout.razorpay.com/v1/checkout.js", async: true });
    s.dataset.razorpay = "1";
    s.addEventListener("load", () => resolve(), { once: true });
    s.addEventListener("error", () => reject(new Error("load")), { once: true });
    if (!existing) document.body.appendChild(s);
  });
}

export type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id?: string; razorpay_subscription_id?: string; razorpay_signature: string };

/**
 * Opens Razorpay Checkout for a subscription or a one-time order. Resolves with Razorpay's response on success, null if
 * the person closed the window. Success here is only a hint: the server verifies every payment before granting access.
 */
export async function openRazorpayCheckout(opts: { keyId: string; name: string; description: string; subscriptionId?: string; orderId?: string; amountMinor?: number; currency?: string;
  prefill?: { name?: string; email?: string } }): Promise<RazorpaySuccess | null> {
  try { await loadRazorpay(); } catch { throw new Error("The payment window couldn't load. Check your connection and try again."); }
  return new Promise((resolve, reject) => {
    // A failed attempt doesn't end checkout: Razorpay keeps its window open so the buyer can retry with another card or
    // method. Remember the failure and report it only if they close the window without a successful retry.
    let lastError: Error | null = null;
    const rz = new window.Razorpay!({
      key: opts.keyId,
      name: opts.name,
      description: opts.description,
      ...(opts.subscriptionId ? { subscription_id: opts.subscriptionId } : { order_id: opts.orderId, amount: opts.amountMinor, currency: opts.currency }),
      prefill: opts.prefill,
      theme: { color: "#7C3AED" },
      handler: (r: RazorpaySuccess) => resolve(r),
      modal: { ondismiss: () => (lastError ? reject(lastError) : resolve(null)) },
    });
    rz.on("payment.failed", (r) => { lastError = new Error(r.error?.description ?? "The payment failed. No money was taken."); });
    rz.open();
  });
}
