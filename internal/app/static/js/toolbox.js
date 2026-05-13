export function esc(s) {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function fmt(ms) {
	try {
		return new Date(ms).toLocaleString();
	} catch {
		return String(ms);
	}
}

export function fmtIso(ms) {
	try {
		return new Date(ms).toISOString();
	} catch {
		return "";
	}
}

export function fmtRelative(ms) {
	const d = Number(ms);
	if (!Number.isFinite(d)) return "";
	const sec = Math.round((Date.now() - d) / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.round(min / 60);
	if (hr < 48) return `${hr}h`;
	return `${Math.round(hr / 24)}d`;
}

export function slugify(x) {
	return String(x || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

export function truncate(str, n) {
	const s = String(str ?? "");
	return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

export function clamp(n, lo, hi) {
	return Math.min(hi, Math.max(lo, n));
}

export function noop() {}

export function identity(x) {
	return x;
}

export function isBlank(x) {
	return String(x ?? "").trim() === "";
}

export function notBlank(x) {
	return !isBlank(x);
}

export function parseInt10(x, def = 0) {
	const n = parseInt(String(x), 10);
	return Number.isFinite(n) ? n : def;
}

export function bool01(x) {
	return x ? 1 : 0;
}

export function coalesce(...xs) {
	for (const x of xs) if (x != null && x !== "") return x;
	return "";
}

export function pick(o, keys) {
	const out = {};
	for (const k of keys) if (k in o) out[k] = o[k];
	return out;
}

export function omit(o, keys) {
	const sk = new Set(keys);
	const out = {};
	for (const [k, v] of Object.entries(o || {}))
		if (!sk.has(k)) out[k] = v;
	return out;
}

export function shallowEq(a, b) {
	const ka = Object.keys(a || {});
	const kb = Object.keys(b || {});
	if (ka.length !== kb.length) return false;
	for (const k of ka) if (a[k] !== b[k]) return false;
	return true;
}

export function dedupe(xs) {
	return [...new Set(xs)];
}

export function groupBy(xs, keyFn) {
	const m = new Map();
	for (const x of xs || []) {
		const k = keyFn(x);
		if (!m.has(k)) m.set(k, []);
		m.get(k).push(x);
	}
	return m;
}

export function partition(xs, pred) {
	const t = [],
		f = [];
	for (const x of xs || []) (pred(x) ? t : f).push(x);
	return [t, f];
}

export function take(xs, n) {
	return (xs || []).slice(0, n);
}

export function drop(xs, n) {
	return (xs || []).slice(n);
}

export function sortBy(xs, fn) {
	return [...(xs || [])].sort((a, b) => String(fn(a)).localeCompare(String(fn(b))));
}

export function reverse(xs) {
	return [...(xs || [])].reverse();
}

export function flatten1(xs) {
	return (xs || []).flat();
}

export function compact(xs) {
	return (xs || []).filter(Boolean);
}

export function uniq(xs) {
	return [...new Set(xs || [])];
}

export function randHex(n) {
	let s = "";
	for (let i = 0; i < n; i++)
		s += Math.floor(Math.random() * 16).toString(16);
	return s;
}

export function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

export function tap(x, fn) {
	fn(x);
	return x;
}

export function pipe(x, ...fns) {
	let v = x;
	for (const f of fns) v = f(v);
	return v;
}

export function qs(sel, root = document) {
	return root.querySelector(sel);
}

export function qsa(sel, root = document) {
	return [...root.querySelectorAll(sel)];
}

export function escapeRegExp(s) {
	return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ciIncludes(hay, needle) {
	return String(hay || "")
		.toLowerCase()
		.includes(String(needle || "").toLowerCase());
}

export function lines(s) {
	return String(s || "").split(/\r?\n/);
}

export function unlines(xs) {
	return (xs || []).join("\n");
}

export function padLeft(s, len, ch = " ") {
	let x = String(s);
	while (x.length < len) x = ch + x;
	return x;
}

export function capitalize(s) {
	const x = String(s || "");
	return x ? x[0].toUpperCase() + x.slice(1) : "";
}

export function lower(s) {
	return String(s ?? "").toLowerCase();
}

export function upper(s) {
	return String(s ?? "").toUpperCase();
}

export function stripTags(html) {
	return String(html || "").replace(/<[^>]*>/g, "");
}

export function safeJsonParse(txt, fallback = null) {
	try {
		return JSON.parse(txt);
	} catch {
		return fallback;
	}
}

export function apiUrl(path) {
	return "/api" + (path.startsWith("/") ? path : "/" + path);
}

export function downloadHref(url, name) {
	const a = document.createElement("a");
	a.href = url;
	a.download = name || "";
	a.rel = "noopener";
	a.click();
}

export function toggleDarkClass(el, on) {
	el.classList.toggle("dark", !!on);
}

export function cn(...parts) {
	return compact(parts.flat()).join(" ");
}

export function issueBadgeCls(status) {
	const b = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ";
	const s = lower(status);
	if (s === "closed" || s.includes("close"))
		return b + "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200";
	if (s === "open") return b + "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
	return b + "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100";
}
