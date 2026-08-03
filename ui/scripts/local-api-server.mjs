/**
 * Local stand-in for `vercel dev`, only used when testing real GitHub login/Coach Chat
 * locally (see VITE_FORCE_HOSTED_AUTH in ui/.env.local.example). Exists because vercel dev
 * can't get real Sensitive-marked secrets to a local process on this Vercel team account -
 * see #63 - so this runs the same `ui/api/*.ts` handlers directly instead, reading secrets
 * from ui/.env.local as plain env vars. Every handler already exports a standard
 * `{ fetch(req: Request): Promise<Response> }`, so this is just a router in front of them.
 */
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const envLocalPath = path.join(uiRoot, ".env.local");
try {
  process.loadEnvFile(envLocalPath);
} catch {
  console.warn(`[local-api-server] no ${envLocalPath} found - real secrets won't be set`);
}

const PORT = 3001;

const ROUTES = [
  [/^\/api\/auth(\/|$)/, "../api/auth/[...action].ts"],
  [/^\/api\/repo-file$/, "../api/repo-file.ts"],
  [/^\/api\/coach-chat$/, "../api/coach-chat.ts"],
  [/^\/api\/coach-chat-context$/, "../api/coach-chat-context.ts"],
  [/^\/api\/coach-chat-profile-status$/, "../api/coach-chat-profile-status.ts"],
  [/^\/api\/waitlist$/, "../api/waitlist.ts"],
  [/^\/api\/widget-snapshots$/, "../api/widget-snapshots.ts"],
];

async function resolveHandler(pathname) {
  const match = ROUTES.find(([re]) => re.test(pathname));
  if (!match) return null;
  const mod = await import(match[1]);
  return mod.default;
}

const server = createServer(async (nodeReq, nodeRes) => {
  const url = new URL(nodeReq.url, `http://${nodeReq.headers.host}`);
  const handler = await resolveHandler(url.pathname);
  if (!handler) {
    nodeRes.writeHead(404, { "content-type": "application/json" });
    nodeRes.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const chunks = [];
  for await (const chunk of nodeReq) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  const request = new Request(url, {
    method: nodeReq.method,
    headers: new Headers(Object.entries(nodeReq.headers).filter(([, v]) => v !== undefined)),
    body: nodeReq.method === "GET" || nodeReq.method === "HEAD" ? undefined : body,
  });

  let response;
  try {
    response = await handler.fetch(request);
  } catch (err) {
    console.error(`[local-api-server] ${url.pathname} threw:`, err);
    nodeRes.writeHead(500, { "content-type": "application/json" });
    nodeRes.end(JSON.stringify({ error: "local-api-server: handler threw", message: String(err) }));
    return;
  }

  // Object.fromEntries would comma-join repeated headers (e.g. two Set-Cookies) into one,
  // which browsers can't parse as separate cookies - none of today's handlers ever emit two,
  // but write them out individually via appendHeader so that stays true if one ever does.
  const headers = {};
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === "set-cookie") continue;
    headers[key] = value;
  }
  nodeRes.writeHead(response.status, headers);
  for (const cookie of response.headers.getSetCookie()) {
    nodeRes.appendHeader("set-cookie", cookie);
  }
  nodeRes.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
});

server.listen(PORT, () => {
  console.log(`[local-api-server] listening on http://localhost:${PORT}`);
});
