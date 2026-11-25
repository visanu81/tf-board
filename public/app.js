(() => {
  "use strict";

  // 연구 단계 구성. col은 발표자료의 5칸 진행선에서 차지하는 칸이다.
  // 단계 id는 "g숫자-s숫자" 모양을 지켜야 서버가 받아 준다.
  const GROUPS = [
    { id: "g1", label: "1그룹", name: "무전 문자화", desc: "현장 보고를 문자로 전환 (STT)", stages: [
      { id: "g1-s1", title: "샘플 수령", note: "강원도소방학교", status: "done", col: "1" },
      { id: "g1-s2", title: "샘플 분석", note: "샘플 동영상", status: "current", col: "2" },
      { id: "g1-s3", title: "훈련자료 확보", note: "라벨링", status: "todo", col: "3" },
      { id: "g1-s4", title: "인식 최적화", note: "전·후처리", status: "todo", col: "4" },
      { id: "g1-s5", title: "정확도 시험", note: "필요 시 파인튜닝", status: "todo", col: "5" } ] },
    { id: "g2", label: "2그룹", name: "AI 지휘지원", desc: "상황을 정리하고 판단을 지원 (AI참모)", stages: [
      { id: "g2-s1", title: "기능 구현·검증", note: "인명·위치 관리", status: "current", col: "2" },
      { id: "g2-s2", title: "문자화 결과 연동", note: "1그룹 결과 적용", status: "todo", col: "3 / span 2" },
      { id: "g2-s3", title: "연계 기능 검증", note: "3그룹에 결과 전달", status: "todo", col: "5" } ] },
    { id: "g3", label: "3그룹", name: "훈련·효과 검증", desc: "체크리스트로 지휘지원 효과 검증", stages: [
      { id: "g3-s1", title: "평가자료 수령", note: "시나리오·체크리스트", status: "done", col: "1" },
      { id: "g3-s2", title: "자료 분석", note: "훈련 시나리오·평가 항목", status: "current", col: "2" },
      { id: "g3-s3", title: "적용 훈련", note: "AI 지휘지원", status: "todo", col: "3 / span 2" },
      { id: "g3-s4", title: "효과 검증", note: "훈련 결과 평가", status: "todo", col: "5" } ] }
  ];
  const STAGES = GROUPS.flatMap(g => g.stages.map(s => Object.assign({ group: g }, s)));
  const STAGE = Object.fromEntries(STAGES.map(s => [s.id, s]));
  const STATUS_LABEL = { done: "완료", current: "현재", todo: "예정" };
  const CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 6.3l2.4 2.4 4.8-5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const POLL_MS = 20000;

  const state = {
    overrides: {}, progressAt: null,
    selected: (STAGES.find(s => s.status === "current") || STAGES[0]).id,
    scope: "stage", kind: "all", newKind: "note",
    posts: [], replies: [], loaded: false, offline: false, busyStatus: false
  };

  const $ = id => document.getElementById(id);
  async function loadAnalysis() {
    try {
      const res = await fetch("/api/analysis-progress", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error("unavailable");
      $("analysis-progress").textContent = `검수 진행률 ${data.percent}% · ${data.done.toLocaleString()} / ${data.total.toLocaleString()}구간 완료`;
      $("analysis-bar").value = data.percent;
      $("analysis-bar").hidden = false;
      $("stage-analysis-bar").value = data.percent;
      $("stage-analysis-label").textContent = `검수 ${data.percent}%`;
      $("stage-analysis-label").title = `${data.total.toLocaleString()}구간 중 ${data.done.toLocaleString()}구간 완료`;
      $("analysis-updated").textContent = "확인: " + new Date(data.checkedAt).toLocaleString("ko-KR") + " · 30초마다 자동 갱신";
    } catch {
      $("analysis-progress").textContent = "분석 사이트 연결 지연 · 자동으로 다시 확인합니다.";
      if ($("stage-analysis-label")) $("stage-analysis-label").textContent = $("stage-analysis-bar").hasAttribute("value") ? `검수 ${$("stage-analysis-bar").value}% · 연결 지연` : "진행률 연결 대기";
      $("analysis-updated").textContent = "막대는 마지막으로 확인한 값입니다.";
    }
  }
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dateFmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmt = iso => { const d = new Date(iso); return isNaN(d) ? "" : dateFmt.format(d); };
  const statusOf = id => STATUS_LABEL[state.overrides[id]] ? state.overrides[id] : STAGE[id].status;
  const repliesOf = id => state.replies.filter(r => r.post === id);
  const nameOf = x => x.nick || "이름 없음";
  const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 서버와 주고받기 ---------- */
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method, cache: "no-store",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요."); }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || "저장하지 못했습니다. 잠시 뒤 다시 시도하세요.");
    return data;
  }

  // 서버가 준 값도 모양을 확인한 것만 화면에 쓴다.
  const cleanRow = (x, isReply) => {
    if (!x || typeof x.id !== "string" || typeof x.body !== "string") return null;
    if (isReply ? typeof x.post !== "string" : !STAGE[x.stage]) return null;
    return {
      id: x.id, body: x.body, nick: typeof x.nick === "string" ? x.nick : "",
      createdAt: typeof x.createdAt === "string" ? x.createdAt : "",
      stage: isReply ? undefined : x.stage, post: isReply ? x.post : undefined,
      kind: x.kind === "question" ? "question" : "note"
    };
  };

  let loadSeq = 0;
  async function load() {
    const mine = ++loadSeq;
    try {
      const data = await api("GET", "/api/board");
      if (mine !== loadSeq) return;   // 더 새로운 요청이 이미 나갔으면 이 응답은 버린다
      state.posts = (Array.isArray(data.posts) ? data.posts : []).map(x => cleanRow(x, false)).filter(Boolean);
      state.replies = (Array.isArray(data.replies) ? data.replies : []).map(x => cleanRow(x, true)).filter(Boolean);
      state.overrides = data.statuses && typeof data.statuses === "object" ? data.statuses : {};
      state.progressAt = typeof data.progressAt === "string" ? data.progressAt : null;
      state.loaded = true; state.offline = false;
    } catch (e) {
      if (mine !== loadSeq) return;
      state.offline = true;
    }
    renderAll();
  }

  /* ---------- 진행판 ---------- */
  const refs = {}, groupRefs = {};
  function buildBoard() {
    const board = $("board");
    for (const g of GROUPS) {
      const row = h("div", "group");
      const label = h("div", "g-label");
      const prog = h("p", "g-prog");
      label.append(h("p", "g-no", g.label), h("h3", "g-name", g.name), h("p", "g-desc", g.desc), prog);
      const tl = h("div", "timeline");
      g.stages.forEach((s, i) => {
        const b = h("button", "stage"); b.type = "button"; b.style.setProperty("--col", s.col);
        if (i === 0) b.classList.add("first");
        if (i === g.stages.length - 1) b.classList.add("last");
        const slot = h("span", "badge-slot"), badge = h("span", "badge");
        slot.append(badge);
        const node = h("span", "node"); node.innerHTML = CHECK;
        const count = h("span", "s-count");
        const latest = h("span", "s-latest");
        b.setAttribute("aria-haspopup", "dialog");
        b.setAttribute("aria-controls", "stage-dialog");
        b.append(slot, node, h("span", "s-title", s.title), h("span", "s-note", s.note), count);
        if (s.id === "g1-s2") {
          const meter = h("span", "stage-progress");
          const label = h("span", "stage-progress-label", "진행률 확인 중");
          label.id = "stage-analysis-label";
          const bar = h("progress", "stage-progress-bar");
          bar.id = "stage-analysis-bar";
          bar.max = 100;
          bar.setAttribute("aria-label", "샘플 분석 검수 진행률");
          meter.append(label, bar);
          meter.setAttribute("role", "link");
          meter.tabIndex = 0;
          meter.title = "검수 사이트 새 창으로 열기";
          meter.setAttribute("aria-label", "샘플 검수 진행률 · 검수 사이트 새 창으로 열기");
          const openReview = e => {
            e.preventDefault();
            e.stopPropagation();
            window.open("https://mortality-receivers-police-luis.trycloudflare.com/", "_blank", "noopener,noreferrer");
          };
          meter.addEventListener("click", openReview);
          meter.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openReview(e); });
          b.append(meter);
        }
        b.append(latest);
        b.addEventListener("click", () => selectStage(s.id, true));
        tl.append(b); refs[s.id] = { b, badge, count, latest };
      });
      row.append(label, tl); board.append(row); groupRefs[g.id] = prog;
    }
  }

  function stageCounts() {
    const c = {};
    for (const p of state.posts) {
      const x = c[p.stage] || (c[p.stage] = { note: 0, q: 0, wait: 0 });
      if (p.kind === "question") { x.q++; if (!repliesOf(p.id).length) x.wait++; } else x.note++;
    }
    return c;
  }
  const waitingQuestions = () => state.posts.filter(p => p.kind === "question" && !repliesOf(p.id).length)
    .sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);

  function updateBoard() {
    const counts = stageCounts();
    const tally = { done: 0, current: 0, todo: 0 };
    for (const s of STAGES) {
      const st = statusOf(s.id), r = refs[s.id];
      tally[st]++;
      r.b.classList.toggle("is-done", st === "done");
      r.b.classList.toggle("is-current", st === "current");
      r.b.setAttribute("aria-pressed", String(state.selected === s.id));
      r.badge.textContent = STATUS_LABEL[st];
      r.badge.className = st === "current" ? "badge" : "sr-only";
      const c = counts[s.id];
      const parts = [];
      if (c && c.note) parts.push("글 " + c.note);
      if (c && c.q) parts.push("질문 " + c.q);
      r.count.textContent = parts.length ? parts.join(" · ") : "기록 없음";
      r.count.className = "s-count" + (parts.length ? "" : " none");
      if (c && c.wait) r.count.append(h("span", "w", "답변 대기 " + c.wait));
      const lastQ = state.posts.filter(p => p.stage === s.id && p.kind === "question").sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
      r.latest.textContent = lastQ ? "Q. " + lastQ.body.replace(/\s+/g, " ") : "";
      r.latest.title = lastQ ? lastQ.body : "";
      r.b.setAttribute("aria-label", s.title + " · " + STATUS_LABEL[st] + " · " + r.count.textContent);
    }
    for (const g of GROUPS) {
      const done = g.stages.filter(s => statusOf(s.id) === "done").length;
      groupRefs[g.id].textContent = g.stages.length + "단계 중 " + done + "단계 완료";
    }
    $("n-done").textContent = tally.done;
    $("n-current").textContent = tally.current;
    $("n-todo").textContent = tally.todo;
    $("n-total").textContent = "전체 " + STAGES.length + "단계";
    const bar = $("bar"); bar.textContent = "";
    for (const g of GROUPS) {
      const grp = h("span", "bar-group"); grp.style.flex = String(g.stages.length);
      for (const s of g.stages) grp.append(h("i", statusOf(s.id)));
      bar.append(grp);
    }
    $("basis").textContent = state.progressAt ? "진행 상태 수정: " + fmt(state.progressAt) : "발표자료 기준 초기 상태";
    const w = waitingQuestions().length, wb = $("wait-btn");
    wb.textContent = "답변 대기 질문 " + w + "건";
    wb.classList.toggle("has", w > 0);
  }

  /* ---------- 선택한 단계 ---------- */
  function updatePanelHead() {
    const s = STAGE[state.selected], st = statusOf(s.id);
    $("p-path").textContent = s.group.label + " · " + s.group.name;
    $("p-title").textContent = s.title;
    $("p-note").textContent = s.note;
    $("analysis-link").hidden = s.id !== "g1-s2";
    for (const b of $("status-edit").children) {
      b.setAttribute("aria-pressed", String(b.dataset.status === st));
      b.disabled = state.busyStatus || !state.loaded;
    }
    // "현재" 단계에서만 한 번에 넘기는 버튼을 보여 준다.
    const adv = $("advance-btn");
    adv.hidden = st !== "current";
    adv.textContent = nextStageOf(s.id) ? "완료하고 다음 단계로" : "마지막 단계 완료";
    adv.disabled = state.busyStatus || !state.loaded;
    for (const b of $("scope-seg").children) b.setAttribute("aria-pressed", String(b.dataset.scope === state.scope));
    for (const b of $("kind-seg").children) b.setAttribute("aria-pressed", String(b.dataset.kind === state.kind));
    $("composer-title").textContent = "‘" + s.title + "’ 단계에 남기기";
  }

  function updateComposer() {
    const q = state.newKind === "question";
    for (const b of $("new-kind").children) b.setAttribute("aria-pressed", String(b.dataset.newkind === state.newKind));
    $("body-label").textContent = q ? "질문 내용" : "글 내용";
    $("post-body").placeholder = q ? "이 단계에서 궁금한 점을 적으세요." : "이 단계에서 한 일, 결과, 메모를 적으세요.";
    $("post-btn").textContent = q ? "질문 남기기" : "글 남기기";
  }

  function selectStage(id, scroll) {
    if (id !== state.selected) statusMsg("");
    state.selected = id; state.scope = "stage"; state.kind = "all";
    renderAll();
    const dialog = $("stage-dialog");
    if (!dialog.open) {
      dialog.showModal();
      document.body.classList.add("dialog-open");
      dialog.scrollTop = 0;
    }
  }

  /* ---------- 글 목록 ---------- */
  const postEls = new Map();
  function visiblePosts() {
    return state.posts
      .filter(p => state.scope === "all" || p.stage === state.selected)
      .filter(p => state.kind === "all" || p.kind === state.kind)
      .sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  }

  // 삭제는 두 번 눌러야 실행된다(실수 방지).
  function armDelete(btn, run) {
    let armed = false, timer = null;
    btn.addEventListener("click", () => {
      if (!armed) {
        armed = true; btn.textContent = "정말 삭제"; btn.classList.add("arm");
        timer = setTimeout(() => { armed = false; btn.textContent = "삭제"; btn.classList.remove("arm"); }, 4000);
        return;
      }
      clearTimeout(timer); btn.disabled = true; run();
    });
  }
  async function remove(path) {
    try { await api("DELETE", path); } catch (e) { showMsg(e.message); }
    load();
  }

  function fillPost(rec, p) {
    const main = rec.main; main.textContent = "";
    const rs = repliesOf(p.id);
    const isQ = p.kind === "question";
    const meta = h("div", "meta");
    meta.append(h("span", "chip" + (isQ ? " q" : ""), isQ ? "질문" : "글"));
    if (isQ) meta.append(rs.length ? h("span", "chip ok", "답변 " + rs.length) : h("span", "chip wait", "답변 대기"));
    if (state.scope === "all") {
      const s = STAGE[p.stage];
      const tag = h("button", "stage-tag", s.group.label + " · " + s.title); tag.type = "button";
      tag.addEventListener("click", () => selectStage(p.stage, false));
      meta.append(tag);
    }
    meta.append(h("span", "who", nameOf(p)), h("time", null, fmt(p.createdAt)));
    const del = h("button", "link-btn", "삭제"); del.type = "button";
    armDelete(del, () => remove("/api/posts/" + encodeURIComponent(p.id)));
    meta.append(del);
    main.append(meta, h("p", "text", p.body));
    if (rs.length) {
      const ul = h("ul", "replies");
      for (const r of rs) {
        const li = h("li"), m = h("div", "meta");
        m.append(h("span", "who", nameOf(r)), h("time", null, fmt(r.createdAt)));
        const rd = h("button", "link-btn", "삭제"); rd.type = "button";
        armDelete(rd, () => remove("/api/replies/" + encodeURIComponent(r.id)));
        m.append(rd);
        li.append(m, h("p", "text", r.body)); ul.append(li);
      }
      main.append(ul);
    }
    rec.ta.placeholder = isQ ? "답변 쓰기" : "댓글 쓰기";
    rec.btn.textContent = isQ ? "답변 등록" : "댓글 등록";
  }

  function makePost(p) {
    const root = h("article", "post"), main = h("div", "post-main");
    const form = h("form", "reply-form"), ta = h("textarea"), btn = h("button", "btn");
    ta.id = "reply-" + p.id; ta.rows = 1; ta.maxLength = 3000; ta.setAttribute("aria-label", "답변 또는 댓글");
    btn.type = "submit";
    form.append(ta, btn);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      const nick = requireNick("답변을 남기려면 먼저 이름을 적어 주세요.");
      if (!nick) return;
      btn.disabled = true;
      try { await api("POST", "/api/replies", { post: p.id, body, nick }); ta.value = ""; showMsg(""); }
      catch (err) { showMsg(err.message); }
      btn.disabled = false;
      load();
    });
    root.id = "post-" + p.id; root.append(main, form);
    return { root, main, form, ta, btn, sig: "" };
  }

  function renderThread() {
    const list = state.loaded ? visiblePosts() : [];
    const box = $("posts"), keep = new Set();
    list.forEach((p, i) => {
      keep.add(p.id);
      let rec = postEls.get(p.id);
      if (!rec) { rec = makePost(p); postEls.set(p.id, rec); }
      const sig = JSON.stringify([p, repliesOf(p.id), state.scope]);
      if (rec.sig !== sig) { fillPost(rec, p); rec.sig = sig; }
      if (box.children[i] !== rec.root) box.insertBefore(rec.root, box.children[i] || null);
    });
    for (const [id, rec] of postEls) if (!keep.has(id)) { rec.root.remove(); postEls.delete(id); }

    const notice = $("notice"), empty = $("empty");
    let note = "";
    if (state.offline) note = state.loaded ? "서버에 연결하지 못해 최신 기록이 아닐 수 있습니다. 연결되면 자동으로 갱신됩니다." : "기록을 불러오지 못했습니다. 연결되면 자동으로 표시됩니다.";
    else if (!state.loaded) note = "기록을 불러오는 중입니다.";
    notice.hidden = !note; notice.textContent = note;

    const showEmpty = state.loaded && !list.length;
    empty.hidden = !showEmpty;
    if (showEmpty) {
      const what = state.kind === "question" ? "질문" : state.kind === "note" ? "글" : "기록";
      empty.textContent = state.scope === "all"
        ? "아직 남긴 " + what + "이 없습니다. 단계를 고르고 첫 글이나 질문을 남겨 보세요."
        : "‘" + STAGE[state.selected].title + "’ 단계에 아직 남긴 " + what + "이 없습니다. 글쓰기 칸에서 첫 글이나 질문을 남겨 보세요.";
    }
  }

  function renderWaiting() {
    const list = waitingQuestions(), ul = $("wait-list");
    $("wait-empty").hidden = list.length > 0;
    ul.textContent = "";
    for (const p of list) {
      const s = STAGE[p.stage], li = h("li"), b = h("button", "wait-item"); b.type = "button";
      b.append(h("span", "w-stage", s.group.label + " · " + s.title), h("span", "w-text", p.body), h("span", "w-date", nameOf(p) + " · " + fmt(p.createdAt)));
      b.addEventListener("click", () => jumpTo(p));
      li.append(b); ul.append(li);
    }
  }

  function jumpTo(p) {
    state.kind = "all"; selectStage(p.stage, false);
    const rec = postEls.get(p.id); if (!rec) return;
    rec.root.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
    rec.root.classList.add("flash");
    setTimeout(() => rec.root.classList.remove("flash"), 1600);
    rec.ta.focus({ preventScroll: true });
  }

  function renderAll() { updateBoard(); updatePanelHead(); updateComposer(); renderThread(); renderWaiting(); }

  /* ---------- 쓰기 ---------- */
  const showMsg = text => { $("form-msg").textContent = text; };
  function requireNick(message) {
    const nick = $("nick").value.trim().slice(0, 30);
    if (nick) { try { localStorage.setItem("board.nick", nick); } catch (e) {} return nick; }
    showMsg(message);
    $("composer").hidden = false;
    $("compose-toggle").setAttribute("aria-expanded", "true");
    $("compose-toggle").textContent = "입력창 접기";
    $("nick").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
    $("nick").focus({ preventScroll: true });
    return "";
  }

  const statusMsg = text => { $("status-msg").textContent = text; };
  const nextStageOf = id => { const list = STAGE[id].group.stages; return list[list.findIndex(s => s.id === id) + 1] || null; };

  async function saveStatus(payload, doneText) {
    state.busyStatus = true; updatePanelHead();
    try { await api("PUT", "/api/status", payload); statusMsg(doneText); }
    catch (e) { statusMsg(e.message); }
    state.busyStatus = false;
    await load();
  }

  function setStatus(id, status) {
    if (state.busyStatus || statusOf(id) === status) return;
    saveStatus({ stage: id, status }, "");
  }

  // 지금 단계를 완료로 바꾸고, 같은 그룹의 다음 단계를 현재로 바꾼다. 두 변경은 서버에서 한 번에 처리된다.
  function advanceStage() {
    const s = STAGE[state.selected];
    if (state.busyStatus || statusOf(s.id) !== "current") return;
    const next = nextStageOf(s.id);
    const changes = [{ stage: s.id, status: "done" }];
    if (next) changes.push({ stage: next.id, status: "current" });
    saveStatus({ changes }, next
      ? "‘" + s.title + "’ 단계를 완료 처리했습니다. 이제 현재 단계는 ‘" + next.title + "’입니다."
      : "‘" + s.title + "’ 단계를 완료 처리했습니다. " + s.group.label + "의 마지막 단계입니다.");
  }

  function bindControls() {
    const dialog = $("stage-dialog");
    $("dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      document.body.classList.remove("dialog-open");
      refs[state.selected].b.focus({ preventScroll: true });
    });
    $("compose-toggle").addEventListener("click", () => {
      const form = $("composer");
      form.hidden = !form.hidden;
      $("compose-toggle").setAttribute("aria-expanded", String(!form.hidden));
      $("compose-toggle").textContent = form.hidden ? "글·질문 남기기" : "입력창 접기";
      if (!form.hidden) { form.scrollIntoView({ block: "center" }); $("post-body").focus({ preventScroll: true }); }
    });
    $("scope-seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { state.scope = b.dataset.scope; renderAll(); } });
    $("kind-seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { state.kind = b.dataset.kind; renderAll(); } });
    $("new-kind").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { state.newKind = b.dataset.newkind; updateComposer(); } });
    $("status-edit").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setStatus(state.selected, b.dataset.status); });
    $("advance-btn").addEventListener("click", advanceStage);
    $("wait-btn").addEventListener("click", () => {
      const first = waitingQuestions()[0];
      if (first) jumpTo(first); else selectStage(state.selected, true);
    });
    try { $("nick").value = localStorage.getItem("board.nick") || ""; } catch (e) {}
    $("composer").addEventListener("submit", async e => {
      e.preventDefault();
      const ta = $("post-body"), body = ta.value.trim(), btn = $("post-btn");
      if (!body) { showMsg("내용을 입력하세요."); ta.focus(); return; }
      const nick = requireNick("이름을 적어 주세요.");
      if (!nick) return;
      showMsg(""); btn.disabled = true;
      try { await api("POST", "/api/posts", { stage: state.selected, kind: state.newKind, body, nick }); ta.value = ""; }
      catch (err) { showMsg(err.message); }
      btn.disabled = false;
      load();
    });
  }

  buildBoard(); bindControls(); renderAll(); load();
  loadAnalysis();
  setInterval(() => { if (!document.hidden) loadAnalysis(); }, 30000);
  // 다른 사람이 남긴 글이 보이도록, 화면을 보고 있는 동안 주기적으로 새로 읽는다.
  setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
})();
