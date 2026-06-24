import { NextRequest, NextResponse } from "next/server";

// Single shared-passphrase gate for the PromptGate dashboard.
// Not real auth — this exists purely so the deployed demo isn't a public,
// unauthenticated link. Anyone with the passphrase gets full access; there is
// no concept of separate users. See CLAUDE_v2.md §2 for the real auth design
// this would need if the project ever became multi-tenant.

const COOKIE_NAME = "pg_dashboard_auth";
const LOGIN_PATH = "/login";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow the login page itself and its POST target, or you can
  // never reach the page that lets you authenticate.
  if (pathname.startsWith(LOGIN_PATH) || pathname.startsWith("/api/auth-check")) {
    return NextResponse.next();
  }

  // Let static assets and Next internals through untouched.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  const expected = process.env.DASHBOARD_PASSPHRASE;

  if (!expected) {
    // Fail closed: if the env var isn't set, don't accidentally serve the
    // dashboard wide open because someone forgot to configure it.
    return new NextResponse("Dashboard passphrase not configured.", { status: 500 });
  }

  if (cookie === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on everything except the few paths excluded above (Next also needs
  // this matcher to avoid running on every static chunk for performance).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
