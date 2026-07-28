import { clearCookie, SESSION_COOKIE } from "./_lib/session.js";

export default {
  async fetch(): Promise<Response> {
    const headers = new Headers();
    headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
    headers.set("Location", "/");
    return new Response(null, { status: 302, headers });
  },
};
