// 연구 현황판 서버. 페이지 파일은 public/ 에서 그대로 나가고, 여기서는 /api/ 요청만 처리한다.
// 누구나 주소만 알면 읽고 쓸 수 있는 구조라서, 들어오는 값은 전부 모양과 길이를 확인한 뒤에만 저장한다.

const LIMITS = { body: 5000, reply: 3000, nick: 30, requestBytes: 20000, posts: 3000, replies: 10000 };
const STAGE_RE = /^g[1-9]-s[1-9]$/;
const ID_RE = /^[a-f0-9]{32}$/;
const STATUSES = new Set(["done", "current", "todo"]);
const KINDS = new Set(["note", "question"]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

// 글자 정리: 줄바꿈을 통일하고, 화면에 안 보이는 제어 문자는 버린다.
function cleanText(value, max, emptyMsg, longMsg) {
  if (typeof value !== "string") throw new HttpError(400, emptyMsg);
  const text = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (!text) throw new HttpError(400, emptyMsg);
  if (text.length > max) throw new HttpError(400, longMsg + " " + max + "자까지 쓸 수 있습니다.");
  return text;
}
const cleanNick = value => cleanText(value, LIMITS.nick, "이름을 입력하세요.", "이름이 너무 깁니다.").replace(/\n/g, " ");
const cleanBody = (value, max) => cleanText(value, max, "내용을 입력하세요.", "내용이 너무 깁니다.");

async function readBody(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new HttpError(415, "요청 형식이 올바르지 않습니다.");
  if (Number(request.headers.get("content-length") || 0) > LIMITS.requestBytes) throw new HttpError(413, "내용이 너무 깁니다.");
  const raw = await request.text();
  if (raw.length > LIMITS.requestBytes) throw new HttpError(413, "내용이 너무 깁니다.");
  let data;
  try { data = JSON.parse(raw); } catch { throw new HttpError(400, "요청 형식이 올바르지 않습니다."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "요청 형식이 올바르지 않습니다.");
  return data;
}

// 다른 사이트에 심어 둔 코드가 방문자 몰래 글을 쓰지 못하게, 이 사이트에서 보낸 쓰기 요청만 받는다.
function requireSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "허용되지 않은 요청입니다.");
}

async function throttle(request, env) {
  if (!env.WRITE_LIMIT) return;
  const key = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.WRITE_LIMIT.limit({ key });
  if (!success) throw new HttpError(429, "잠시 뒤에 다시 시도하세요. 짧은 시간에 너무 많이 저장했습니다.");
}

const newId = () => crypto.randomUUID().replace(/-/g, "");
const now = () => new Date().toISOString();

async function getBoard(env) {
  const [posts, replies, statuses] = await env.DB.batch([
    env.DB.prepare("SELECT id, stage, kind, body, nick, created_at AS createdAt FROM posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?").bind(LIMITS.posts),
    env.DB.prepare("SELECT r.id, r.post_id AS post, r.body, r.nick, r.created_at AS createdAt FROM replies r JOIN posts p ON p.id = r.post_id WHERE r.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY r.created_at ASC LIMIT ?").bind(LIMITS.replies),
    env.DB.prepare("SELECT stage, status, updated_at AS updatedAt FROM stage_status"),
  ]);
  const map = {};
  let progressAt = null;
  for (const row of statuses.results) {
    map[row.stage] = row.status;
    if (!progressAt || row.updatedAt > progressAt) progressAt = row.updatedAt;
  }
  return json({ posts: posts.results, replies: replies.results, statuses: map, progressAt });
}

async function createPost(request, env) {
  const data = await readBody(request);
  if (typeof data.stage !== "string" || !STAGE_RE.test(data.stage)) throw new HttpError(400, "단계를 다시 고르세요.");
  if (!KINDS.has(data.kind)) throw new HttpError(400, "글 종류를 다시 고르세요.");
  const body = cleanBody(data.body, LIMITS.body);
  const nick = cleanNick(data.nick);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL").first("n");
  if (count >= LIMITS.posts) throw new HttpError(409, "글이 너무 많아 더 저장할 수 없습니다. 오래된 글을 지운 뒤 다시 시도하세요.");
  const post = { id: newId(), stage: data.stage, kind: data.kind, body, nick, createdAt: now() };
  await env.DB.prepare("INSERT INTO posts (id, stage, kind, body, nick, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(post.id, post.stage, post.kind, post.body, post.nick, post.createdAt).run();
  return json(post, 201);
}

async function createReply(request, env) {
  const data = await readBody(request);
  if (typeof data.post !== "string" || !ID_RE.test(data.post)) throw new HttpError(400, "대상 글을 찾을 수 없습니다.");
  const body = cleanBody(data.body, LIMITS.reply);
  const nick = cleanNick(data.nick);
  const parent = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL").bind(data.post).first();
  if (!parent) throw new HttpError(404, "대상 글이 지워졌습니다.");
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM replies WHERE deleted_at IS NULL").first("n");
  if (count >= LIMITS.replies) throw new HttpError(409, "답변이 너무 많아 더 저장할 수 없습니다.");
  const reply = { id: newId(), post: data.post, body, nick, createdAt: now() };
  await env.DB.prepare("INSERT INTO replies (id, post_id, body, nick, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(reply.id, reply.post, reply.body, reply.nick, reply.createdAt).run();
  return json(reply, 201);
}

async function softDelete(env, table, id) {
  if (!ID_RE.test(id)) throw new HttpError(404, "찾을 수 없습니다.");
  // table 은 아래 route() 에서 고정된 두 이름만 넘어온다.
  await env.DB.prepare("UPDATE " + table + " SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").bind(now(), id).run();
  return json({ ok: true });
}

async function setStatus(request, env) {
  const data = await readBody(request);
  // 한 단계만 바꾸거나({stage, status}), 여러 단계를 한꺼번에 바꾼다({changes: [...]}).
  // 한꺼번에 바꿀 때는 전부 되거나 전부 안 되므로 "완료만 되고 다음 단계는 그대로"인 반쪽 상태가 생기지 않는다.
  const changes = Array.isArray(data.changes) ? data.changes : [data];
  if (!changes.length || changes.length > 4) throw new HttpError(400, "진행 상태를 다시 고르세요.");
  const at = now();
  const statements = changes.map(c => {
    if (!c || typeof c.stage !== "string" || !STAGE_RE.test(c.stage)) throw new HttpError(400, "단계를 다시 고르세요.");
    if (!STATUSES.has(c.status)) throw new HttpError(400, "진행 상태를 다시 고르세요.");
    return env.DB.prepare("INSERT INTO stage_status (stage, status, updated_at) VALUES (?, ?, ?) ON CONFLICT(stage) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at")
      .bind(c.stage, c.status, at);
  });
  await env.DB.batch(statements);
  return json({ ok: true });
}

let analysisCache;
async function analysisProgress(env) {
  if (analysisCache && Date.now() - analysisCache.at < 30000) return json(analysisCache.data);
  try {
    const base = "https://mortality-receivers-police-luis.trycloudflare.com";
    const login = await fetch(base + "/login", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "한경승" }) });
    const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    if (!cookie || login.status >= 400) throw new Error("login status " + login.status + " cookies " + Boolean(cookie));
    const res = await fetch(base + "/api/recordings", { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { Cookie: cookie } });
    if (!res.ok) throw new Error("api status " + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.some(r => !Number.isInteger(r.done) || !Number.isInteger(r.total) || r.done < 0 || r.total < r.done)) throw new Error("invalid data");
    const done = rows.reduce((a,r) => a+r.done,0), total = rows.reduce((a,r) => a+r.total,0);
    const data = { done, total, percent: total ? Math.round(done/total*100) : 0, checkedAt: now() };
    analysisCache = { at: Date.now(), data };
    return json(data);
  } catch { return json({ error: "검수 사이트 로그인 확인 필요" }, 503); }
}

async function route(request, env, url) {
  const { pathname } = url, method = request.method;
  if (pathname === "/api/analysis-progress" && method === "GET") return analysisProgress(env);
  if (pathname === "/api/board" && method === "GET") return getBoard(env);

  if (method !== "POST" && method !== "PUT" && method !== "DELETE") throw new HttpError(405, "지원하지 않는 요청입니다.");
  requireSameOrigin(request, url);
  await throttle(request, env);

  if (pathname === "/api/posts" && method === "POST") return createPost(request, env);
  if (pathname === "/api/replies" && method === "POST") return createReply(request, env);
  if (pathname === "/api/status" && method === "PUT") return setStatus(request, env);
  const del = method === "DELETE" && pathname.match(/^\/api\/(posts|replies)\/([^/]+)$/);
  if (del) return softDelete(env, del[1], del[2]);
  throw new HttpError(404, "찾을 수 없습니다.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("api error", err && err.stack || err);
      return json({ error: "서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도하세요." }, 500);
    }
  },
};





