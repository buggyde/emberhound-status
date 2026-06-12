/* =========================================================================
   EmberHound Status — data binding
   Pulls the Upptime summary (committed to master, served CORS-enabled from
   raw.githubusercontent.com) and renders the console. No dependencies.
   ========================================================================= */

"use strict";

const HISTORY_BASE =
  "https://raw.githubusercontent.com/buggyde/emberhound-status/master/history/";
const SUMMARY_URL = HISTORY_BASE + "summary.json";

const HISTORY_DAYS = 90;
const REFRESH_MS = 60_000;
// Minutes-down thresholds for a single day's tick colour.
const DEGRADED_MIN = 1;   // any recorded downtime -> at least degraded
const DOWN_MIN = 120;     // >= 2h down in a day -> red

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ----------------------------------------------------------------- helpers */
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, attrs) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (attrs) for (const k in attrs) {
    if (k === "text") node.textContent = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  return node;
}

function fmtDate(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* Classify one day from its recorded minutes of downtime. */
function dayClass(minutesDown) {
  if (minutesDown == null) return "up";
  if (minutesDown >= DOWN_MIN) return "down";
  if (minutesDown >= DEGRADED_MIN) return "degraded";
  return "up";
}

/* Latency colour band (ms). Status pages live and die on responsiveness. */
function latencyBand(ms) {
  if (ms <= 250) return "metric__value--good";
  if (ms <= 800) return "metric__value--warn";
  return "metric__value--bad";
}

/* When each service began being monitored, by slug. Fetched once from
   history/<slug>.yml (which carries a startTime) and cached — it never
   changes, so we don't re-pull it on the 60s refresh. A null entry means
   "we tried and couldn't determine it" (falls back to assuming up). */
const startTimes = {};

function midnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function ensureStartTimes(services) {
  const missing = services.filter((s) => s.slug && !(s.slug in startTimes));
  await Promise.allSettled(missing.map(async (s) => {
    startTimes[s.slug] = null; // mark attempted so we don't refetch on failure
    try {
      const r = await fetch(`${HISTORY_BASE}${s.slug}.yml?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const text = await r.text();
      const m = text.match(/startTime:\s*['"]?([0-9T:.+\-Z]+)/i);
      if (m) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) startTimes[s.slug] = d;
      }
    } catch (_) { /* leave null -> day-classifier assumes up, prior behaviour */ }
  }));
}

/* Build the trailing-N-days history model from the dailyMinutesDown map.
   Days before the service's startTime are "no data" rather than implying
   uptime that was never actually measured. */
function buildHistory(dailyMinutesDown, startTime) {
  const map = dailyMinutesDown || {};
  const days = [];
  const today = midnight(new Date());
  const startDay = startTime instanceof Date && !isNaN(startTime.getTime())
    ? midnight(startTime) : null;
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (startDay && d < startDay) {
      days.push({ date: d, cls: "none", down: null, upPct: null, noData: true });
      continue;
    }
    const key = isoDay(d);
    const down = Object.prototype.hasOwnProperty.call(map, key) ? Number(map[key]) : null;
    const cls = dayClass(down);
    const upPct = down == null ? 100 : Math.max(0, (1440 - down) / 1440 * 100);
    days.push({ date: d, cls, down, upPct, noData: false });
  }
  return days;
}

/* Overall verdict from the live per-service status field. Returns structured
   data only — the DOM is assembled in renderVerdict so no service-supplied
   string is ever passed through innerHTML. */
function deriveVerdict(services) {
  const total = services.length;
  const downNames = services.filter((s) => s.status === "down").map((s) => s.name);
  const downCount = downNames.length;
  if (downCount === 0) {
    return { tone: "up", state: "up", headline: "All Systems Operational",
      downNames, downCount, total };
  }
  const tone = downCount >= total ? "down" : "degraded";
  return {
    tone, state: "down",
    headline: downCount >= total ? "Major Outage" : "Partial Outage",
    downNames, downCount, total,
  };
}

/* Build the verdict sub-line as DOM nodes (bold service names are real
   <b> elements, never interpolated markup). */
function buildVerdictSub(v) {
  const frag = document.createDocumentFragment();
  if (v.downCount === 0) {
    frag.append("Every monitored EmberHound service is responding normally.");
    return frag;
  }
  v.downNames.forEach((name, i) => {
    if (i > 0) frag.append(i === v.downNames.length - 1 ? " and " : ", ");
    frag.appendChild(el("b", null, { text: name }));
  });
  frag.append(v.downCount === 1 ? " is not responding. " : " are not responding. ");
  frag.append(`${v.total - v.downCount} of ${v.total} services remain operational.`);
  return frag;
}

/* ----------------------------------------------------------------- render */
function renderVerdict(services) {
  const v = deriveVerdict(services);
  const root = $("#verdict");
  root.setAttribute("data-tone", v.tone);
  root.setAttribute("aria-busy", "false");
  $("#verdict-dot").setAttribute("data-state", v.tone === "degraded" ? "degraded" : v.state);
  $("#verdict-headline").textContent = v.headline;
  const sub = $("#verdict-sub");
  sub.textContent = "";
  sub.appendChild(buildVerdictSub(v));
  document.title = (v.tone === "up" ? "● " : "▲ ") + "EmberHound — " + v.headline;
}

function card(service, index) {
  const c = el("div", "card card--live", { role: "listitem" });
  c.style.setProperty("--i", index);
  c.setAttribute("data-status", service.status);

  /* top: identity + live pill */
  const top = el("div", "card__top");
  const id = el("div", "card__id");
  if (service.icon) {
    const img = el("img", "card__icon", { src: service.icon, alt: "", loading: "lazy", "aria-hidden": "true" });
    img.addEventListener("error", () => img.remove());
    id.appendChild(img);
  }
  id.appendChild(el("h3", "card__name", { text: service.name, title: service.name }));
  top.appendChild(id);

  const up = service.status === "up";
  const pill = el("span", `pill ${up ? "pill--up" : "pill--down"}`);
  pill.appendChild(el("span", "pill__dot"));
  pill.appendChild(el("span", null, { text: up ? "Operational" : "Down" }));
  top.appendChild(pill);
  c.appendChild(top);

  /* metrics */
  const metrics = el("div", "card__metrics");
  const lat = el("div", "metric metric--latency");
  lat.appendChild(el("span", "metric__label", { text: "Latency" }));
  const latVal = el("span", `metric__value ${latencyBand(service.time)}`,
    { text: String(service.time) });
  latVal.appendChild(el("span", null, { text: "ms" }));
  lat.appendChild(latVal);
  metrics.appendChild(lat);

  const windows = [
    ["24h", service.uptimeDay],
    ["7d",  service.uptimeWeek],
    ["30d", service.uptimeMonth],
    ["1y",  service.uptimeYear],
  ];
  for (const [label, val] of windows) {
    const m = el("div", "metric");
    m.appendChild(el("span", "metric__label", { text: label }));
    m.appendChild(el("span", "metric__value", { text: val ?? "—" }));
    metrics.appendChild(m);
  }
  c.appendChild(metrics);

  /* history strip */
  const hist = el("div", "history");
  const startTime = startTimes[service.slug];
  const days = buildHistory(service.dailyMinutesDown, startTime);
  const monitored = days.filter((d) => !d.noData).length;
  const bar = el("div", "history__bar", { role: "img",
    "aria-label": `Daily uptime over the last ${monitored} monitored day${monitored === 1 ? "" : "s"}` });
  for (const day of days) {
    const tick = el("span", `tick tick--${day.cls}`);
    const label = day.noData
      ? `${fmtDate(day.date)} · no monitoring data`
      : (day.down == null
          ? `${fmtDate(day.date)} · 100% uptime`
          : `${fmtDate(day.date)} · ${day.upPct.toFixed(2)}% · ${day.down}m down`);
    tick.dataset.tip = label;
    bar.appendChild(tick);
  }
  hist.appendChild(bar);

  const foot = el("div", "history__foot");
  let leftLabel = `${HISTORY_DAYS} days ago`;
  const startDay = startTime instanceof Date && !isNaN(startTime.getTime()) ? midnight(startTime) : null;
  if (startDay) {
    const earliest = midnight(new Date());
    earliest.setDate(earliest.getDate() - (HISTORY_DAYS - 1));
    if (startDay > earliest) leftLabel = `monitoring since ${fmtDate(startDay)}`;
  }
  foot.appendChild(el("span", null, { text: leftLabel }));
  foot.appendChild(el("span", null, { text: `${service.uptime} overall` }));
  hist.appendChild(foot);
  c.appendChild(hist);

  return c;
}

function renderServices(services) {
  const list = $("#services");
  list.textContent = "";
  services.forEach((s, i) => list.appendChild(card(s, i)));
}

function renderError(message) {
  $("#verdict").setAttribute("aria-busy", "false");
  $("#verdict-dot").setAttribute("data-state", "down");
  $("#verdict-headline").textContent = "Status Unavailable";
  $("#verdict-sub").textContent = "Couldn’t reach the monitoring feed. Retrying automatically.";
  const list = $("#services");
  list.textContent = "";
  const banner = el("div", "banner");
  banner.appendChild(el("b", null, { text: "feed error" }));
  banner.append(" — " + message);
  list.appendChild(banner);
}

/* ----------------------------------------------------------------- tooltip */
const tip = $("#tip");
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest(".tick");
  if (t && t.dataset.tip) {
    const [head, ...rest] = t.dataset.tip.split(" · ");
    tip.textContent = "";
    tip.appendChild(el("b", null, { text: head }));
    tip.append(" · " + rest.join(" · "));
    tip.style.left = e.clientX + "px";
    tip.style.top = e.clientY + "px";
    tip.dataset.show = "1";
  } else if (tip.dataset.show === "1") {
    tip.dataset.show = "0";
  }
}, { passive: true });

/* ----------------------------------------------------------------- sync */
function markSynced(generator) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  $("#sync-text").textContent = `synced ${hh}:${mm}:${ss}`;
  if (generator) $("#generator").textContent = generator;
}

/* =========================================================================
   Incidents & scheduled maintenance — read from GitHub Issues, matching
   Upptime's conventions:
     • incident   = issue labelled "status"  (+ a label per affected slug),
                    title "<emoji> <Service> is down"; open = ongoing,
                    closed = resolved; updates are comments.
     • maintenance = issue labelled "maintenance" with a body block:
                    <!-- start: <ISO>  end: <ISO>  expectedDown: a, b -->
   GitHub's unauthenticated API allows 60 req/hr per IP, so this polls far
   less often than the 60s status refresh.
   ========================================================================= */
const ISSUES_URL = "https://api.github.com/repos/buggyde/emberhound-status/issues";
const INCIDENTS_REFRESH_MS = 180_000;     // 3 min
const INCIDENT_HISTORY_MAX = 12;

let serviceNames = {};                     // slug -> display name (from summary)

function prettySlug(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
function nameForSlug(slug) {
  return serviceNames[slug] || prettySlug(slug);
}

function relTime(date) {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function fmtDateTime(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* Slugs we know about, pulled from an issue's labels (everything except the
   reserved Upptime labels). */
const RESERVED_LABELS = new Set(["status", "maintenance", "bug", "enhancement",
  "documentation", "duplicate", "good first issue", "help wanted", "invalid",
  "question", "wontfix"]);

function affectedSlugs(labels) {
  return labels.map((l) => l.name).filter((n) => !RESERVED_LABELS.has(n));
}

/* Parse the <!-- start / end / expectedDown --> block from a maintenance body. */
function parseMaintenance(body) {
  const out = { start: null, end: null, expectedDown: [] };
  if (!body) return out;
  const block = body.match(/<!--([\s\S]*?)-->/);
  const src = block ? block[1] : body;
  const s = src.match(/start:\s*([^\s]+)/i);
  const e = src.match(/end:\s*([^\s]+)/i);
  const d = src.match(/expectedDown:\s*([^\n\r]+)/i);
  if (s) { const dt = new Date(s[1]); if (!isNaN(dt.getTime())) out.start = dt; }
  if (e) { const dt = new Date(e[1]); if (!isNaN(dt.getTime())) out.end = dt; }
  if (d) out.expectedDown = d[1].split(",").map((x) => x.trim()).filter(Boolean);
  return out;
}

function serviceChips(slugs) {
  const wrap = el("span", "chips");
  slugs.forEach((slug) => wrap.appendChild(el("span", "chip", { text: nameForSlug(slug) })));
  return wrap;
}

/* A prominent banner for something happening now (open incident or
   in-window maintenance). */
function activeCard(kind, issue, extra) {
  const card = el("article", `incident-banner incident-banner--${kind}`);
  const head = el("div", "incident-banner__head");
  head.appendChild(el("span", "incident-banner__tag",
    { text: kind === "maintenance" ? "Maintenance" : "Active incident" }));
  head.appendChild(el("span", "incident-banner__since",
    { text: extra.sinceLabel }));
  card.appendChild(head);

  const a = el("a", "incident-banner__title",
    { href: issue.html_url, target: "_blank", rel: "noopener", text: issue.title });
  card.appendChild(a);

  if (extra.slugs && extra.slugs.length) card.appendChild(serviceChips(extra.slugs));
  if (extra.note) card.appendChild(el("p", "incident-banner__note", { text: extra.note }));
  return card;
}

function renderActive(incidents, maintenance) {
  const root = $("#active");
  root.textContent = "";
  const now = Date.now();
  const items = [];

  incidents.filter((i) => i.state === "open").forEach((i) => {
    items.push(activeCard("incident", i, {
      slugs: affectedSlugs(i.labels),
      sinceLabel: `down since ${fmtDateTime(new Date(i.created_at))} · ${relTime(new Date(i.created_at))}`,
    }));
  });

  maintenance.forEach((m) => {
    const info = parseMaintenance(m.body);
    const inWindow = info.start && info.end && now >= info.start.getTime() && now <= info.end.getTime();
    const upcoming = info.start && now < info.start.getTime();
    if (m.state === "open" && (inWindow || upcoming)) {
      const when = info.start && info.end
        ? `${fmtDateTime(info.start)} → ${fmtDateTime(info.end)}`
        : "window not specified";
      items.push(activeCard("maintenance", m, {
        slugs: info.expectedDown,
        sinceLabel: (inWindow ? "in progress · " : "scheduled · ") + when,
      }));
    }
  });

  if (!items.length) { root.hidden = true; return; }
  root.hidden = false;
  items.forEach((n) => root.appendChild(n));
}

function incidentRow(issue) {
  const li = el("li", "inc");
  const open = issue.state === "open";
  li.classList.add(open ? "inc--open" : "inc--resolved");

  const dot = el("span", "inc__dot");
  li.appendChild(dot);

  const main = el("div", "inc__main");
  const a = el("a", "inc__title",
    { href: issue.html_url, target: "_blank", rel: "noopener", text: issue.title });
  main.appendChild(a);

  const meta = el("div", "inc__meta");
  const created = new Date(issue.created_at);
  meta.appendChild(el("span", null, { text: fmtDateTime(created) }));
  const slugs = affectedSlugs(issue.labels);
  if (slugs.length) {
    meta.appendChild(el("span", "inc__sep", { text: "·" }));
    meta.appendChild(el("span", null, { text: slugs.map(nameForSlug).join(", ") }));
  }
  if (!open && issue.closed_at) {
    meta.appendChild(el("span", "inc__sep", { text: "·" }));
    meta.appendChild(el("span", null,
      { text: `resolved in ${fmtDuration(new Date(issue.closed_at) - created)}` }));
  }
  main.appendChild(meta);
  li.appendChild(main);

  li.appendChild(el("span", `inc__state inc__state--${open ? "open" : "resolved"}`,
    { text: open ? "Ongoing" : "Resolved" }));
  return li;
}

function renderIncidentHistory(incidents) {
  const list = $("#incidents-list");
  list.textContent = "";
  if (!incidents.length) {
    const li = el("li", "incidents__empty");
    li.appendChild(el("span", "incidents__empty-dot"));
    li.append("No incidents reported. All clear.");
    list.appendChild(li);
    return;
  }
  incidents
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, INCIDENT_HISTORY_MAX)
    .forEach((i) => list.appendChild(incidentRow(i)));
}

async function loadIssues() {
  try {
    const res = await fetch(
      `${ISSUES_URL}?state=all&per_page=50&sort=updated&direction=desc`,
      { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()).filter((i) => !i.pull_request);
    const has = (i, name) => i.labels.some((l) => l.name === name);
    const incidents = all.filter((i) => has(i, "status"));
    const maintenance = all.filter((i) => has(i, "maintenance"));
    renderActive(incidents, maintenance);
    renderIncidentHistory(incidents);
  } catch (err) {
    // Non-fatal: leave the status page fully functional if the issues API
    // is rate-limited or unreachable.
    const list = $("#incidents-list");
    if (list && list.querySelector(".incidents__loading")) {
      list.textContent = "";
      const li = el("li", "incidents__empty");
      li.append("Incident history is temporarily unavailable.");
      list.appendChild(li);
    }
  }
}

/* ----------------------------------------------------------------- load */
async function load() {
  try {
    const res = await fetch(`${SUMMARY_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("empty feed");
    serviceNames = Object.fromEntries(data.map((s) => [s.slug, s.name]));
    await ensureStartTimes(data);
    renderVerdict(data);
    renderServices(data);
    markSynced("Upptime");
  } catch (err) {
    renderError(err.message || String(err));
  }
}

/* First status load populates serviceNames, then incidents load with names
   ready. Both then poll on independent intervals (incidents far less often
   because of GitHub's API rate limits). */
load().then(loadIssues);
setInterval(load, REFRESH_MS);
setInterval(loadIssues, INCIDENTS_REFRESH_MS);
