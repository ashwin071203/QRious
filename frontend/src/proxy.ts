import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: if no attendee session cookie is present, skip loading the app shell.
 * The API enforces authorization on every request (PRD §12, 07 §3).
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("__Host-qr_s") || request.cookies.has("qr_s");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "?signin=required";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
