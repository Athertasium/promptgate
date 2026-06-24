import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "pg_dashboard_auth";

export async function POST(request: NextRequest) {
  const { passphrase } = await request.json();
  const expected = process.env.DASHBOARD_PASSPHRASE;

  if (!expected || passphrase !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, expected, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return response;
}
