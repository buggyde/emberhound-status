/* =========================================================================
   EmberHound Status — data binding
   Pulls the Upptime summary (committed to master, served CORS-enabled from
   raw.githubusercontent.com) and renders the console. No dependencies.
   ========================================================================= */

"use strict";

const SUMMARY_URL =
  "https://raw.githubusercontent.com/buggyde/emberhound-status/master/history/summary.json";

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

/* Build the trailing-N-days history model from the dailyMinutesDown map. */
function buildHistory(dailyMinutesDown) {
  const map = dailyMinutesDown || {};
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = isoDay(d);
    const down = Object.prototype.hasOwnProperty.call(map, key) ? Number(map[key]) : null;
    const cls = dayClass(down);
    const upPct = down == null ? 100 : Math.max(0, (1440 - down) / 1440 * 100);
    days.push({ date: d, cls, down, upPct });
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
  const bar = el("div", "history__bar", { role: "img",
    "aria-label": `Daily uptime for the last ${HISTORY_DAYS} days` });
  const days = buildHistory(service.dailyMinutesDown);
  for (const day of days) {
    const tick = el("span", `tick tick--${day.cls}`);
    const label = day.down == null
      ? `${fmtDate(day.date)} · 100% uptime`
      : `${fmtDate(day.date)} · ${day.upPct.toFixed(2)}% · ${day.down}m down`;
    tick.dataset.tip = label;
    bar.appendChild(tick);
  }
  hist.appendChild(bar);
  const foot = el("div", "history__foot");
  foot.appendChild(el("span", null, { text: `${HISTORY_DAYS} days ago` }));
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
  $("#verdict-sub").innerHTML = "Couldn’t reach the monitoring feed. Retrying automatically.";
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

/* ----------------------------------------------------------------- load */
async function load() {
  try {
    const res = await fetch(`${SUMMARY_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("empty feed");
    renderVerdict(data);
    renderServices(data);
    markSynced("Upptime");
  } catch (err) {
    renderError(err.message || String(err));
  }
}

load();
setInterval(load, REFRESH_MS);
