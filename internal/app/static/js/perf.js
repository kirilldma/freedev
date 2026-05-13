export function weakDevice() {
	return (
		(navigator.hardwareConcurrency || 8) <= 4 ||
		(navigator.deviceMemory != null && navigator.deviceMemory <= 4)
	);
}

export function saveDataConn() {
	try {
		const c = navigator.connection;
		return !!(c && (c.saveData || /^(slow-2g|2g)$/i.test(String(c.effectiveType || ""))));
	} catch {
		return false;
	}
}

export function prefersReducedMotion() {
	try {
		return matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

export function prefersReducedData() {
	try {
		return matchMedia("(prefers-reduced-data: reduce)").matches;
	} catch {
		return false;
	}
}

export function coarsePointer() {
	try {
		return matchMedia("(pointer: coarse)").matches;
	} catch {
		return false;
	}
}

export function hoverFine() {
	try {
		return matchMedia("(hover: hover)").matches;
	} catch {
		return true;
	}
}

export function atomLike() {
	try {
		if (localStorage.getItem("freedev-lite") === "1") return true;
	} catch {}
	const cores = navigator.hardwareConcurrency || 8;
	const mem = navigator.deviceMemory;
	const sw = Math.min(
		screen.width || 4096,
		screen.height || 4096,
		typeof innerWidth === "number" ? innerWidth : 4096,
		typeof innerHeight === "number" ? innerHeight : 4096,
	);
	const smax = Math.max(screen.width || 0, screen.height || 0, innerWidth || 0, innerHeight || 0);
	const netbookScreen = smax > 0 && smax <= 1100 && sw <= 680;
	const twinCore = cores <= 2;
	const ram2 = mem != null && mem <= 2;
	if (twinCore && (netbookScreen || ram2)) return true;
	if (ram2 && cores <= 4) return true;
	return false;
}

export function perfTier() {
	if (atomLike()) return "atom";
	if (weakDevice() || saveDataConn() || prefersReducedData()) return "weak";
	return "fine";
}

export function lims() {
	if (atomLike())
		return { feed: 10, issues: 20, search: 10, builds: 16, projQ: 280 };
	const w = weakDevice() || saveDataConn() || prefersReducedData();
	if (w) return { feed: 22, issues: 48, search: 22, builds: 36, projQ: 140 };
	return { feed: 48, issues: 140, search: 48, builds: 96, projQ: 420 };
}

export function pulseKit() {
	if (atomLike())
		return "rounded-lg bg-neutral-200 dark:bg-neutral-800";
	return prefersReducedMotion()
		? "rounded-lg bg-neutral-200 dark:bg-neutral-800"
		: "animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800";
}

export function idleRun(fn, timeout = 1600) {
	const ric = window.requestIdleCallback;
	if (typeof ric === "function") ric(() => fn(), { timeout });
	else setTimeout(fn, 1);
}

export function microtick(fn) {
	queueMicrotask(fn);
}

export function debounce(fn, ms) {
	let t = null;
	const out = (...args) => {
		clearTimeout(t);
		t = setTimeout(() => {
			t = null;
			fn(...args);
		}, ms);
	};
	out.flush = () => {
		clearTimeout(t);
		t = null;
	};
	out.cancel = () => clearTimeout(t);
	return out;
}

export function throttle(fn, ms) {
	let last = 0;
	let to = null;
	return (...args) => {
		const now = Date.now();
		const left = ms - (now - last);
		if (left <= 0) {
			last = now;
			fn(...args);
			return;
		}
		clearTimeout(to);
		to = setTimeout(() => {
			last = Date.now();
			fn(...args);
		}, left);
	};
}

export function rafThrottle(fn) {
	let id = null;
	let lastArgs = null;
	return (...args) => {
		lastArgs = args;
		if (id != null) return;
		id = requestAnimationFrame(() => {
			id = null;
			fn(...lastArgs);
		});
	};
}

export function clamp(n, lo, hi) {
	return Math.min(hi, Math.max(lo, n));
}

export function capNum(n, max) {
	const x = Number(n);
	if (!Number.isFinite(x)) return 0;
	return Math.min(max, Math.max(0, x));
}

export function takeN(arrLike, n) {
	const a = Array.isArray(arrLike) ? arrLike : [];
	const k = capNum(n, 1e9);
	return k >= a.length ? a.slice() : a.slice(0, k);
}

export function chunkArray(a, size) {
	const out = [];
	const s = Math.max(1, capNum(size, 1e9));
	for (let i = 0; i < a.length; i += s) out.push(a.slice(i, i + s));
	return out;
}

export function flattenOne(level, arrays) {
	const out = [];
	for (const x of arrays) {
		if (level && Array.isArray(x)) out.push(...x);
		else out.push(x);
	}
	return out;
}

export function scheduleChunks(items, chunkSize, perFrame, onChunk, done) {
	const chunks = chunkArray(items, chunkSize);
	let i = 0;
	function tick() {
		const end = Math.min(chunks.length, i + Math.max(1, perFrame));
		for (; i < end; i++) onChunk(chunks[i], i);
		if (i >= chunks.length) {
			done?.();
			return;
		}
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
}

export function domClear(el) {
	while (el?.firstChild) el.removeChild(el.firstChild);
}

export function domReplace(el, html) {
	if (!el) return;
	el.innerHTML = html;
}

export function once(fn) {
	let ran = false;
	return (...a) => {
		if (ran) return;
		ran = true;
		return fn(...a);
	};
}

export function passiveOpt(passive = true) {
	return { passive };
}

export function noop() {}

export function identity(x) {
	return x;
}

export function runIf(cond, fn) {
	if (cond) fn();
}

export function memoLast(fn, keyFn = identity) {
	let pk;
	let pv;
	return (...args) => {
		const k = keyFn(...args);
		if (k === pk) return pv;
		pk = k;
		pv = fn(...args);
		return pv;
	};
}

export async function measureMs(fn) {
	const t0 = performance.now();
	await fn();
	return Math.round(performance.now() - t0);
}

export function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

export async function raceTimeout(p, ms, fallback = null) {
	let to;
	try {
		return await Promise.race([
			p,
			new Promise((_, rej) => {
				to = setTimeout(() => rej(new Error("timeout")), ms);
			}),
		]);
	} catch {
		return fallback;
	} finally {
		clearTimeout(to);
	}
}

export function safeJsonParse(s, fb = null) {
	try {
		return JSON.parse(s);
	} catch {
		return fb;
	}
}

export function shallowAssign(a, b) {
	return Object.assign({}, a, b);
}

export function keysSorted(o) {
	return Object.keys(o || {}).sort();
}

export function capStr(s, max) {
	const t = String(s || "");
	return t.length <= max ? t : t.slice(0, max);
}

export function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

export function bitFlags(mask, bits) {
	return (mask & bits) === bits;
}

export function isLikelyMobile() {
	return coarsePointer() || /Mobi|Android/i.test(navigator.userAgent || "");
}
