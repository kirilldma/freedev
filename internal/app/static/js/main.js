import { api, toast, arr, overviewSafe } from "./api.js";
import {
	bi,
	langDropdownMarkup,
	syncLangButtonUI,
	setLang,
	getLang,
	withLangOverlay,
	LANG_LIST,
	flagSrc,
} from "./i18n.js";
import {
	esc,
	fmt,
	truncate,
	parseInt10,
	issueBadgeCls,
	apiUrl,
} from "./toolbox.js";
import { lims, debounce, pulseKit, weakDevice, atomLike } from "./perf.js";

setLang(getLang());

const LIM = lims();
let META = null;
let FD_SESSION = null;
const SITE = {
	product_name: "FreeDev",
	product_tagline: "",
	logo_url: "",
	accent_hex: "#171717",
};

async function fillGitProjectSelect(sel) {
	if (!sel) return;
	try {
		const pl = arr(await api("/projects"));
		for (const p of pl) {
			const o = document.createElement("option");
			o.value = p.id;
			o.textContent = `${p.name} · ${p.slug}`;
			sel.appendChild(o);
		}
	} catch {}
}

function normalizeHex(v) {
	let s = String(v ?? "").trim();
	if (!s) return "";
	if (!s.startsWith("#")) s = "#" + s;
	const hex = s.slice(1).replace(/[^0-9a-fA-F]/g, "");
	if (hex.length === 3) return "#" + hex.split("").map((c) => c + c).join("").toLowerCase();
	if (hex.length >= 6) return "#" + hex.slice(0, 6).toLowerCase();
	return "";
}

function hexForColorInput(v) {
	const n = normalizeHex(v);
	return /^#[0-9a-f]{6}$/.test(n) ? n : "#171717";
}

function accentForeground(hex) {
	const n = normalizeHex(hex);
	const raw = /^#[0-9a-f]{6}$/.test(n) ? n.slice(1) : "171717";
	const r = parseInt(raw.slice(0, 2), 16) / 255;
	const g = parseInt(raw.slice(2, 4), 16) / 255;
	const b = parseInt(raw.slice(4, 6), 16) / 255;
	const lin = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
	const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	return L > 0.52 ? "#171717" : "#fafafa";
}

function wireAccentColorWell(root) {
	const form = root?.querySelector("#adm-settings");
	const hexEl = form?.querySelector('[name="accent_hex"]');
	const well = form?.querySelector("#adm-accent-well");
	if (!hexEl || !well) return;
	well.value = hexForColorInput(hexEl.value);
	well.addEventListener("input", () => {
		hexEl.value = well.value;
	});
	hexEl.addEventListener("change", () => {
		const n = normalizeHex(hexEl.value);
		if (n.length === 7) {
			hexEl.value = n;
			well.value = n;
		}
	});
	hexEl.addEventListener("input", () => {
		const n = normalizeHex(hexEl.value);
		if (/^#[0-9a-f]{6}$/.test(n)) well.value = n;
	});
}

function applyBranding(m) {
	if (!m || typeof m !== "object") return;
	SITE.product_name = String(m.product_name || SITE.product_name);
	SITE.product_tagline = String(m.product_tagline || "");
	SITE.logo_url = String(m.logo_url || "");
	SITE.accent_hex = String(m.accent_hex || SITE.accent_hex);
	document.documentElement.style.setProperty("--fd-accent", SITE.accent_hex);
	document.documentElement.style.setProperty("--fd-accent-fg", accentForeground(SITE.accent_hex));
	document.title = SITE.product_name + " · Console";
}

async function refreshMeta() {
	const res = await fetch("/api/meta", { credentials: "same-origin" });
	META = await res.json();
	applyBranding(META);
	FD_SESSION = META.session || null;
	return META;
}

async function fdLogout() {
	try {
		await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
	} catch {}
	FD_SESSION = null;
	await refreshMeta();
	if (META.auth_required && !META.session) renderLoginGate();
	else route();
}

function renderBootstrapGate() {
	$root.innerHTML = `<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
<form id="fd-boot" class="w-full max-w-md space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
<h1 class="text-lg font-semibold">${esc(bi("Первый администратор", "First administrator"))}</h1>
<p class="text-sm text-neutral-500">${esc(bi("Задай логин и пароль (≥8 символов).", "Pick username and password (≥8 chars)."))}</p>
<label class="block text-xs font-medium text-neutral-600 dark:text-neutral-400">${esc(bi("Логин", "Username"))}<input name="username" required autocomplete="username" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium text-neutral-600 dark:text-neutral-400">${esc(bi("Пароль", "Password"))}<input name="password" type="password" required autocomplete="new-password" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium text-neutral-600 dark:text-neutral-400">${esc(bi("Код bootstrap (если задан FREEDEV_BOOTSTRAP_CODE)", "Bootstrap code (if FREEDEV_BOOTSTRAP_CODE set)"))}<input name="access_code" autocomplete="off" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<button type="submit" class="w-full rounded-md bg-neutral-900 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Создать", "Create"))}</button>
</form></div>`;
	document.getElementById("fd-boot")?.addEventListener("submit", async (ev) => {
		ev.preventDefault();
		const fd = new FormData(ev.target);
		try {
			const res = await fetch("/api/auth/bootstrap", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: String(fd.get("username") || ""),
					password: String(fd.get("password") || ""),
					access_code: String(fd.get("access_code") || ""),
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || res.statusText);
			await refreshMeta();
			toast(bi("Готово", "Done"));
			themeApply();
			route();
		} catch (e) {
			toast(e.message, "bad");
		}
	});
}

function renderLoginGate() {
	const reg = META.registration_open
		? `<details class="rounded-lg border border-neutral-200 dark:border-neutral-800"><summary class="cursor-pointer px-4 py-3 text-sm font-medium">${esc(bi("Регистрация", "Register"))}</summary>
<div class="space-y-3 border-t border-neutral-200 p-4 dark:border-neutral-800">
<form id="fd-reg" class="space-y-3">
<label class="block text-xs font-medium">${esc(bi("Логин", "Username"))}<input name="username" required class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium">${esc(bi("Пароль", "Password"))}<input name="password" type="password" required class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
${META.access_code_required ? `<label class="block text-xs font-medium">${esc(bi("Код доступа", "Access code"))}<input name="access_code" required autocomplete="off" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>` : ""}
<button type="submit" class="w-full rounded-md border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-800">${esc(bi("Зарегистрироваться", "Sign up"))}</button>
</form></div></details>`
		: "";
	$root.innerHTML = `<div class="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
<div class="w-full max-w-md space-y-4">
<form id="fd-login" class="space-y-4 rounded-xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
<h1 class="text-lg font-semibold">${esc(SITE.product_name)}</h1>
<p class="text-sm text-neutral-500">${esc(bi("Вход в консоль", "Console sign-in"))}</p>
<label class="block text-xs font-medium">${esc(bi("Логин", "Username"))}<input name="username" required autocomplete="username" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium">${esc(bi("Пароль", "Password"))}<input name="password" type="password" required autocomplete="current-password" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<button type="submit" class="w-full rounded-md bg-neutral-900 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Войти", "Sign in"))}</button>
</form>
${reg}
</div></div>`;
	document.getElementById("fd-login")?.addEventListener("submit", async (ev) => {
		ev.preventDefault();
		const fd = new FormData(ev.target);
		try {
			const res = await fetch("/api/auth/login", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: String(fd.get("username") || ""),
					password: String(fd.get("password") || ""),
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || res.statusText);
			await refreshMeta();
			toast(bi("Вошли", "Signed in"));
			themeApply();
			route();
		} catch (e) {
			toast(e.message, "bad");
		}
	});
	document.getElementById("fd-reg")?.addEventListener("submit", async (ev) => {
		ev.preventDefault();
		const fd = new FormData(ev.target);
		try {
			const res = await fetch("/api/auth/register", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: String(fd.get("username") || ""),
					password: String(fd.get("password") || ""),
					access_code: String(fd.get("access_code") || ""),
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || res.statusText);
			await refreshMeta();
			toast(bi("Аккаунт создан", "Account created"));
			themeApply();
			route();
		} catch (e) {
			toast(e.message, "bad");
		}
	});
}

async function ensureGate() {
	await refreshMeta();
	if (META.bootstrap_needed) {
		renderBootstrapGate();
		return false;
	}
	if (META.auth_required && !META.session) {
		renderLoginGate();
		return false;
	}
	return true;
}

async function gateBoot() {
	try {
		if (!(await ensureGate())) return;
	} catch (e) {
		$root.innerHTML = `<div class="p-8 text-sm text-red-600">${esc(e.message)}</div>`;
		return;
	}
	themeApply();
	route();
}

if (atomLike()) document.documentElement.classList.add("fd-lite");
const $root = document.getElementById("root");
const DEF_YAML = `jobs:
  build:
    runs-on: freedev
    steps:
      - run: echo "FreeDev pipeline"`;

function themeApply() {
	const t = localStorage.getItem("freedev-theme") || "system";
	const root = document.documentElement;
	root.classList.toggle("dark", false);
	if (t === "dark") root.classList.add("dark");
	else if (t === "light") {
	}
	else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
		root.classList.add("dark");
	}
	const el = document.getElementById("btn-theme");
	if (el) {
		el.textContent =
			t === "system"
				? bi("Тема: автоматически", "Theme: auto")
				: t === "dark"
					? bi("Тема: тёмная", "Theme: dark")
					: bi("Тема: светлая", "Theme: light");
	}
	if (typeof window.monaco?.editor?.defineTheme === "function") {
		registerFreeDevMonacoThemes(window.monaco);
		if (gitBlobMonacoEditor) applyFreeDevMonacoTheme(window.monaco);
	}
}

function themeCycle() {
	const order = ["system", "dark", "light"];
	const cur = localStorage.getItem("freedev-theme") || "system";
	const i = order.indexOf(cur);
	localStorage.setItem("freedev-theme", order[(i + 1) % order.length]);
	themeApply();
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if ((localStorage.getItem("freedev-theme") || "system") === "system") themeApply();
});

function navLink(href, label, activeNav, key) {
	const on = activeNav === key;
	return `<a href="#${esc(href)}" data-active="${on}" class="block rounded-md px-3 py-2 text-sm font-medium transition-colors ${on ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-900 dark:text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"}">${esc(label)}</a>`;
}

function layout({ title, subtitle, activeNav, breadcrumbs, body, showSample, session }) {
	const sess = session ?? FD_SESSION;
	const crumbs = (breadcrumbs || [])
		.map(
			(c) =>
				`<a class="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100" href="#${esc(c.href)}">${esc(c.label)}</a>`,
		)
		.join(`<span class="mx-2 text-neutral-300 dark:text-neutral-700">/</span>`);
	const bc = crumbs
		? `<nav class="flex flex-wrap items-center gap-x-1 text-xs font-medium">${crumbs}</nav>`
		: "";

	return `
<div class="fixed inset-0 z-40 hidden bg-black/40 md:hidden" id="nav-overlay" aria-hidden="true"></div>
<button type="button" id="nav-fab" class="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-900 shadow-lg md:hidden dark:border-neutral-800 dark:bg-neutral-900 dark:text-white" aria-expanded="false" aria-controls="sidebar">☰</button>

<div class="flex min-h-screen">
	<aside id="sidebar" class="fixed inset-y-0 left-0 z-50 flex w-56 -translate-x-full flex-col border-r border-neutral-200 bg-white transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-950 md:relative md:z-0 md:h-auto md:min-h-screen md:w-56 md:translate-x-0 md:flex-shrink-0">
		<div class="flex min-h-14 flex-col gap-1.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
			<div class="flex items-center gap-2">
				${SITE.logo_url ? `<img src="${esc(SITE.logo_url)}" alt="" class="max-h-9 max-w-[120px] shrink-0 object-contain object-left">` : ""}
				<a href="/" class="text-base font-semibold tracking-tight hover:opacity-80">${esc(SITE.product_name)}</a>
			</div>
			<p class="text-[12px] font-medium leading-snug text-neutral-700 dark:text-neutral-200">${esc(SITE.product_tagline || bi("SQLite, встроенный UI", "SQLite, embedded UI"))}</p>
		</div>
		<nav class="flex flex-col gap-0.5 p-3" aria-label="menu">
			${navLink("/", bi("Обзор", "Overview"), activeNav, "/")}
			${navLink("/projects", bi("Проекты", "Projects"), activeNav, "/projects")}
			${navLink("/git", bi("Git", "Git"), activeNav, "/git")}
			${navLink("/settings", bi("Настройки", "Settings"), activeNav, "/settings")}
			${sess?.role === "admin" ? navLink("/admin", bi("Админка", "Admin"), activeNav, "/admin") : ""}
			<a href="/" class="block rounded-md px-3 py-2 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-500 dark:hover:bg-neutral-900 dark:hover:text-white">${esc(bi("Главная", "Landing"))}</a>
		</nav>
		<p class="mt-auto px-4 pb-4 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">${esc(bi("Консоль", "Console"))}</p>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col md:ml-0">
		<header class="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/90 md:px-8">
			<div class="flex min-w-0 flex-col gap-1">
				${bc}
				<div class="flex flex-wrap items-baseline gap-2">
					<h1 class="text-lg font-semibold tracking-tight">${esc(title)}</h1>
					${subtitle ? `<span class="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-200">${esc(subtitle)}</span>` : ""}
				</div>
				${
					SITE.product_tagline
						? `<p class="max-w-prose text-[13px] font-medium leading-snug text-neutral-800 dark:text-neutral-200">${esc(SITE.product_tagline)}</p>`
						: ""
				}
				${
					sess
						? `<p class="text-xs font-medium text-neutral-700 dark:text-neutral-200"><span class="font-mono">${esc(sess.username)}</span><span class="text-neutral-500 dark:text-neutral-500"> · </span><span class="uppercase tracking-wide">${esc(sess.role)}</span></p>`
						: ""
				}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				${langDropdownMarkup()}
				${sess ? `<button type="button" id="btn-logout" class="rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900">${esc(bi("Выход", "Logout"))}</button>` : ""}
				<button type="button" id="btn-theme" class="rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"></button>
				<button type="button" id="btn-meta" class="rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900">${esc(bi("Мета", "Meta"))}</button>
				<button type="button" id="btn-health" class="rounded-md border border-neutral-200 bg-transparent px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900">${esc(bi("Состояние", "Health"))}</button>
				${showSample ? `<button type="button" id="btn-sample" class="fd-btn-primary rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm">${esc(bi("Демонстрация", "Demo"))}</button>` : ""}
			</div>
		</header>
		<main id="view" class="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">${body}</main>
	</div>
</div>`;
}

function skDash() {
	const k = pulseKit();
	const atom = atomLike();
	const top = atom ? 2 : 4;
	const bot = atom ? 1 : 2;
	const gridTop = atom ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4";
	const hbot = atom ? "h-44" : "h-64";
	return `
<div class="grid gap-4 ${gridTop}">${Array.from({ length: top }).map(() => `<div class="h-24 ${k}"></div>`).join("")}</div>
<div class="mt-8 grid gap-6 ${atom ? "" : "lg:grid-cols-2"}">${Array.from({ length: bot }).map(() => `<div class="${hbot} ${k}"></div>`).join("")}</div>`;
}

function skGrid(n) {
	const k = pulseKit();
	const atom = atomLike();
	const raw = n ?? (atom ? 3 : 6);
	const count = atom ? Math.min(raw, 4) : raw;
	return `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${Array.from({ length: count }).map(() => `<div class="h-36 ${k}"></div>`).join("")}</div>`;
}

function badge(status) {
	const s = String(status || "").toLowerCase();
	let cls =
		"inline-flex rounded-full px-2 py-0.5 text-xs font-medium font-mono ";
	if (s.includes("fail") || s.includes("error")) {
		cls += "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
	} else if (
		s.includes("pass") ||
		s === "ok" ||
		s === "done" ||
		s.includes("success")
	) {
		cls += "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
	} else {
		cls += "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
	}
	return `<span class="${cls}">${esc(status)}</span>`;
}

function stat(label, value, hint) {
	return `<div class="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
		<p class="text-xs font-medium uppercase tracking-wide text-neutral-500">${esc(label)}</p>
		<p class="mt-2 text-3xl font-semibold tabular-nums tracking-tight">${esc(String(value))}</p>
		${hint ? `<p class="mt-2 text-xs text-neutral-500">${esc(hint)}</p>` : ""}
	</div>`;
}

function renderOverview(o) {
	return `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
		${stat(bi("Проекты", "Projects"), o.projects, bi("Записей в системе", "Records"))}
		${stat(bi("Пайплайны", "Pipelines"), o.pipelines, bi("Конфигурации CI", "CI configurations"))}
		${stat(bi("Сборки", "Builds"), o.builds, bi("История запусков", "Run history"))}
		${stat(bi("Задачи", "Issues"), o.issues_total, bi("Управление задачами", "Work items"))}
		${stat(bi("Git", "Git"), o.git_repos, bi("Репозитории bare", "Bare repositories"))}
		${stat(bi("Сборки по статусам", "Builds by status"), `${o.builds_queued}·${o.builds_running}·${o.builds_passed}·${o.builds_failed}`, bi("очередь · выполняется · успешно · ошибка", "queued · running · passed · failed"))}
	</div>`;
}

function renderFeed(rows) {
	rows = arr(rows);
	if (!rows.length) {
		return `<p class="text-sm text-neutral-500">${esc(bi("Нет записей активности — создайте сборку из пайплайна.", "No activity — create a build from a pipeline."))}</p>`;
	}
	return `<ul class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">${rows
		.map((r) => {
			const b = r.build || {};
			return `<li class="flex flex-wrap items-center gap-3 p-4 text-sm">
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">${badge(b.status)}<span class="text-xs text-neutral-400">${fmt(b.started_at)}</span></div>
					<div class="mt-1 font-medium">
						<a class="hover:underline" href="#/projects/${encodeURIComponent(r.project_slug || "")}">${esc(r.project_name || "?")}</a>
						<span class="mx-1 text-neutral-400">→</span>
						<a class="hover:underline" href="#/pipelines/${encodeURIComponent(r.pipeline_id || "")}">${esc(r.pipeline_name || "?")}</a>
					</div>
					<p class="mt-1 font-mono text-[11px] text-neutral-400">${esc(b.id || "")}</p>
				</div>
				<a class="shrink-0 rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900" href="#/pipelines/${encodeURIComponent(r.pipeline_id || "")}/builds">${esc(bi("Журнал", "Logs"))}</a>
			</li>`;
		})
		.join("")}</ul>`;
}

function renderProjects(list, q) {
	list = arr(list);
	const ql = (q || "").trim().toLowerCase();
	const filt = ql
		? list.filter(
				(p) =>
					String(p.name || "")
						.toLowerCase()
						.includes(ql) ||
					String(p.slug || "")
						.toLowerCase()
						.includes(ql),
			)
		: list;
	if (!filt.length) {
		return `<p class="text-sm text-neutral-500">${esc(bi("По запросу записей не найдено.", "No matching records."))}</p>`;
	}
	return filt
		.map(
			(p) => `
<article class="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-neutral-800 dark:bg-neutral-950">
	<div class="flex items-start justify-between gap-3">
		<h3 class="font-semibold tracking-tight">${esc(p.name)}</h3>
		<div class="flex shrink-0 flex-wrap items-center gap-2">
			${Number(p.archived) ? `<span class="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">${esc(bi("архив", "arch"))}</span>` : ""}
			<span class="rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs dark:bg-neutral-900">${esc(p.slug)}</span>
		</div>
	</div>
	<p class="mt-2 line-clamp-2 text-sm text-neutral-500">${esc(p.description || "—")}</p>
	<div class="mt-4 flex items-center justify-between gap-2">
		<span class="text-xs text-neutral-400">${fmt(p.created_at)}</span>
		<a href="#/projects/${encodeURIComponent(p.slug)}" class="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Открыть", "Open"))}</a>
	</div>
</article>`,
		)
		.join("");
}

let chromeCtl = null;

function wireMobileNav() {
	const fab = document.getElementById("nav-fab");
	const overlay = document.getElementById("nav-overlay");
	const sidebar = document.getElementById("sidebar");
	function close() {
		fab?.setAttribute("aria-expanded", "false");
		sidebar?.classList.remove("translate-x-0");
		sidebar?.classList.add("-translate-x-full");
		overlay?.classList.add("hidden");
		document.body.classList.remove("overflow-hidden");
	}
	function open() {
		fab?.setAttribute("aria-expanded", "true");
		sidebar?.classList.remove("-translate-x-full");
		sidebar?.classList.add("translate-x-0");
		overlay?.classList.remove("hidden");
		document.body.classList.add("overflow-hidden");
	}
	return { close, open, fab, overlay, sidebar };
}

function wireLangDropdown(sig) {
	const btn = document.getElementById("btn-lang");
	const panel = document.getElementById("panel-lang");
	const wrap = document.getElementById("fd-lang-wrap");
	if (!btn || !panel || !wrap) return;
	const close = () => {
		panel.hidden = true;
		btn.setAttribute("aria-expanded", "false");
	};
	panel.hidden = true;
	btn.setAttribute("aria-expanded", "false");
	btn.addEventListener(
		"click",
		(e) => {
			e.stopPropagation();
			if (panel.hidden) {
				panel.hidden = false;
				btn.setAttribute("aria-expanded", "true");
				syncLangButtonUI();
			} else close();
		},
		{ signal: sig },
	);
	panel.querySelectorAll("[data-lang]").forEach((b) => {
		b.addEventListener(
			"click",
			async (ev) => {
				ev.stopPropagation();
				const code = b.getAttribute("data-lang");
				close();
				if (!code || code === getLang()) return;
				await withLangOverlay(bi("Смена языка…", "Switching language…"), async () => {
					setLang(code);
					syncLangButtonUI();
					await route();
				});
			},
			{ signal: sig },
		);
	});
	document.addEventListener("click", close, { signal: sig });
	wrap.addEventListener("click", (e) => e.stopPropagation(), { signal: sig });
}

function wireNavigationChrome() {
	chromeCtl?.abort();
	chromeCtl = new AbortController();
	const sig = chromeCtl.signal;
	const mob = wireMobileNav();

	document.getElementById("btn-theme")?.addEventListener("click", themeCycle, { signal: sig });
	document.getElementById("btn-logout")?.addEventListener("click", () => fdLogout(), { signal: sig });
	document.getElementById("btn-meta")?.addEventListener(
		"click",
		async () => {
			try {
				toast(JSON.stringify(await api("/meta")));
			} catch (e) {
				toast(e.message, "bad");
			}
		},
		{ signal: sig },
	);
	document.getElementById("btn-health")?.addEventListener(
		"click",
		async () => {
			try {
				toast(JSON.stringify(await api("/health")));
			} catch (e) {
				toast(e.message, "bad");
			}
		},
		{ signal: sig },
	);
	document.getElementById("btn-sample")?.addEventListener(
		"click",
		async () => {
			try {
				const slug = "demo-" + Math.random().toString(16).slice(2, 8);
				await api("/projects", {
					method: "POST",
					body: JSON.stringify({
						name: "Demo " + slug,
						slug,
						description: "demo",
					}),
				});
				toast(bi("Демонстрационный проект создан", "Demo project created"));
				location.hash = "#/projects";
				route();
			} catch (e) {
				toast(e.message, "bad");
			}
		},
		{ signal: sig },
	);

	mob.fab?.addEventListener(
		"click",
		() => {
			if (mob.sidebar?.classList.contains("translate-x-0")) mob.close();
			else mob.open();
		},
		{ signal: sig },
	);
	mob.overlay?.addEventListener("click", mob.close, { signal: sig });
	document.querySelectorAll("#sidebar nav a").forEach((a) => {
		a.addEventListener("click", mob.close, { signal: sig });
	});
	window.addEventListener(
		"resize",
		() => {
			if (window.matchMedia("(min-width:768px)").matches) mob.close();
		},
		{ passive: true, signal: sig },
	);
	wireLangDropdown(sig);
	syncLangButtonUI();
}

let gChord = 0;
document.addEventListener("keydown", (ev) => {
	if (ev.target?.closest?.("input,textarea,select,dialog")) return;
	if (ev.key === "g" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
		gChord = Date.now();
		return;
	}
	if (ev.key === "h" && Date.now() - gChord < 650 && !ev.ctrlKey && !ev.metaKey) {
		location.hash = "#/";
		route();
		gChord = 0;
		ev.preventDefault();
		return;
	}
	if (ev.key === "p" && Date.now() - gChord < 650 && !ev.ctrlKey && !ev.metaKey) {
		location.hash = "#/projects";
		route();
		gChord = 0;
		ev.preventDefault();
	}
});

function renderBuildNode(b) {
	const fin = b.finished_at ? fmt(b.finished_at) : "…";
	return `
<div class="relative border-l border-neutral-200 pl-6 dark:border-neutral-800">
	<div class="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-neutral-900 dark:bg-white"></div>
	<div class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
		<div class="flex flex-wrap items-center gap-2">${badge(b.status)}<span class="font-mono text-[11px] text-neutral-400">${esc(b.id)}</span></div>
		<p class="mt-2 text-xs text-neutral-500">${fmt(b.started_at)} → ${fin}</p>
		${b.log_tail ? `<pre class="mt-3 max-h-48 overflow-auto rounded-md bg-neutral-50 p-3 font-mono text-xs dark:bg-neutral-900">${esc(b.log_tail)}</pre>` : ""}
	</div>
</div>`;
}

function pickGitRef(branches) {
	const n = arr(branches).map((b) => b.name);
	if (n.includes("main")) return "main";
	if (n.includes("master")) return "master";
	return n[0] || "";
}

let gitBlobMonacoEditor = null;
let monacoLoaderPromise = null;

function disposeGitBlobEditor() {
	if (gitBlobMonacoEditor) {
		gitBlobMonacoEditor.dispose();
		gitBlobMonacoEditor = null;
	}
}

function ensureMonaco() {
	if (typeof window !== "undefined" && window.monaco?.editor) {
		return Promise.resolve(window.monaco);
	}
	if (!monacoLoaderPromise) {
		const ver = "0.52.2";
		const vsPath = `https://cdn.jsdelivr.net/npm/monaco-editor@${ver}/min/vs`;
		monacoLoaderPromise = new Promise((resolve, reject) => {
			const boot = () => {
				window.require.config({ paths: { vs: vsPath } });
				window.require(["vs/editor/editor.main"], () => {
					registerFreeDevMonacoThemes(window.monaco);
					resolve(window.monaco);
				});
			};
			if (typeof window.require === "function" && typeof window.require.config === "function") {
				boot();
				return;
			}
			const script = document.createElement("script");
			script.src = `${vsPath}/loader.js`;
			script.onload = () => boot();
			script.onerror = () => reject(new Error("Monaco loader failed"));
			document.head.appendChild(script);
		});
	}
	return monacoLoaderPromise;
}

function monacoLangFromPath(filePath) {
	const base = String(filePath || "").split("/").pop() || "";
	const dot = base.lastIndexOf(".");
	const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
	const map = {
		".js": "javascript",
		".mjs": "javascript",
		".cjs": "javascript",
		".jsx": "javascript",
		".ts": "typescript",
		".tsx": "typescript",
		".json": "json",
		".go": "go",
		".rs": "rust",
		".py": "python",
		".toml": "ini",
		".yaml": "yaml",
		".yml": "yaml",
		".md": "markdown",
		".html": "html",
		".htm": "html",
		".css": "css",
		".scss": "scss",
		".less": "less",
		".xml": "xml",
		".svg": "xml",
		".sql": "sql",
		".sh": "shell",
		".bash": "shell",
		".zsh": "shell",
		".ps1": "powershell",
		".c": "c",
		".h": "c",
		".cpp": "cpp",
		".cc": "cpp",
		".hpp": "cpp",
		".cs": "csharp",
		".java": "java",
		".lua": "lua",
		".luau": "lua",
		".rb": "ruby",
		".php": "php",
	};
	return map[ext] || "plaintext";
}

function utf8ToBase64(s) {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
	}
	return btoa(bin);
}

function arrayBufferToBase64(buf) {
	const bytes = new Uint8Array(buf);
	let bin = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
	}
	return btoa(bin);
}

function registerFreeDevMonacoThemes(monaco) {
	if (!monaco?.editor?.defineTheme || monaco.__fdThemesReg) return;
	monaco.__fdThemesReg = true;
	monaco.editor.defineTheme("freedev-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [],
		colors: {
			"editor.background": "#0c0c0c",
			"editor.foreground": "#e5e5e5",
			"editorLineNumber.foreground": "#737373",
			"editorLineNumber.activeForeground": "#d4d4d4",
			"editorCursor.foreground": "#fafafa",
			"editor.selectionBackground": "#52525299",
			"editor.inactiveSelectionBackground": "#40404066",
			"editor.lineHighlightBackground": "#171717",
			"editorLineHighlightBorder": "#00000000",
			"editorWhitespace.foreground": "#404040",
			"editorIndentGuide.background": "#262626",
			"editorIndentGuide.activeBackground": "#525252",
			"scrollbar.shadow": "#00000000",
			"scrollbarSlider.background": "#404040aa",
			"scrollbarSlider.hoverBackground": "#525252dd",
			"scrollbarSlider.activeBackground": "#737373ee",
			"minimap.background": "#0c0c0c",
			"editorWidget.background": "#171717",
			"editorWidget.border": "#404040",
			"editorBracketMatch.background": "#52525266",
			"editorBracketMatch.border": "#737373",
		},
	});
	monaco.editor.defineTheme("freedev-light", {
		base: "vs",
		inherit: true,
		rules: [],
		colors: {
			"editor.background": "#fafafa",
			"editor.foreground": "#171717",
			"editorLineNumber.foreground": "#a3a3a3",
			"editorLineNumber.activeForeground": "#525252",
			"editorCursor.foreground": "#171717",
			"editor.selectionBackground": "#a3a3a366",
			"editor.inactiveSelectionBackground": "#d4d4d455",
			"editor.lineHighlightBackground": "#f5f5f5",
			"editorLineHighlightBorder": "#00000000",
			"editorWhitespace.foreground": "#d4d4d4",
			"editorIndentGuide.background": "#e5e5e5",
			"editorIndentGuide.activeBackground": "#d4d4d4",
			"scrollbarSlider.background": "#a3a3a388",
			"scrollbarSlider.hoverBackground": "#737373aa",
			"scrollbarSlider.activeBackground": "#525252bb",
			"minimap.background": "#fafafa",
			"editorWidget.background": "#ffffff",
			"editorWidget.border": "#e5e5e5",
			"editorBracketMatch.background": "#e5e5e599",
			"editorBracketMatch.border": "#a3a3a3",
		},
	});
}

function applyFreeDevMonacoTheme(monaco) {
	if (!monaco?.editor?.setTheme) return;
	const dark = document.documentElement.classList.contains("dark");
	monaco.editor.setTheme(dark ? "freedev-dark" : "freedev-light");
	gitBlobMonacoEditor?.layout?.();
}

function fdBtnPill() {
	return "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-tight shadow-sm transition-colors border-neutral-400 bg-neutral-100 text-neutral-900 hover:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-50 dark:hover:bg-neutral-800";
}

function fdGitUploadPrimary() {
	return "inline-flex items-center rounded-full fd-btn-primary px-4 py-1.5 text-[11px] font-semibold shadow-sm ring-1 ring-black/15 hover:brightness-110 dark:ring-white/25";
}

function gitTreeHref(slug, entryPath, refQuery) {
	const segs = String(entryPath || "")
		.split("/")
		.filter(Boolean)
		.map((x) => encodeURIComponent(x));
	const base = "#/git/" + encodeURIComponent(slug) + "/tree";
	let url = segs.length ? base + "/" + segs.join("/") : base;
	if (refQuery) url += "?ref=" + encodeURIComponent(refQuery);
	return url;
}

function gitUploadHref(slug, ref, prefixPath) {
	const q = new URLSearchParams();
	if (ref) q.set("ref", ref);
	const pref = String(prefixPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
	if (pref) q.set("prefix", pref);
	const qs = q.toString();
	return "#/git/" + encodeURIComponent(slug) + "/upload" + (qs ? "?" + qs : "");
}

function gitBlobMediaKind(relPath) {
	const base = String(relPath || "").split("/").pop() || "";
	const dot = base.lastIndexOf(".");
	if (dot < 0) return null;
	const ext = base.slice(dot + 1).toLowerCase();
	if (["mp4", "webm", "ogv", "mov", "m4v"].includes(ext)) return "video";
	if (["mp3", "wav", "ogg", "opus", "flac", "m4a", "aac"].includes(ext)) return "audio";
	if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg"].includes(ext)) return "image";
	return null;
}

function gitBlobMediaMarkup(kind, rawHref, filePath) {
	const tail = esc(filePath.split("/").pop() || filePath);
	if (kind === "video") {
		return `<video controls playsinline preload="metadata" class="max-h-[78vh] w-full rounded-xl bg-black shadow-inner ring-1 ring-neutral-800" src="${esc(rawHref)}"></video>`;
	}
	if (kind === "audio") {
		return `<audio controls preload="metadata" class="w-full rounded-xl px-3 py-6 ring-1 ring-neutral-200 dark:ring-neutral-700" src="${esc(rawHref)}"></audio>`;
	}
	return `<img src="${esc(rawHref)}" alt="${tail}" class="mx-auto block max-h-[78vh] max-w-full rounded-xl object-contain shadow-lg ring-1 ring-neutral-200 dark:ring-neutral-700" loading="lazy" decoding="async">`;
}

function wireGitUploadDropZone(pathAutoPrefix) {
	const zone = document.getElementById("git-upload-zone");
	const inp = document.getElementById("git-up-file");
	const pick = document.getElementById("git-upload-pick");
	const nameEl = document.getElementById("git-upload-name");
	const pathEl = document.getElementById("git-up-path");
	if (!zone || !inp) return;
	const pre = pathAutoPrefix ? String(pathAutoPrefix).replace(/\/+$/, "") : "";
	const syncName = () => {
		const f = inp.files?.[0];
		if (nameEl) nameEl.textContent = f ? f.name : bi("Файл не выбран", "No file chosen");
	};
	const fillPath = (fname) => {
		if (!pathEl || !fname || String(pathEl.value || "").trim()) return;
		pathEl.value = pre ? pre + "/" + fname : fname;
	};
	pick?.addEventListener("click", () => inp.click());
	const arm = () => zone.classList.add("border-[color:var(--fd-accent)]", "bg-neutral-100", "dark:bg-neutral-900");
	const disarm = () => zone.classList.remove("border-[color:var(--fd-accent)]", "bg-neutral-100", "dark:bg-neutral-900");
	zone.addEventListener("dragover", (e) => {
		e.preventDefault();
		arm();
	});
	zone.addEventListener("dragleave", () => disarm());
	zone.addEventListener("drop", (e) => {
		e.preventDefault();
		disarm();
		const f = e.dataTransfer?.files?.[0];
		if (!f) return;
		const dt = new DataTransfer();
		dt.items.add(f);
		inp.files = dt.files;
		fillPath(f.name);
		syncName();
	});
	inp.addEventListener("change", () => {
		const f = inp.files?.[0];
		if (f) fillPath(f.name);
		syncName();
	});
	syncName();
}

function gitCloneHref(slug) {
	return `${location.origin}/git/${encodeURIComponent(slug)}.git`;
}

function gitZipHref(slug, ref) {
	const r = ref || "HEAD";
	return apiUrl("/git/repos/" + encodeURIComponent(slug) + "/archive.zip?ref=" + encodeURIComponent(r));
}

function gitBlobHref(slug, filePath, ref, edit) {
	const segs = String(filePath || "")
		.split("/")
		.filter(Boolean)
		.map((x) => encodeURIComponent(x));
	let h = "#/git/" + encodeURIComponent(slug) + "/blob/" + segs.join("/");
	const q = new URLSearchParams();
	if (ref) q.set("ref", ref);
	if (edit) q.set("edit", "1");
	const qs = q.toString();
	if (qs) h += "?" + qs;
	return h;
}

function gitSubNavHtml(slug, active) {
	const s = encodeURIComponent(slug);
	const mk = (key, href, ru, en) => {
		const on = active === key || (key === "tree" && active === "blob");
		const cls = on
			? "rounded-md border-2 border-[color:var(--fd-accent)] bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-900 dark:bg-neutral-800 dark:text-white"
			: "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-50 dark:border-neutral-500 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";
		return `<a href="${href}" class="${cls}">${esc(bi(ru, en))}</a>`;
	};
	return `<nav class="mb-4 flex flex-wrap gap-2">${mk("overview", "#/git/" + s, "Обзор", "Overview")}${mk("tree", "#/git/" + s + "/tree", "Файлы", "Files")}${mk("compare", "#/git/" + s + "/compare", "Сравнение", "Compare")}${mk("releases", "#/git/" + s + "/releases", "Релизы", "Releases")}${mk("upload", "#/git/" + s + "/upload", "Загрузка", "Upload")}${mk("settings", "#/git/" + s + "/settings", "Настройки", "Settings")}</nav>`;
}

function fdSettingsTabs(active) {
	const tabs = [
		["general", bi("Общие", "General")],
		["account", bi("Аккаунт", "Account")],
		["about", bi("О программе", "About")],
	];
	const mk = (id, label) => {
		const on = active === id;
		const cls = on
			? "rounded-full border border-neutral-900 bg-neutral-100 px-4 py-1.5 text-xs font-semibold dark:border-neutral-100 dark:bg-neutral-800 dark:text-white"
			: "rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";
		return `<a href="#/settings/${id}" class="${cls}">${esc(label)}</a>`;
	};
	return `<nav class="mb-8 flex flex-wrap gap-2 border-b border-neutral-200 pb-4 dark:border-neutral-800">${tabs.map(([id, l]) => mk(id, l)).join("")}</nav>`;
}

function projectTabsHtml(slug, tab) {
	const enc = encodeURIComponent(slug);
	const mk = (key, ru, en) => {
		const label = bi(ru, en);
		const on = tab === key;
		const qs = key === "overview" ? "" : "?tab=" + key;
		const cls = on
			? "rounded-full border border-neutral-900 bg-neutral-100 px-4 py-1.5 text-xs font-semibold dark:border-neutral-100 dark:bg-neutral-800 dark:text-white"
			: "rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800";
		return `<a href="#/projects/${enc}${qs}" class="${cls}">${esc(label)}</a>`;
	};
	return `<nav class="mb-6 flex flex-wrap gap-2">${mk("overview", "Обзор", "Overview")}${mk("pipelines", "Пайплайны", "Pipelines")}${mk("issues", "Задачи", "Issues")}${mk("settings", "Настройки", "Settings")}</nav>`;
}

function projectWorkspaceMarkup(project, pipes, rawTab, DEF_YAML) {
	let projTab = rawTab || "overview";
	if (!["overview", "pipelines", "issues", "settings"].includes(projTab)) projTab = "overview";
	const slugEnc = encodeURIComponent(project.slug);
	const overviewPane = `<section class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950"><h2 class="text-xl font-semibold tracking-tight">${esc(project.name)}</h2><p class="mt-1 font-mono text-xs text-neutral-500">/${esc(project.slug)} · ${esc(project.id)}</p><p class="mt-4 text-sm text-neutral-600 dark:text-neutral-400">${esc(project.description || "—")}</p></section>`;
	const pipesRows = pipes
		.map(
			(pl) => `<tr class="border-b border-neutral-100 dark:border-neutral-900">
<td class="px-6 py-3 font-medium">${esc(pl.name)}</td>
<td class="max-w-[120px] truncate px-6 py-3 font-mono text-xs text-neutral-400">${esc(pl.id)}</td>
<td class="px-6 py-3 text-xs text-neutral-500">${fmt(pl.created_at)}</td>
<td class="px-6 py-3 text-right">
<a class="mr-2 text-xs font-medium underline-offset-4 hover:underline" href="#/pipelines/${encodeURIComponent(pl.id)}">YAML</a>
<a class="text-xs font-medium underline-offset-4 hover:underline" href="#/pipelines/${encodeURIComponent(pl.id)}/builds">${esc(bi("Сборки", "Builds"))}</a>
</td><td class="px-6 py-3 text-right"><button type="button" data-pipe-del="${esc(pl.id)}" class="text-xs text-red-600 hover:underline">${esc(bi("удалить", "del"))}</button></td></tr>`,
		)
		.join("");
	const pipelinesPane = `<div class="grid gap-8 lg:grid-cols-2">
	<section class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
		<h3 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">${esc(bi("Новый пайплайн", "New pipeline"))} · ${pipes.length}</h3>
		<form id="pipe-form" class="mt-4 flex flex-col gap-4">
			<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Наименование", "Name"))}<input name="name" required autocomplete="off" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
			<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">YAML<textarea name="yaml" rows="12" spellcheck="false" class="rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950">${esc(DEF_YAML)}</textarea></label>
			<button type="submit" class="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Создать", "Create"))}</button>
		</form>
	</section>
	<section class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
		<h3 class="border-b border-neutral-200 px-6 py-4 text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">${esc(bi("Пайплайны", "Pipelines"))}</h3>
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm">
				<thead><tr class="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800"><th class="px-6 py-3">${esc(bi("Наименование", "Name"))}</th><th class="px-6 py-3">ID</th><th class="px-6 py-3">${esc(bi("Создан", "Created"))}</th><th class="px-6 py-3"></th><th class="px-6 py-3 text-right text-neutral-400">${esc(bi("удал.", "del."))}</th></tr></thead>
				<tbody>${pipesRows}</tbody>
			</table>
		</div>
		${pipes.length ? "" : `<p class="p-6 text-sm text-neutral-500">${esc(bi("Пайплайны отсутствуют", "No pipelines"))}</p>`}
	</section>
</div>`;
	const issuesPane = `<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><p class="text-sm text-neutral-600 dark:text-neutral-400">${esc(bi("Полный список задач — отдельная страница.", "Full issue tracker lives on its own page."))}</p><a href="#/projects/${slugEnc}/issues" class="mt-6 inline-flex rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Открыть задачи", "Open issues"))}</a></section>`;
	const settingsPane = `<section class="space-y-6 rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><form id="proj-desc-form" class="space-y-3"><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Описание проекта", "Project description"))}<textarea name="description" id="proj-desc-field" rows="6" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950">${esc(project.description || "")}</textarea></label><button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Сохранить описание", "Save description"))}</button></form><div class="flex flex-wrap gap-2 border-t border-neutral-200 pt-6 dark:border-neutral-800"><button type="button" id="copy-slug" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("Копировать слаг", "Copy slug"))}</button><a href="${apiUrl("/projects/" + encodeURIComponent(project.id) + "/export")}" download="export-${project.slug}.json" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("Экспорт JSON", "Export JSON"))}</a><button type="button" id="btn-archive" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${Number(project.archived) ? esc(bi("Из архива", "Unarchive")) : esc(bi("В архив", "Archive"))}</button><a href="#/projects" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">← ${esc(bi("Все проекты", "All projects"))}</a></div></section>`;
	const panes = {
		overview: overviewPane,
		pipelines: pipelinesPane,
		issues: issuesPane,
		settings: settingsPane,
	};
	return projectTabsHtml(project.slug, projTab) + panes[projTab];
}

async function route() {
	disposeGitBlobEditor();
	if (!(await ensureGate())) return;
	const hashRaw = (location.hash || "#/").slice(1);
	const qi = hashRaw.indexOf("?");
	const hashPath = qi >= 0 ? hashRaw.slice(0, qi) : hashRaw;
	const hashParams = new URLSearchParams(qi >= 0 ? hashRaw.slice(qi + 1) : "");
	const parts = hashPath.split("/").filter(Boolean);
	const [p0, p1, p2, p3] = parts;
	$root.setAttribute("aria-busy", "true");

	if (!p0) {
		$root.innerHTML = layout({
			title: bi("Сводка", "Overview"),
			subtitle: bi("Облегчённая альтернатива OneDev", "Lite alternative for OneDev"),
			activeNav: "/",
			showSample: true,
			body: skDash(),
		});
		themeApply();
		wireNavigationChrome();
		try {
			const raw = await Promise.all([
				api("/overview"),
				api("/feed?limit=" + encodeURIComponent(String(LIM.feed))),
			]);
			const o = overviewSafe(raw[0]);
			const feed = arr(raw[1]);
			document.getElementById("view").innerHTML = `
${renderOverview(o)}
<div class="mt-8 grid gap-8 lg:grid-cols-2">
	<section id="feed-panel">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">${esc(bi("Лента событий", "Activity feed"))}</h2>
			<button type="button" id="btn-feed-refresh" class="text-xs font-medium text-neutral-600 underline-offset-4 hover:underline dark:text-neutral-400">${esc(bi("Обновить", "Refresh"))}</button>
		</div>
		${renderFeed(feed)}
	</section>
	<section class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">${esc(bi("Быстрый доступ", "Shortcuts"))}</h2>
		<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
			<a href="#/projects" class="rounded-lg border border-neutral-200 p-4 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">${esc(bi("Проекты", "Projects"))}</a>
			<a href="#/search" class="rounded-lg border border-neutral-200 p-4 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">${esc(bi("Поиск", "Search"))}</a>
			<a href="#/git" class="rounded-lg border border-neutral-200 p-4 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">${esc(bi("Git", "Git"))}</a>
			<button type="button" id="tile-new" class="rounded-lg border border-neutral-200 p-4 text-left text-sm font-medium hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">${esc(bi("Новый проект", "New project"))}</button>
			<span class="rounded-lg border border-dashed border-neutral-200 p-4 text-xs text-neutral-500 dark:border-neutral-800"><kbd class="font-mono">g</kbd> <kbd class="font-mono">p</kbd> / <kbd class="font-mono">h</kbd> · ${esc(bi("горячие клавиши", "keyboard shortcuts"))}</span>
		</div>
	</section>
</div>`;
			document.getElementById("btn-feed-refresh")?.addEventListener("click", async () => {
				try {
					const f = arr(await api("/feed?limit=" + encodeURIComponent(String(LIM.feed))));
					const panel = document.getElementById("feed-panel");
					const holder = panel?.children[1];
					if (!panel || !holder) return;
					const wrap = document.createElement("div");
					wrap.innerHTML = renderFeed(f).trim();
					const nue = wrap.firstElementChild;
					if (nue) holder.replaceWith(nue);
				} catch (e) {
					toast(e.message, "bad");
				}
			});
			document.getElementById("tile-new")?.addEventListener("click", () => {
				location.hash = "#/projects/new";
				route();
			});
		} catch (e) {
			document.getElementById("view").innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "settings") {
		const tab = p1 === "account" || p1 === "about" ? p1 : "general";
		$root.innerHTML = layout({
			title: bi("Настройки FreeDev", "FreeDev settings"),
			subtitle: "",
			activeNav: "/settings",
			body: `<div id="fd-settings-root">${fdSettingsTabs(tab)}<div id="fd-settings-pane"></div></div>`,
		});
		themeApply();
		wireNavigationChrome();
		const pane = document.getElementById("fd-settings-pane");
		if (tab === "general") {
			const langRows = LANG_LIST.map((L) => {
				const on = L.code === getLang();
				return `<button type="button" class="fd-set-lang flex w-full items-center gap-4 px-4 py-3 text-left text-sm transition hover:bg-neutral-100 dark:hover:bg-neutral-800" data-lang="${L.code}"><img src="${flagSrc(L.flagCode, 80)}" alt="" width="32" height="22" class="h-6 w-8 shrink-0 rounded-[5px] object-cover shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.12]" loading="lazy" decoding="async" /><span class="font-medium">${esc(L.label)}</span>${on ? `<span class="ml-auto text-neutral-400">✓</span>` : ""}</button>`;
			}).join("");
			const curTh = localStorage.getItem("freedev-theme") || "system";
			pane.innerHTML = `<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">${esc(bi("Язык", "Language"))}</h2><p class="mt-1 text-xs text-neutral-600 dark:text-neutral-400">${esc(bi("CDN flagcdn.com — компактные флаги.", "CDN flagcdn.com — compact flags."))}</p><div class="mt-4 divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">${langRows}</div><h2 class="mt-10 text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">${esc(bi("Тема оформления", "Appearance"))}</h2><select id="fd-set-theme" class="mt-3 w-full max-w-xs rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"><option value="system" ${curTh === "system" ? "selected" : ""}>${esc(bi("Как в системе", "Match system"))}</option><option value="dark" ${curTh === "dark" ? "selected" : ""}>${esc(bi("Тёмная", "Dark"))}</option><option value="light" ${curTh === "light" ? "selected" : ""}>${esc(bi("Светлая", "Light"))}</option></select>${FD_SESSION?.role === "admin" ? `<p class="mt-8 text-sm"><a href="#/admin" class="font-medium underline-offset-4 hover:underline">${esc(bi("Администрирование инстанса", "Instance administration"))}</a></p>` : ""}</section>`;
			pane.querySelectorAll(".fd-set-lang").forEach((btn) => {
				btn.addEventListener("click", async () => {
					const code = btn.getAttribute("data-lang");
					if (!code || code === getLang()) return;
					await withLangOverlay(bi("Смена языка…", "Switching language…"), async () => {
						setLang(code);
						syncLangButtonUI();
						await route();
					});
				});
			});
			document.getElementById("fd-set-theme")?.addEventListener("change", (ev) => {
				localStorage.setItem("freedev-theme", ev.target.value);
				themeApply();
			});
		} else if (tab === "account") {
			pane.innerHTML = `<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><p class="text-base font-semibold">${esc(FD_SESSION?.username || "—")}</p><p class="mt-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">${esc(FD_SESSION?.role || "")}</p><button type="button" id="fd-set-logout" class="mt-6 rounded-lg border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Выход", "Logout"))}</button></section>`;
			document.getElementById("fd-set-logout")?.addEventListener("click", () => fdLogout());
		} else {
			pane.innerHTML = `<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><pre id="fd-about-meta" class="max-h-[60vh] overflow-auto rounded-lg bg-neutral-50 p-4 font-mono text-[11px] leading-relaxed dark:bg-neutral-900">${esc(bi("Загрузка…", "Loading…"))}</pre></section>`;
			try {
				const m = await fetch("/api/meta", { credentials: "same-origin" }).then((r) => r.json());
				const el = document.getElementById("fd-about-meta");
				if (el) el.textContent = JSON.stringify(m, null, 2);
			} catch (e) {
				const el = document.getElementById("fd-about-meta");
				if (el) el.textContent = e.message;
			}
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "projects" && !p1) {
		$root.innerHTML = layout({
			title: bi("Проекты", "Projects"),
			subtitle: bi("Реестр рабочих областей", "Workspace registry"),
			activeNav: "/projects",
			body: `
<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<label class="flex max-w-md flex-1 flex-col gap-1 text-xs font-medium text-neutral-500">
		${esc(bi("Поиск", "Search"))}
		<input id="proj-q" type="search" autocomplete="off" placeholder="${esc(bi("имя или slug", "name or slug"))}" class="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white">
	</label>
	<div class="flex gap-2">
		<button type="button" id="btn-open-new" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Новый проект", "New project"))}</button>
		<button type="button" id="btn-proj-reload" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Обновить", "Reload"))}</button>
	</div>
</div>
<div id="proj-slot">${skGrid()}</div>`,
		});
		themeApply();
		wireNavigationChrome();
		const slot = document.getElementById("proj-slot");
		let list = [];
		try {
			list = arr(await api("/projects"));
			slot.innerHTML = `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${renderProjects(list, "")}</div>`;
		} catch (e) {
			slot.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		const qEl = document.getElementById("proj-q");
		const rerender = debounce(() => {
			slot.innerHTML = `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${renderProjects(list, qEl?.value)}</div>`;
		}, atomLike() ? 280 : weakDevice() ? 180 : 72);
		qEl?.addEventListener("input", () => rerender());
		document.getElementById("btn-proj-reload")?.addEventListener("click", () => route());
		document.getElementById("btn-open-new")?.addEventListener("click", () => {
			location.hash = "#/projects/new";
			route();
		});
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "search") {
		const initial = p1 ? decodeURIComponent(p1) : "";
		$root.innerHTML = layout({
			title: bi("Поиск", "Search"),
			subtitle: bi("глобальный запрос REST /api/search", "global query · REST /api/search"),
			activeNav: "/search",
			body: `<div class="flex flex-wrap gap-2">
<input id="glob-q" type="search" class="min-w-[200px] flex-1 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950" placeholder="${esc(bi("строка запроса", "search query"))}" value="${esc(initial)}">
<button type="button" id="glob-go" class="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-950">${esc(bi("Найти", "Search"))}</button>
</div><div id="glob-out" class="mt-6 space-y-8"></div>`,
		});
		themeApply();
		wireNavigationChrome();
		const out = document.getElementById("glob-out");
		const inp = document.getElementById("glob-q");
		async function runGlob() {
			const q = String(inp?.value || "").trim();
			if (!q) {
				out.innerHTML = `<p class="text-sm text-neutral-500">${esc(bi("Строка запроса не заполнена", "Query string is empty"))}</p>`;
				return;
			}
			out.innerHTML = `<div class="h-24 ${pulseKit()}"></div>`;
			try {
				const data = await api(
					"/search?q=" +
						encodeURIComponent(q) +
						"&limit=" +
						encodeURIComponent(String(LIM.search)),
				);
				const pr = arr(data.projects);
				const iss = arr(data.issues);
				const prUl = pr.length
					? `<ul class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">${pr
							.map(
								(p) =>
									`<li class="flex justify-between gap-3 p-3 text-sm"><a class="font-medium hover:underline" href="#/projects/${encodeURIComponent(p.slug)}">${esc(p.name)}</a>${p.archived ? `<span class="text-xs text-neutral-400">${esc(bi("архив", "arch"))}</span>` : ""}</li>`,
							)
							.join("")}</ul>`
					: `<p class="text-sm text-neutral-500">${esc(bi("Проекты не найдены", "No projects found"))}</p>`;
				const isUl = iss.length
					? `<ul class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">${iss
							.map(
								(i) =>
									`<li class="p-3 text-sm"><div class="mb-1 flex flex-wrap items-center gap-2"><span class="${issueBadgeCls(i.status)}">${esc(i.status)}</span><a class="font-medium hover:underline" href="#/projects/${encodeURIComponent(i.project_slug)}/issues/${encodeURIComponent(i.id)}">${esc(truncate(i.title, 96))}</a></div><p class="text-xs text-neutral-500">${esc(i.project_name)}</p></li>`,
							)
							.join("")}</ul>`
					: `<p class="text-sm text-neutral-500">${esc(bi("Задачи не найдены", "No issues found"))}</p>`;
				out.innerHTML = `<section><h3 class="mb-3 text-xs font-semibold uppercase text-neutral-500">${esc(bi("Проекты", "Projects"))} (${pr.length})</h3>${prUl}</section><section class="mt-8"><h3 class="mb-3 text-xs font-semibold uppercase text-neutral-500">${esc(bi("Задачи", "Issues"))} (${iss.length})</h3>${isUl}</section>`;
			} catch (e) {
				out.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
		}
		document.getElementById("glob-go")?.addEventListener("click", runGlob);
		inp?.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") runGlob();
		});
		if (initial) await runGlob();
		else out.innerHTML = `<p class="text-sm text-neutral-500">${esc(bi("Введите запрос и нажмите «Найти»", "Enter a query and press Search"))}</p>`;
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "git" && !p1) {
		$root.innerHTML = layout({
			title: bi("Git", "Git"),
			subtitle: bi("Bare · smart HTTP · список файлов через API", "Bare · smart HTTP · file tree via API"),
			activeNav: "/git",
			body: `
<p class="mb-4 max-w-2xl text-sm text-neutral-600 dark:text-neutral-400">${esc(bi("Clone и push: URL вида /git/{slug}.git — на сервере нужен git в PATH.", "Clone and push use /git/{slug}.git when git is on the server PATH."))}</p>
<div class="mb-6 flex flex-wrap gap-2">
<a href="#/git/new" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Новый репозиторий", "New repository"))}</a>
<button type="button" id="btn-git-reload" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Обновить", "Reload"))}</button>
</div>
<div id="git-slot">${skGrid(4)}</div>`,
		});
		themeApply();
		wireNavigationChrome();
		const slot = document.getElementById("git-slot");
		async function renderGitList() {
			try {
				const rows = arr(await api("/git/repos"));
				if (!rows.length) {
					slot.innerHTML = `<p class="text-sm text-neutral-500">${esc(bi("Репозитории отсутствуют.", "No repositories yet."))}</p>`;
					return;
				}
				slot.innerHTML = `<div class="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"><table class="w-full text-left text-sm"><thead><tr class="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800"><th class="px-4 py-3">${esc(bi("Имя", "Name"))}</th><th class="px-4 py-3">Slug</th><th class="px-4 py-3">${esc(bi("Действия", "Actions"))}</th></tr></thead><tbody>${rows
					.map(
						(g) =>
							`<tr class="border-b border-neutral-100 dark:border-neutral-900"><td class="px-4 py-3 font-medium">${esc(g.name)}</td><td class="px-4 py-3 font-mono text-xs">${esc(g.slug)}</td><td class="px-4 py-3"><a class="mr-3 font-medium underline-offset-4 hover:underline" href="#/git/${encodeURIComponent(g.slug)}">${esc(bi("Открыть", "Open"))}</a><span class="font-mono text-[11px] text-neutral-400">${esc(`git clone ${gitCloneHref(g.slug)}`)}</span><p class="mt-1 text-[10px] text-neutral-400">${esc(bi("Smart HTTP: Basic-auth тем же логином/паролем.", "Smart HTTP: Basic auth with same username/password."))}</p></td></tr>`,
					)
					.join("")}</tbody></table></div>`;
			} catch (e) {
				slot.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
		}
		await renderGitList();
		document.getElementById("btn-git-reload")?.addEventListener("click", () => route());
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "git" && p1 === "new") {
		$root.innerHTML = layout({
			title: bi("Новый репозиторий", "New repository"),
			subtitle: bi("Bare · Smart HTTP", "Bare · Smart HTTP"),
			activeNav: "/git",
			breadcrumbs: [
				{ label: bi("Git", "Git"), href: "/git" },
				{ label: bi("Новый", "New"), href: "/git/new" },
			],
			body: `<section class="max-w-xl rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
<form id="form-git-new-page" class="flex flex-col gap-4">
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Наименование", "Name"))}<input name="name" required autocomplete="off" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Слаг", "Slug"))}<input name="slug" autocomplete="off" pattern="[a-z0-9][a-z0-9-]{0,62}" placeholder="my-repo" class="rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Связать с проектом", "Link to project"))}</label>
<select name="project_id" id="git-project-select-new" class="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-white">
<option value="">${esc(bi("— не связано —", "— none —"))}</option>
</select>
<p class="text-xs text-neutral-500">${esc(bi("Выберите проект из списка или оставьте «не связано».", "Pick a workspace project or leave unlinked."))}</p>
<div class="flex flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
<button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Создать", "Create"))}</button>
<a href="#/git" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Отмена", "Cancel"))}</a>
</div>
</form>
</section>`,
		});
		themeApply();
		wireNavigationChrome();
		await fillGitProjectSelect(document.getElementById("git-project-select-new"));
		document.getElementById("form-git-new-page")?.addEventListener("submit", async (ev) => {
			ev.preventDefault();
			const fd = new FormData(ev.target);
			const name = String(fd.get("name") || "").trim();
			let slug = String(fd.get("slug") || "").trim().toLowerCase();
			const project_id = String(fd.get("project_id") || "").trim();
			if (!slug && name)
				slug = name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "")
					.slice(0, 48);
			if (!slug || !name) {
				toast(bi("Укажите имя и слаг", "Name and slug required"), "bad");
				return;
			}
			try {
				await api("/git/repos", {
					method: "POST",
					body: JSON.stringify({ name, slug, project_id }),
				});
				toast(bi("Репозиторий создан", "Repository created"));
				location.hash = "#/git/" + encodeURIComponent(slug);
				route();
			} catch (err) {
				toast(err.message, "bad");
			}
		});
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "git" && p1) {
		const slug = decodeURIComponent(p1);

		if (p2 === "settings") {
			const setCrumbs = [
				{ label: bi("Git", "Git"), href: "/git" },
				{ label: slug, href: "/git/" + encodeURIComponent(slug) },
				{
					label: bi("Настройки", "Settings"),
					href: "/git/" + encodeURIComponent(slug) + "/settings",
				},
			];
			$root.innerHTML = layout({
				title: bi("Настройки репозитория", "Repository settings"),
				subtitle: slug,
				activeNav: "/git",
				breadcrumbs: setCrumbs,
				body: skGrid(2),
			});
			themeApply();
			wireNavigationChrome();
			const main = document.getElementById("view");
			try {
				const meta = await api("/git/repos/" + encodeURIComponent(slug));
				const cloneLn = esc(`git clone ${gitCloneHref(slug)}`);
				const projLinkHtml =
					meta.project_slug != null && String(meta.project_slug).trim() !== ""
						? `<a href="#/projects/${encodeURIComponent(meta.project_slug)}" class="font-medium underline-offset-4 hover:underline">${esc(String(meta.project_slug))}</a>`
						: `<span class="text-neutral-500">—</span>`;
				main.innerHTML =
					gitSubNavHtml(slug, "settings") +
					`<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><dl class="grid gap-4 text-sm md:grid-cols-2"><div><dt class="text-xs uppercase text-neutral-500">${esc(bi("Имя", "Name"))}</dt><dd class="mt-1 font-medium">${esc(meta.name)}</dd></div><div><dt class="text-xs uppercase text-neutral-500">Slug</dt><dd class="mt-1 font-mono text-xs">${esc(meta.slug)}</dd></div><div class="md:col-span-2"><dt class="text-xs uppercase text-neutral-500">${esc(bi("Клонирование", "Clone"))}</dt><dd class="mt-1 break-all font-mono text-xs">${cloneLn}</dd></div><div><dt class="text-xs uppercase text-neutral-500">${esc(bi("Рабочая область", "Workspace"))}</dt><dd class="mt-1">${projLinkHtml}</dd></div></dl><div class="mt-6 flex flex-wrap gap-2 border-t border-neutral-200 pt-6 dark:border-neutral-800"><button type="button" id="btn-git-copy-clone-s" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Копировать команду clone", "Copy clone command"))}</button><button type="button" id="btn-git-del-s" class="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">${esc(bi("Удалить репозиторий", "Delete repository"))}</button><a href="#/git/${encodeURIComponent(slug)}" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Назад к репозиторию", "Back to repo"))}</a></div></section>`;
				document.getElementById("btn-git-copy-clone-s")?.addEventListener("click", async () => {
					try {
						await navigator.clipboard.writeText(`git clone ${gitCloneHref(slug)}`);
						toast(bi("Скопировано в буфер", "Copied to clipboard"));
					} catch {
						toast(bi("Буфер обмена недоступен", "Clipboard unavailable"), "bad");
					}
				});
				document.getElementById("btn-git-del-s")?.addEventListener("click", async () => {
					if (!confirm(bi("Удалить репозиторий и файлы на диске?", "Delete repository and files on disk?"))) return;
					try {
						await api("/git/repos/" + encodeURIComponent(slug), { method: "DELETE" });
						toast(bi("Удалено", "Deleted"));
						location.hash = "#/git";
						route();
					} catch (e) {
						toast(e.message, "bad");
					}
				});
			} catch (e) {
				main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
			$root.removeAttribute("aria-busy");
			return;
		}

		if (p2 === "upload") {
			const refQ = hashParams.get("ref") || "";
			const prefixQ = String(hashParams.get("prefix") || "").replace(/^\/+/, "").replace(/\/+$/, "");
			const treeTail =
				prefixQ === ""
					? ""
					: "/" +
						prefixQ
							.split("/")
							.filter(Boolean)
							.map((seg) => encodeURIComponent(seg))
							.join("/");
			const filesCrumbHref =
				"/git/" + encodeURIComponent(slug) + "/tree" + treeTail + (refQ ? "?ref=" + encodeURIComponent(refQ) : "");
			const uploadCrumbs = [
				{ label: bi("Git", "Git"), href: "/git" },
				{ label: slug, href: "/git/" + encodeURIComponent(slug) },
				{ label: bi("Файлы", "Files"), href: filesCrumbHref },
				{ label: bi("Загрузка", "Upload"), href: "/git/" + encodeURIComponent(slug) + "/upload" },
			];
			$root.innerHTML = layout({
				title: bi("Загрузка файла", "Upload file"),
				subtitle: slug + (refQ ? " · " + refQ : ""),
				activeNav: "/git",
				breadcrumbs: uploadCrumbs,
				body: skGrid(2),
			});
			themeApply();
			wireNavigationChrome();
			const main = document.getElementById("view");
			try {
				await api("/git/repos/" + encodeURIComponent(slug));
				const branches = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/branches"));
				const branchDef = refQ || pickGitRef(branches) || "main";
				const cancelHref = gitTreeHref(slug, prefixQ, branchDef);
				const pathPlaceholder =
					prefixQ === "" ? "README.md" : prefixQ.replace(/\/+$/, "") + "/" + "README.md";
				main.innerHTML =
					gitSubNavHtml(slug, "upload") +
					`<section class="rounded-xl border border-neutral-200 bg-white p-6 md:p-10 lg:p-12 dark:border-neutral-800 dark:bg-neutral-950"><form id="form-git-up" class="mx-auto flex max-w-xl flex-col gap-6"><div id="git-upload-zone" tabindex="-1" class="rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 px-6 py-12 text-center outline-none transition hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900/40 dark:hover:border-neutral-500"><input type="file" id="git-up-file" required class="sr-only"><button type="button" id="git-upload-pick" class="fd-btn-primary rounded-full px-6 py-2.5 text-sm font-semibold shadow-md">${esc(bi("Выбрать файл", "Choose file"))}</button><p id="git-upload-name" class="mt-5 truncate px-2 font-mono text-xs text-neutral-700 dark:text-neutral-300"></p><p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">${esc(bi("Или перетащи файл сюда", "Or drop a file here"))}</p></div><label class="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">${esc(bi("Путь в репозитории", "Path in repo"))}<input id="git-up-path" type="text" autocomplete="off" class="rounded-lg border border-neutral-200 px-4 py-3 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950" placeholder="${esc(pathPlaceholder)}"></label><label class="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">${esc(bi("Ветка", "Branch"))}<input id="git-up-branch" type="text" value="${esc(branchDef)}" class="rounded-lg border border-neutral-200 px-4 py-3 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950"></label><label class="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">${esc(bi("Сообщение коммита", "Commit message"))}<input id="git-up-msg" type="text" class="rounded-lg border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-950" value="${esc(bi("Обновление через веб", "Web upload"))}"></label><div class="flex flex-wrap justify-end gap-3 pt-2"><a href="${cancelHref}" class="rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-medium dark:border-neutral-800">${esc(bi("Отмена", "Cancel"))}</a><button type="submit" class="fd-btn-primary rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm">${esc(bi("Загрузить", "Upload"))}</button></div></form></section>`;
				wireGitUploadDropZone(prefixQ);
				const pathEl = document.getElementById("git-up-path");
				document.getElementById("form-git-up")?.addEventListener("submit", async (ev) => {
					ev.preventDefault();
					const fileInp = document.getElementById("git-up-file");
					const f = fileInp?.files?.[0];
					if (!f) {
						toast(bi("Выберите файл", "Pick a file"), "bad");
						return;
					}
					const pth = String(pathEl?.value || "").trim();
					if (!pth) {
						toast(bi("Укажите путь", "Path required"), "bad");
						return;
					}
					const fd = new FormData();
					fd.append("file", f);
					fd.append("path", pth);
					fd.append("branch", String(document.getElementById("git-up-branch")?.value || "").trim() || branchDef);
					fd.append(
						"message",
						String(document.getElementById("git-up-msg")?.value || "").trim() ||
							bi("Загрузка файла", "File upload"),
					);
					try {
						const res = await fetch("/api/git/repos/" + encodeURIComponent(slug) + "/upload", {
							method: "POST",
							body: fd,
						});
						const txt = await res.text();
						let data = null;
						try {
							data = txt ? JSON.parse(txt) : null;
						} catch {
							data = { error: txt };
						}
						if (!res.ok) {
							toast(String(data?.error || res.statusText), "bad");
							return;
						}
						toast(bi("Коммит выполнен", "Committed"));
						location.hash = cancelHref;
						route();
					} catch (e) {
						toast(e.message, "bad");
					}
				});
			} catch (e) {
				main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
			$root.removeAttribute("aria-busy");
			return;
		}

		if (p2 === "blob") {
			const filePath = parts.slice(3).map(decodeURIComponent).join("/");
			const blobMediaKind = gitBlobMediaKind(filePath);
			const blobRefQ = hashParams.get("ref") || "";
			const blobEdit = hashParams.get("edit") === "1";
			const blobQs = new URLSearchParams();
			if (blobRefQ) blobQs.set("ref", blobRefQ);
			if (blobEdit) blobQs.set("edit", "1");
			const blobQsStr = blobQs.toString();
			const blobCrumbs = [
				{ label: bi("Git", "Git"), href: "/git" },
				{ label: slug, href: "/git/" + encodeURIComponent(slug) },
				{
					label: bi("Файлы", "Files"),
					href:
						"/git/" +
						encodeURIComponent(slug) +
						"/tree" +
						(blobRefQ ? "?ref=" + encodeURIComponent(blobRefQ) : ""),
				},
				{
					label: filePath.split("/").pop() || filePath,
					href:
						"/git/" +
						encodeURIComponent(slug) +
						"/blob/" +
						parts.slice(3).map(encodeURIComponent).join("/") +
						(blobQsStr ? "?" + blobQsStr : ""),
				},
			];
			$root.innerHTML = layout({
				title: blobEdit
					? blobMediaKind
						? bi("Медиа", "Media")
						: bi("Редактор · Monaco", "Editor · Monaco")
					: blobMediaKind
						? bi("Медиа · просмотр", "Media · preview")
						: bi("Просмотр · Monaco", "Viewer · Monaco"),
				subtitle: filePath,
				activeNav: "/git",
				breadcrumbs: blobCrumbs,
				body: skGrid(3),
			});
			themeApply();
			wireNavigationChrome();
			const main = document.getElementById("view");
			try {
				await api("/git/repos/" + encodeURIComponent(slug));
				const branches = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/branches"));
				const refEff = blobRefQ || pickGitRef(branches);
				const parentDir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
				const rawHref = apiUrl(
					"/git/repos/" +
						encodeURIComponent(slug) +
						"/raw?ref=" +
						encodeURIComponent(refEff || "HEAD") +
						"&path=" +
						encodeURIComponent(filePath),
				);
				const zipHr = gitZipHref(slug, refEff || pickGitRef(branches));
				const hrefOpen = gitBlobHref(slug, filePath, refEff, false);
				const hrefEdit = gitBlobHref(slug, filePath, refEff, true);
				const editBar =
					blobEdit && blobMediaKind
						? `<p class="flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">${esc(bi("Этот файл — медиа. Замена только загрузкой:", "Media file — replace via upload:"))}<a href="${gitUploadHref(slug, refEff, parentDir)}" class="${fdBtnPill()}">${esc(bi("Загрузка", "Upload"))}</a></p>`
						: blobEdit
							? `<label class="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">${esc(bi("Сообщение коммита", "Commit message"))}<input id="git-blob-msg" type="text" class="min-w-[12rem] flex-1 rounded-full border border-neutral-200 px-3 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-950" value="${esc(bi("Правка через Monaco", "Monaco edit"))}"></label><button type="button" id="btn-git-blob-save" class="${fdGitUploadPrimary()}">${esc(bi("Коммит", "Commit"))}</button>`
							: "";
				main.innerHTML =
					gitSubNavHtml(slug, "blob") +
					`<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><div class="flex flex-wrap items-center gap-2"><a href="${gitTreeHref(slug, parentDir, refEff)}" class="${fdBtnPill()}">${esc(bi("Каталог", "Directory"))}</a><select id="git-blob-ref" class="${fdBtnPill()} appearance-none bg-white py-1 pl-3 pr-8 dark:bg-neutral-950">${branches
						.map(
							(b) =>
								`<option value="${esc(b.name)}" ${b.name === refEff ? "selected" : ""}>${esc(b.name)}</option>`,
						)
						.join("")}</select><a href="${hrefOpen}" class="${fdBtnPill()}">${esc(bi("Открыть", "Open"))}</a><a href="${hrefEdit}" class="${fdBtnPill()}">${esc(bi("Правка", "Edit"))}</a><a href="${rawHref}" target="_blank" rel="noopener" class="${fdBtnPill()}">${esc(bi("Raw", "Raw"))}</a><a href="${zipHr}" download class="${fdBtnPill()}">${esc(bi("ZIP", "ZIP"))}</a><button type="button" id="btn-git-copy-remote" class="${fdBtnPill()}">${esc(bi("Git URL", "Git URL"))}</button>${editBar}</div>${blobEdit && !blobMediaKind ? `<p class="mt-3 text-xs text-amber-800 dark:text-amber-400">${esc(bi("Редактирование выполняет серверный git-коммит в выбранную ветку.", "Saving runs a server-side git commit to the selected branch."))}</p>` : ""}<div id="git-media-mount" class="mt-4 hidden w-full rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950"></div><div id="git-monaco-mount" class="mt-4 h-[min(72vh,820px)] min-h-[280px] w-full overflow-hidden rounded-xl border border-neutral-200 ring-1 ring-neutral-200/80 dark:border-neutral-800 dark:ring-neutral-800"></div><pre id="git-blob-fallback" class="mt-4 hidden max-h-[72vh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-neutral-200 bg-neutral-50 p-4 font-mono text-[13px] leading-relaxed dark:border-neutral-800 dark:bg-neutral-950"></pre></div>`;
				async function loadBlob(rv) {
					const mount = document.getElementById("git-monaco-mount");
					const fallback = document.getElementById("git-blob-fallback");
					const mediaMount = document.getElementById("git-media-mount");
					disposeGitBlobEditor();
					if (blobMediaKind) {
						fallback?.classList.add("hidden");
						mount?.classList.add("hidden");
						mediaMount?.classList.remove("hidden");
						const rawNow = apiUrl(
							"/git/repos/" +
								encodeURIComponent(slug) +
								"/raw?ref=" +
								encodeURIComponent(rv || "HEAD") +
								"&path=" +
								encodeURIComponent(filePath),
						);
						let inner = `<div class="flex flex-col items-stretch gap-4">${gitBlobMediaMarkup(blobMediaKind, rawNow, filePath)}`;
						if (blobEdit) {
							inner += `<p class="text-center text-xs text-neutral-500 dark:text-neutral-400">${esc(bi("Полная замена файла:", "Full file replacement:"))} <a class="font-semibold underline underline-offset-4" href="${gitUploadHref(slug, rv, parentDir)}">${esc(bi("загрузка", "upload"))}</a></p>`;
						}
						inner += "</div>";
						if (mediaMount) mediaMount.innerHTML = inner;
						return;
					}
					if (mediaMount) mediaMount.innerHTML = "";
					mediaMount?.classList.add("hidden");
					mount?.classList.remove("hidden");
					try {
						const u =
							"/git/repos/" +
							encodeURIComponent(slug) +
							"/blob-content?path=" +
							encodeURIComponent(filePath) +
							"&ref=" +
							encodeURIComponent(rv);
						const data = await api(u);
						if (data.binary) {
							mount?.classList.add("hidden");
							fallback?.classList.remove("hidden");
							fallback.textContent = bi(
								"Бинарный файл — Monaco недоступен, открой Raw или ZIP.",
								"Binary file — Monaco unavailable; open Raw or ZIP.",
							);
							return;
						}
						let t = data.content || "";
						const truncMsg = data.truncated ? "\n\n/* " + bi("обрезано превью — полный файл через Raw", "preview truncated — full file via Raw") + " */\n" : "";
						fallback?.classList.add("hidden");
						mount?.classList.remove("hidden");
						const monaco = await ensureMonaco();
						applyFreeDevMonacoTheme(monaco);
						gitBlobMonacoEditor = monaco.editor.create(mount, {
							value: t + truncMsg,
							language: monacoLangFromPath(filePath),
							readOnly: !blobEdit,
							minimap: { enabled: true },
							automaticLayout: true,
							scrollBeyondLastLine: false,
							fontSize: 13,
							wordWrap: "on",
						});
						if (data.truncated) toast(bi("Файл обрезан в превью", "File truncated in preview"), "bad");
					} catch (e) {
						mount?.classList.add("hidden");
						fallback?.classList.remove("hidden");
						fallback.textContent = e.message;
					}
				}
				await loadBlob(refEff);
				document.getElementById("git-blob-ref")?.addEventListener("change", (ev) => {
					const v = ev.target.value;
					location.hash = gitBlobHref(slug, filePath, v, blobEdit).slice(1);
					route();
				});
				document.getElementById("btn-git-copy-remote")?.addEventListener("click", async () => {
					try {
						await navigator.clipboard.writeText(gitCloneHref(slug));
						toast(bi("URL скопирован", "URL copied"));
					} catch {
						toast(bi("Не удалось скопировать", "Copy failed"), "bad");
					}
				});
				document.getElementById("btn-git-blob-save")?.addEventListener("click", async () => {
					if (!gitBlobMonacoEditor) return;
					const branch = String(document.getElementById("git-blob-ref")?.value || "").trim() || refEff;
					const msg =
						String(document.getElementById("git-blob-msg")?.value || "").trim() ||
						bi("Правка через Monaco", "Monaco edit");
					const body = gitBlobMonacoEditor.getValue();
					try {
						const res = await fetch(apiUrl("/git/repos/" + encodeURIComponent(slug) + "/upload"), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								path: filePath,
								branch,
								message: msg,
								content_base64: utf8ToBase64(body),
							}),
						});
						const txt = await res.text();
						let data = null;
						try {
							data = txt ? JSON.parse(txt) : null;
						} catch {
							data = { error: txt };
						}
						if (!res.ok) {
							toast(String(data?.error || res.statusText), "bad");
							return;
						}
						toast(bi("Закоммичено", "Committed"));
						route();
					} catch (e) {
						toast(e.message, "bad");
					}
				});
			} catch (e) {
				main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
			$root.removeAttribute("aria-busy");
			return;
		}

		if (p2 === "compare") {
			const cmpCrumbs = [
				{ label: bi("Git", "Git"), href: "/git" },
				{ label: slug, href: "/git/" + encodeURIComponent(slug) },
				{ label: bi("Сравнение", "Compare"), href: "/git/" + encodeURIComponent(slug) + "/compare" },
			];
			$root.innerHTML = layout({
				title: bi("Сравнение веток", "Compare branches"),
				subtitle: slug,
				activeNav: "/git",
				breadcrumbs: cmpCrumbs,
				body: skGrid(3),
			});
			themeApply();
			wireNavigationChrome();
			const main = document.getElementById("view");
			try {
				await api("/git/repos/" + encodeURIComponent(slug));
				const branches = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/branches"));
				const tags = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/tags"));
				const mergeOpts = [
					...branches.map((b) => ({ label: b.name, value: b.name })),
					...tags.map((t) => ({ label: `tag · ${t.name}`, value: "refs/tags/" + t.name })),
				];
				let base = hashParams.get("base") || "";
				let head = hashParams.get("head") || "";
				if (!mergeOpts.some((o) => o.value === base)) base = mergeOpts[0]?.value || "";
				if (!mergeOpts.some((o) => o.value === head)) head = mergeOpts[1]?.value || mergeOpts[0]?.value || "";
				const zipRef = pickGitRef(branches);
				function cmpOpts(sel) {
					return mergeOpts.map((o) => `<option value="${esc(o.value)}" ${o.value === sel ? "selected" : ""}>${esc(o.label)}</option>`).join("");
				}
				main.innerHTML =
					gitSubNavHtml(slug, "compare") +
					`<section class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><div class="flex flex-wrap items-end gap-3"><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("База", "Base"))}<select id="git-cmp-base" class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-950">${cmpOpts(base)}</select></label><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Сравнить с", "Compare"))}<select id="git-cmp-head" class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-800 dark:bg-neutral-950">${cmpOpts(head)}</select></label><button type="button" id="git-cmp-run" class="rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Показать diff", "Show diff"))}</button><a href="${gitZipHref(slug, zipRef)}" download class="rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">${esc(bi("ZIP", "ZIP"))}</a><button type="button" id="btn-git-copy-remote" class="rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">${esc(bi("Git URL", "Git URL"))}</button></div><pre id="git-cmp-out" class="mt-4 max-h-[70vh] overflow-auto whitespace-pre rounded-lg border border-neutral-200 bg-neutral-50 p-4 font-mono text-xs dark:border-neutral-800 dark:bg-neutral-950">${esc(bi("Выбери ссылки и нажми «Показать diff».", "Pick refs and click Show diff."))}</pre></section>`;
				async function runCmp() {
					const b = String(document.getElementById("git-cmp-base")?.value || "");
					const h = String(document.getElementById("git-cmp-head")?.value || "");
					const pre = document.getElementById("git-cmp-out");
					pre.textContent = bi("Загрузка…", "Loading…");
					try {
						const d = await api(
							"/git/repos/" +
								encodeURIComponent(slug) +
								"/compare?base=" +
								encodeURIComponent(b) +
								"&head=" +
								encodeURIComponent(h),
						);
						pre.textContent = d.diff || "";
						const nh =
							"#/git/" +
							encodeURIComponent(slug) +
							"/compare?base=" +
							encodeURIComponent(b) +
							"&head=" +
							encodeURIComponent(h);
						history.replaceState(null, "", `${location.pathname}${location.search}${nh}`);
					} catch (e) {
						pre.textContent = e.message;
					}
				}
				document.getElementById("git-cmp-run")?.addEventListener("click", () => runCmp());
				document.getElementById("btn-git-copy-remote")?.addEventListener("click", async () => {
					try {
						await navigator.clipboard.writeText(gitCloneHref(slug));
						toast(bi("URL скопирован", "URL copied"));
					} catch {
						toast(bi("Не удалось скопировать", "Copy failed"), "bad");
					}
				});
				if (base && head && (hashParams.get("base") || hashParams.get("head"))) await runCmp();
			} catch (e) {
				main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
			$root.removeAttribute("aria-busy");
			return;
		}

		if (p2 === "releases") {
			const relCrumbs = [
				{ label: bi("Git", "Git"), href: "/git" },
				{ label: slug, href: "/git/" + encodeURIComponent(slug) },
				{ label: bi("Релизы", "Releases"), href: "/git/" + encodeURIComponent(slug) + "/releases" },
			];
			$root.innerHTML = layout({
				title: bi("Релизы · теги", "Releases · tags"),
				subtitle: slug,
				activeNav: "/git",
				breadcrumbs: relCrumbs,
				body: skGrid(3),
			});
			themeApply();
			wireNavigationChrome();
			const main = document.getElementById("view");
			try {
				await api("/git/repos/" + encodeURIComponent(slug));
				const branches = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/branches"));
				const zipRef = pickGitRef(branches);
				const tags = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/tags"));
				const rows = tags.length
					? `<tbody>${tags
							.map((t) => {
								const tagRef = "refs/tags/" + t.name;
								return `<tr class="border-b border-neutral-100 dark:border-neutral-900"><td class="px-4 py-3 font-medium">${esc(t.name)}</td><td class="px-4 py-3 font-mono text-xs text-neutral-500">${esc(t.commit_hash.slice(0, 12))}</td><td class="px-4 py-3"><a href="${gitZipHref(slug, tagRef)}" download class="mr-3 text-xs font-medium underline-offset-4 hover:underline">ZIP</a><a href="${gitTreeHref(slug, "", tagRef)}" class="text-xs font-medium underline-offset-4 hover:underline">${esc(bi("Файлы", "Files"))}</a></td></tr>`;
							})
							.join("")}</tbody>`
					: "";
				main.innerHTML =
					gitSubNavHtml(slug, "releases") +
					`<div class="mb-4 flex flex-wrap gap-2"><a href="${gitZipHref(slug, zipRef)}" download class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("ZIP текущей ветки", "ZIP default branch"))}</a><button type="button" id="btn-git-copy-remote" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("Git URL", "Git URL"))}</button></div><section class="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"><table class="w-full text-left text-sm"><thead><tr class="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800"><th class="px-4 py-3">${esc(bi("Тег", "Tag"))}</th><th class="px-4 py-3">${esc(bi("Коммит", "Commit"))}</th><th class="px-4 py-3">${esc(bi("Скачать", "Download"))}</th></tr></thead>${rows || `<tbody><tr><td colspan="3" class="px-4 py-6 text-sm text-neutral-500">${esc(bi("Тегов нет — создай tag локально и запушь.", "No tags yet — push tags from your clone."))}</td></tr></tbody>`}</table></section>`;
				document.getElementById("btn-git-copy-remote")?.addEventListener("click", async () => {
					try {
						await navigator.clipboard.writeText(gitCloneHref(slug));
						toast(bi("URL скопирован", "URL copied"));
					} catch {
						toast(bi("Не удалось скопировать", "Copy failed"), "bad");
					}
				});
			} catch (e) {
				main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
			}
			$root.removeAttribute("aria-busy");
			return;
		}

		const onTree = p2 === "tree";
		const treeRefParam = onTree ? hashParams.get("ref") || "" : "";
		const treeRel = onTree ? parts.slice(3).map(decodeURIComponent).join("/") : "";
		const crumbs = [
			{ label: bi("Git", "Git"), href: "/git" },
			{ label: slug, href: "/git/" + encodeURIComponent(slug) },
		];
		if (onTree) {
			let fh = "/git/" + encodeURIComponent(slug) + "/tree";
			if (treeRefParam) fh += "?ref=" + encodeURIComponent(treeRefParam);
			crumbs.push({ label: bi("Файлы", "Files"), href: fh });
		}
		$root.innerHTML = layout({
			title: onTree ? bi("Файлы", "Files") : bi("Репозиторий", "Repository"),
			subtitle: slug + (treeRel ? " · " + treeRel : ""),
			activeNav: "/git",
			breadcrumbs: crumbs,
			body: skGrid(3),
		});
		themeApply();
		wireNavigationChrome();
		const main = document.getElementById("view");
		try {
			const meta = await api("/git/repos/" + encodeURIComponent(slug));
			const branches = arr(await api("/git/repos/" + encodeURIComponent(slug) + "/branches"));
			const ref = onTree ? treeRefParam || pickGitRef(branches) : pickGitRef(branches);
			const branchDel = ref || "main";
			const commits =
				!onTree && ref
					? arr(await api("/git/repos/" + encodeURIComponent(slug) + "/commits?ref=" + encodeURIComponent(ref) + "&limit=40"))
					: [];
			let treeRows = [];
			if (onTree) {
				let url =
					"/git/repos/" +
					encodeURIComponent(slug) +
					"/tree?path=" +
					encodeURIComponent(treeRel);
				if (ref) url += "&ref=" + encodeURIComponent(ref);
				treeRows = arr(await api(url));
			}
			const cloneLn = esc(`git clone ${gitCloneHref(slug)}`);
			const upHref = "#/git/" + encodeURIComponent(slug) + "/tree";
			const crumbTrail =
				treeRel
					.split("/")
					.filter(Boolean)
					.map((seg, i, a) => {
						const cum = a.slice(0, i + 1).join("/");
						return `<a href="${gitTreeHref(slug, cum, treeRefParam)}" class="text-neutral-700 underline-offset-4 hover:underline dark:text-neutral-300">${esc(seg)}</a>`;
					})
					.join(`<span class="mx-1 text-neutral-400 dark:text-neutral-600">/</span>`) || "";
			const branchLine =
				branches.length === 0
					? `<p class="text-sm text-neutral-500">${esc(bi("Нет коммитов / веток — выполни push.", "No commits yet — push from local clone."))}</p>`
					: `<div class="flex flex-wrap gap-2">${branches
							.map((b) => `<span class="rounded-md bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-900">${esc(b.name)} · ${esc(b.hash.slice(0, 7))}</span>`)
							.join("")}</div>`;
			const commitsHtml =
				commits.length === 0
					? `<p class="text-sm text-neutral-500">${esc(bi("Нет записей коммитов.", "No commits."))}</p>`
					: `<ul class="divide-y divide-neutral-200 dark:divide-neutral-800">${commits
							.map(
								(c) =>
									`<li class="py-3 text-sm"><span class="font-mono text-xs text-neutral-400">${esc(c.hash.slice(0, 8))}</span> · ${esc(c.message)} <span class="text-xs text-neutral-400">${esc(fmt(c.timestamp))}</span></li>`,
							)
							.join("")}</ul>`;
			const treeHtml =
				!onTree
					? ""
					: `<section class="mt-4 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"><div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800"><h3 class="text-sm font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">${esc(bi("Каталог", "Directory"))}</h3><p class="mt-2 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"><a href="${gitTreeHref(slug, "", treeRefParam)}" class="underline-offset-4 hover:underline">${esc(slug)}</a>${treeRel ? `<span class="mx-1 text-neutral-500 dark:text-neutral-400">/</span>${crumbTrail}` : ""}</p></div><div class="px-6 pt-4"><div class="mb-4 flex flex-wrap items-center gap-2"><label class="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">${esc(bi("Ветка", "Branch"))}<select id="git-tree-ref" class="rounded-md border border-neutral-200 bg-white px-2 py-1 font-mono dark:border-neutral-800 dark:bg-neutral-950">${branches
							.map((b) => `<option value="${esc(b.name)}" ${b.name === ref ? "selected" : ""}>${esc(b.name)}</option>`)
							.join("")}</select></label><a href="${gitUploadHref(slug, ref || branchDel, treeRel)}" class="${fdGitUploadPrimary()}">${esc(bi("Загрузка файла", "Upload file"))}</a><button type="button" id="btn-git-folder-up" class="${fdBtnPill()}">${esc(bi("Папка", "Folder"))}</button><input type="file" id="git-up-folder" webkitdirectory="" multiple class="sr-only absolute opacity-0" tabindex="-1" aria-hidden="true" /><span class="text-xs text-neutral-600 dark:text-neutral-400">${esc(bi("Коммит через git на сервере (clone во временную папку)", "Commits via server git (temporary clone)"))}</span></div></div><div class="p-6 pt-0">${treeRows.length ? `<table class="w-full text-sm"><tbody>${treeRows
							.map((e) => {
								const raw = apiUrl("/git/repos/" + encodeURIComponent(slug) + "/raw?ref=" + encodeURIComponent(ref || branchDel) + "&path=" + encodeURIComponent(e.path));
								const blobOpen = gitBlobHref(slug, e.path, ref || branchDel, false);
								const blobEdit = gitBlobHref(slug, e.path, ref || branchDel, true);
								if (e.type === "tree") {
									return `<tr class="border-b border-neutral-100 dark:border-neutral-900"><td class="flex flex-wrap items-center justify-between gap-2 py-2"><span><a class="font-medium hover:underline" href="${gitTreeHref(slug, e.path, treeRefParam)}">${esc(e.name)}</a> <span class="text-neutral-400">dir</span></span><button type="button" class="git-rm-file rounded-md border border-red-200 px-2 py-0.5 text-xs text-red-700 dark:border-red-900 dark:text-red-300" data-rec="1" data-path="${encodeURIComponent(e.path)}">${esc(bi("Удалить", "Delete"))}</button></td></tr>`;
								}
								return `<tr class="border-b border-neutral-100 dark:border-neutral-900"><td class="flex flex-wrap items-center justify-between gap-2 py-2"><span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1"><span class="truncate font-medium">${esc(e.name)}</span><span class="flex shrink-0 flex-wrap items-center gap-1"><a href="${blobOpen}" class="${fdBtnPill()}">${esc(bi("Открыть", "Open"))}</a><a href="${blobEdit}" class="${fdBtnPill()}">${esc(bi("Правка", "Edit"))}</a><a class="${fdBtnPill()} no-underline hover:underline" href="${raw}" target="_blank" rel="noopener">${esc(bi("Raw", "Raw"))}</a></span></span><button type="button" class="git-rm-file shrink-0 rounded-full border border-red-400 bg-red-950/30 px-3 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-950/50 dark:border-red-700 dark:text-red-400" data-rec="0" data-path="${encodeURIComponent(e.path)}">${esc(bi("Удалить", "Delete"))}</button></td></tr>`;
							})
							.join("")}</tbody></table>` : `<p class="text-sm text-neutral-500">${esc(bi("Пустой каталог.", "Empty directory."))}</p>`}</div></section>`;
			const overviewHref = "#/git/" + encodeURIComponent(slug);
			const hdrBtn = fdBtnPill();
			const compactHeader = `<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><div class="flex flex-wrap items-start justify-between gap-4"><div><h2 class="text-xl font-semibold tracking-tight">${esc(meta.name)}</h2><p class="mt-1 text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200"><a href="${overviewHref}" class="underline-offset-4 hover:underline">${esc(slug)}</a>${treeRel ? `<span class="mx-1 text-neutral-500 dark:text-neutral-400">/</span>${crumbTrail}` : ""}</p></div><div class="flex flex-wrap gap-2"><a href="${overviewHref}" class="${hdrBtn}">${esc(bi("Обзор", "Overview"))}</a><a href="${gitZipHref(slug, ref)}" download class="${hdrBtn}">${esc(bi("ZIP", "ZIP"))}</a><button type="button" id="btn-git-copy-remote-h" class="${hdrBtn}">${esc(bi("Git URL", "Git URL"))}</button><a href="${gitUploadHref(slug, ref || branchDel, treeRel)}" class="${hdrBtn}">${esc(bi("Загрузка", "Upload"))}</a><a href="#/git/${encodeURIComponent(slug)}/settings" class="${hdrBtn}">${esc(bi("Настройки", "Settings"))}</a><a href="#/git" class="${hdrBtn}">← Git</a></div></div></div>`;
			const fullHeader = `<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><div class="flex flex-wrap items-start justify-between gap-4"><div><h2 class="text-xl font-semibold tracking-tight">${esc(meta.name)}</h2><p class="mt-1 font-mono text-xs text-neutral-700 dark:text-neutral-300">${esc(meta.clone_path)} · ${cloneLn}</p></div><div class="flex flex-wrap gap-2"><a href="${esc(upHref)}" class="${hdrBtn}">${esc(bi("Файлы", "Files"))}</a><a href="${gitZipHref(slug, ref)}" download class="${hdrBtn}">${esc(bi("ZIP", "ZIP"))}</a><button type="button" id="btn-git-copy-remote-h" class="${hdrBtn}">${esc(bi("Git URL", "Git URL"))}</button><a href="${gitUploadHref(slug, ref || branchDel, "")}" class="${hdrBtn}">${esc(bi("Загрузка", "Upload"))}</a><a href="#/git/${encodeURIComponent(slug)}/settings" class="${hdrBtn}">${esc(bi("Настройки", "Settings"))}</a><a href="#/git" class="${hdrBtn}">← Git</a></div></div></div>`;
			const branchesSection = !onTree
				? `<section class="mt-8 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><h3 class="text-sm font-semibold uppercase text-neutral-500">${esc(bi("Ветки", "Branches"))}</h3><div class="mt-4">${branchLine}</div></section>`
				: "";
			const commitsSection = !onTree
				? `<section class="mt-8 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><h3 class="text-sm font-semibold uppercase text-neutral-500">${esc(bi("Коммиты", "Commits"))}</h3><div class="mt-4">${commitsHtml}</div></section>`
				: "";
			main.innerHTML =
				gitSubNavHtml(slug, onTree ? "tree" : "overview") +
				(onTree ? compactHeader : fullHeader) +
				branchesSection +
				commitsSection +
				treeHtml;
			document.getElementById("btn-git-copy-remote-h")?.addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(gitCloneHref(slug));
					toast(bi("URL скопирован", "URL copied"));
				} catch {
					toast(bi("Не удалось скопировать", "Copy failed"), "bad");
				}
			});
			document.getElementById("btn-git-folder-up")?.addEventListener("click", () => document.getElementById("git-up-folder")?.click());
			document.getElementById("git-up-folder")?.addEventListener("change", async (ev) => {
				const inp = ev.target;
				const files = Array.from(inp.files || []);
				inp.value = "";
				if (!files.length) return;
				const max = 400;
				if (files.length > max) {
					toast(bi(`Слишком много файлов (>${max})`, `Too many files (>${max})`), "bad");
					return;
				}
				if (
					!confirm(
						bi(
							`Загрузить ${files.length} файлов (отдельный коммит на каждый)?`,
							`Upload ${files.length} files (one commit per file)?`,
						),
					)
				)
					return;
				const branch = String(document.getElementById("git-tree-ref")?.value || "").trim() || branchDel;
				const basePrefix = treeRel ? treeRel.replace(/\/+$/, "") + "/" : "";
				const baseMsg = bi("Импорт папки", "Folder import");
				let done = 0;
				for (const f of files) {
					const rel = String(f.webkitRelativePath || f.name).replace(/\\/g, "/");
					if (!rel || rel.endsWith("/")) continue;
					const path = basePrefix + rel;
					try {
						const buf = await f.arrayBuffer();
						const res = await fetch(apiUrl("/git/repos/" + encodeURIComponent(slug) + "/upload"), {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								path,
								branch,
								message: `${baseMsg}: ${rel}`,
								content_base64: arrayBufferToBase64(buf),
							}),
						});
						const txt = await res.text();
						let data = null;
						try {
							data = txt ? JSON.parse(txt) : null;
						} catch {
							data = { error: txt };
						}
						if (!res.ok) {
							toast(`${rel}: ${String(data?.error || res.statusText)}`, "bad");
							return;
						}
						done++;
					} catch (err) {
						toast(`${rel}: ${err.message}`, "bad");
						return;
					}
				}
				toast(bi(`Готово: ${done} файлов`, `Done: ${done} files`));
				route();
			});
			document.getElementById("git-tree-ref")?.addEventListener("change", (ev) => {
				const v = String(ev.target?.value || "").trim();
				const tail = treeRel
					? "/" +
						treeRel
							.split("/")
							.filter(Boolean)
							.map((seg) => encodeURIComponent(seg))
							.join("/")
					: "";
				location.hash = `#/git/${encodeURIComponent(slug)}/tree${tail}?ref=${encodeURIComponent(v)}`;
				route();
			});
			main.querySelectorAll(".git-rm-file").forEach((btn) => {
				btn.addEventListener("click", async () => {
					const p = decodeURIComponent(btn.getAttribute("data-path") || "");
					const rec = btn.getAttribute("data-rec") === "1";
					if (
						!confirm(
							rec
								? bi("Удалить каталог и всё внутри?", "Delete this folder and its contents?")
								: bi("Удалить файл из репозитория?", "Remove this file from the repository?"),
						)
					)
						return;
					try {
						const res = await fetch("/api/git/repos/" + encodeURIComponent(slug) + "/delete-path", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								path: p,
								branch: branchDel,
								message: bi("Удаление", "Remove") + " " + p,
								recursive: rec,
							}),
						});
						const txt = await res.text();
						let data = null;
						try {
							data = txt ? JSON.parse(txt) : null;
						} catch {
							data = { error: txt };
						}
						if (!res.ok) {
							toast(String(data?.error || res.statusText), "bad");
							return;
						}
						toast(bi("Коммит выполнен", "Committed"));
						route();
					} catch (e) {
						toast(e.message, "bad");
					}
				});
			});
		} catch (e) {
			main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "projects" && p1 && p2 === "issues" && !p3) {
		const slug = decodeURIComponent(p1);
		$root.innerHTML = layout({
			title: bi("Задачи", "Issues"),
			subtitle: slug,
			activeNav: "/projects",
			breadcrumbs: [
				{ label: bi("Проекты", "Projects"), href: "/projects" },
				{ label: slug, href: "/projects/" + encodeURIComponent(slug) },
				{ label: bi("Задачи", "Issues"), href: "/projects/" + encodeURIComponent(slug) + "/issues" },
			],
			body: skGrid(3),
		});
		themeApply();
		wireNavigationChrome();
		const main = document.getElementById("view");
		try {
			const project = await api("/projects/" + encodeURIComponent(slug));
			if (!project?.id) throw new Error(bi("Проект не найден", "Project not found"));
			const issues = arr(
				await api(
					"/projects/" +
						encodeURIComponent(project.id) +
						"/issues?limit=" +
						encodeURIComponent(String(LIM.issues)),
				),
			);
			main.innerHTML = `<div class="mb-6"><a href="#/projects/${encodeURIComponent(slug)}" class="text-sm underline-offset-4 hover:underline">← ${esc(bi("Рабочая область", "Workspace"))}</a></div>
<section class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><h3 class="text-sm font-semibold uppercase text-neutral-500">${esc(bi("Новая задача", "New issue"))}</h3>
<form id="iss-form" class="mt-4 grid gap-4 sm:grid-cols-2"><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500 sm:col-span-2">${esc(bi("Заголовок", "Title"))}<input name="title" required class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500 sm:col-span-2">${esc(bi("Описание", "Body"))}<textarea name="body" rows="3" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></textarea></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Приоритет", "Priority"))}<input name="priority" type="number" value="0" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-950 sm:self-end">${esc(bi("Создать", "Create"))}</button></form></section>
<section class="mt-8 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"><h3 class="border-b border-neutral-200 px-6 py-4 text-sm font-semibold uppercase text-neutral-500 dark:border-neutral-800">${esc(bi("Реестр", "Registry"))} (${issues.length})</h3>
<div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead><tr class="border-b border-neutral-200 text-xs uppercase text-neutral-500 dark:border-neutral-800"><th class="px-6 py-3">${esc(bi("Статус", "Status"))}</th><th class="px-6 py-3">${esc(bi("Заголовок", "Title"))}</th><th class="px-6 py-3">${esc(bi("Приор.", "Pri."))}</th><th class="px-6 py-3">${esc(bi("Обновлено", "Updated"))}</th></tr></thead><tbody>${issues
				.map(
					(i) =>
						`<tr class="border-b border-neutral-100 dark:border-neutral-900"><td class="px-6 py-3"><span class="${issueBadgeCls(i.status)}">${esc(i.status)}</span></td><td class="px-6 py-3"><a class="font-medium hover:underline" href="#/projects/${encodeURIComponent(slug)}/issues/${encodeURIComponent(i.id)}">${esc(truncate(i.title, 72))}</a></td><td class="px-6 py-3 font-mono text-xs">${esc(String(i.priority))}</td><td class="px-6 py-3 text-xs text-neutral-500">${fmt(i.updated_at)}</td></tr>`,
				)
				.join("")}</tbody></table></div>${issues.length ? "" : `<p class="p-6 text-sm text-neutral-500">${esc(bi("Записей нет", "No records"))}</p>`}</section>`;
			document.getElementById("iss-form")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				try {
					await api("/projects/" + encodeURIComponent(project.id) + "/issues", {
						method: "POST",
						body: JSON.stringify({
							title: fd.get("title"),
							body: fd.get("body"),
							priority: parseInt10(fd.get("priority"), 0),
						}),
					});
					toast(bi("Задача сохранена", "Issue saved"));
					location.hash = "#/projects/" + encodeURIComponent(slug) + "/issues";
					route();
				} catch (err) {
					toast(err.message, "bad");
				}
			});
		} catch (e) {
			main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "projects" && p1 && p2 === "issues" && p3) {
		const slug = decodeURIComponent(p1);
		const iid = decodeURIComponent(p3);
		$root.innerHTML = layout({
			title: bi("Задача", "Issue"),
			subtitle: truncate(iid, 14),
			activeNav: "/projects",
			breadcrumbs: [
				{ label: bi("Проекты", "Projects"), href: "/projects" },
				{ label: slug, href: "/projects/" + encodeURIComponent(slug) },
				{ label: bi("Задачи", "Issues"), href: "/projects/" + encodeURIComponent(slug) + "/issues" },
			],
			body: skGrid(2),
		});
		themeApply();
		wireNavigationChrome();
		const main = document.getElementById("view");
		try {
			const issue = await api("/issues/" + encodeURIComponent(iid));
			if (!issue?.id) throw new Error(bi("Задача не найдена", "Issue not found"));
			const os = issue.status === "open" ? "selected" : "";
			const cs = issue.status === "closed" ? "selected" : "";
			main.innerHTML = `<a href="#/projects/${encodeURIComponent(slug)}/issues" class="mb-6 inline-block text-sm underline-offset-4 hover:underline">← ${esc(bi("К списку задач", "Back to issues"))}</a>
<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><div class="flex flex-wrap items-center gap-2"><span class="${issueBadgeCls(issue.status)}">${esc(issue.status)}</span><span class="font-mono text-xs text-neutral-500">${esc(issue.id)}</span></div>
<form id="det-form" class="mt-6 grid gap-4"><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Заголовок", "Title"))}<input name="title" value="${esc(issue.title)}" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Описание", "Body"))}<textarea name="body" rows="8" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950">${esc(issue.body)}</textarea></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Статус", "Status"))}<select name="status" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"><option ${os}>open</option><option ${cs}>closed</option></select></label>
<label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Приоритет", "Priority"))}<input name="priority" type="number" value="${esc(String(issue.priority))}" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<div class="flex flex-wrap gap-2"><button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-950">${esc(bi("Сохранить", "Save"))}</button><button type="button" id="iss-del" class="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:text-red-400">${esc(bi("Удалить", "Delete"))}</button></div></form></div>`;
			document.getElementById("det-form")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				try {
					await api("/issues/" + encodeURIComponent(iid), {
						method: "PATCH",
						body: JSON.stringify({
							title: fd.get("title"),
							body: fd.get("body"),
							status: fd.get("status"),
							priority: parseInt10(fd.get("priority"), 0),
						}),
					});
					toast(bi("Изменения сохранены", "Changes saved"));
					route();
				} catch (err) {
					toast(err.message, "bad");
				}
			});
			document.getElementById("iss-del")?.addEventListener("click", async () => {
				if (!confirm(bi("Удалить задачу?", "Delete this issue?"))) return;
				try {
					await api("/issues/" + encodeURIComponent(iid), { method: "DELETE" });
					toast(bi("Задача удалена", "Issue deleted"));
					location.hash = "#/projects/" + encodeURIComponent(slug) + "/issues";
					route();
				} catch (err) {
					toast(err.message, "bad");
				}
			});
		} catch (e) {
			main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "projects" && p1 === "new") {
		$root.innerHTML = layout({
			title: bi("Новый проект", "New project"),
			subtitle: "",
			activeNav: "/projects",
			breadcrumbs: [{ label: bi("Проекты", "Projects"), href: "/projects" }],
			body: `<div class="max-w-lg rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"><form id="form-project-new" class="flex flex-col gap-4"><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Наименование", "Name"))}<input name="name" required autocomplete="off" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Слаг", "Slug"))}<input name="slug" autocomplete="off" pattern="[a-z0-9][a-z0-9-]{0,62}" class="rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950"></label><label class="flex flex-col gap-1 text-xs font-medium text-neutral-500">${esc(bi("Описание", "Description"))}<textarea name="description" rows="3" class="rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></textarea></label><div class="flex flex-wrap gap-2"><a href="#/projects" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Отмена", "Cancel"))}</a><button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Создать", "Create"))}</button></div></form></div>`,
		});
		themeApply();
		wireNavigationChrome();
		document.getElementById("form-project-new")?.addEventListener("submit", async (ev) => {
			ev.preventDefault();
			const fd = new FormData(ev.target);
			const name = String(fd.get("name") || "").trim();
			let slug = String(fd.get("slug") || "").trim().toLowerCase();
			const description = String(fd.get("description") || "");
			if (!slug && name)
				slug = name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "")
					.slice(0, 48);
			if (!slug || !name) {
				toast(bi("Укажите наименование и слаг", "Name and slug are required"), "bad");
				return;
			}
			try {
				await api("/projects", {
					method: "POST",
					body: JSON.stringify({ name, slug, description }),
				});
				toast(bi("Операция выполнена", "Operation completed"));
				location.hash = "#/projects/" + encodeURIComponent(slug) + "?tab=overview";
				route();
			} catch (err) {
				toast(err.message, "bad");
			}
		});
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "projects" && p1) {
		const key = decodeURIComponent(p1);
		$root.innerHTML = layout({
			title: bi("Рабочая область", "Workspace"),
			subtitle: key,
			activeNav: "/projects",
			breadcrumbs: [
				{ label: bi("Проекты", "Projects"), href: "/projects" },
				{ label: key, href: "/projects/" + encodeURIComponent(key) },
			],
			body: skGrid(4),
		});
		themeApply();
		wireNavigationChrome();
		const main = document.getElementById("view");
		try {
			const project = await api("/projects/" + encodeURIComponent(key));
			if (!project || typeof project !== "object") throw new Error(bi("Некорректные данные проекта", "Invalid project payload"));
			const pipes = arr(
				await api("/projects/" + encodeURIComponent(project.id) + "/pipelines"),
			);
			main.innerHTML = projectWorkspaceMarkup(project, pipes, hashParams.get("tab"), DEF_YAML);
			document.getElementById("proj-desc-form")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				const description = String(fd.get("description") ?? "");
				try {
					await api("/projects/" + encodeURIComponent(project.id), {
						method: "PATCH",
						body: JSON.stringify({ description }),
					});
					toast(bi("Описание сохранено", "Description saved"));
					location.hash = "#/projects/" + encodeURIComponent(project.slug) + "?tab=settings";
					route();
				} catch (e) {
					toast(e.message, "bad");
				}
			});
			document.getElementById("copy-slug")?.addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(project.slug);
					toast(bi("Скопировано в буфер", "Copied to clipboard"));
				} catch {
					toast(bi("Буфер обмена недоступен", "Clipboard unavailable"), "bad");
				}
			});
			document.getElementById("pipe-form")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				const name = String(fd.get("name") || "").trim();
				const yaml = String(fd.get("yaml") || "");
				try {
					await api("/projects/" + encodeURIComponent(project.id) + "/pipelines", {
						method: "POST",
						body: JSON.stringify({ name, yaml }),
					});
					toast(bi("Пайплайн создан", "Pipeline created"));
					location.hash = "#/projects/" + encodeURIComponent(project.slug) + "?tab=pipelines";
					route();
				} catch (err) {
					toast(err.message, "bad");
				}
			});
			const arc = Number(project.archived);
			document.getElementById("btn-archive")?.addEventListener("click", async () => {
				try {
					await api("/projects/" + encodeURIComponent(project.id), {
						method: "PATCH",
						body: JSON.stringify({ archived: !arc }),
					});
					toast(!arc ? bi("Проект отправлен в архив", "Project archived") : bi("Проект восстановлен из архива", "Project unarchived"));
					route();
				} catch (e) {
					toast(e.message, "bad");
				}
			});
			main.querySelectorAll("[data-pipe-del]").forEach((btn) => {
				btn.addEventListener("click", async () => {
					const id = btn.getAttribute("data-pipe-del");
					if (!id || !confirm(bi("Удалить пайплайн и связанные сборки?", "Delete pipeline and related builds?"))) return;
					try {
						await api("/pipelines/" + encodeURIComponent(id), { method: "DELETE" });
						toast(bi("Объект удалён", "Record deleted"));
						route();
					} catch (e) {
						toast(e.message, "bad");
					}
				});
			});
		} catch (e) {
			main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "pipelines" && p1 && !p2) {
		const pid = decodeURIComponent(p1);
		$root.innerHTML = layout({
			title: bi("Пайплайн", "Pipeline"),
			subtitle: pid.slice(0, 12) + "…",
			activeNav: "/projects",
			breadcrumbs: [{ label: bi("Проекты", "Projects"), href: "/projects" }],
			body: skGrid(2),
		});
		themeApply();
		wireNavigationChrome();
		const main = document.getElementById("view");
		try {
			const pl = await api("/pipelines/" + encodeURIComponent(pid));
			if (!pl || typeof pl !== "object") throw new Error(bi("Объект не найден", "Not found"));
			main.innerHTML = `
<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold">${esc(pl.name)}</h2>
			<p class="mt-1 font-mono text-xs text-neutral-500">${esc(pl.id)}</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<button type="button" id="btn-del-pl" class="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:text-red-400">${esc(bi("Удалить пайплайн", "Delete pipeline"))}</button>
			<button type="button" id="btn-copy-yaml" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("Копировать YAML", "Copy YAML"))}</button>
			<a href="#/pipelines/${encodeURIComponent(pid)}/builds" class="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Сборки", "Builds"))}</a>
			<a href="#/projects/${encodeURIComponent(pl.project_slug || "")}" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("Проект", "Project"))}</a>
		</div>
	</div>
</div>
<section class="mt-8 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
	<div class="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h3 class="text-sm font-semibold">${esc(bi("Спецификация", "Specification"))}</h3>
		<span class="text-xs text-neutral-500">${fmt(pl.created_at)}</span>
	</div>
	<pre class="max-h-[min(560px,70vh)] overflow-auto p-6 font-mono text-sm leading-relaxed">${esc(pl.yaml || "")}</pre>
</section>`;
			document.getElementById("btn-copy-yaml")?.addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(pl.yaml || "");
					toast(bi("Скопировано в буфер", "Copied to clipboard"));
				} catch {
					toast(bi("Буфер обмена недоступен", "Clipboard unavailable"), "bad");
				}
			});
			document.getElementById("btn-del-pl")?.addEventListener("click", async () => {
				if (!confirm(bi("Удалить данный пайплайн?", "Delete this pipeline?"))) return;
				try {
					await api("/pipelines/" + encodeURIComponent(pid), { method: "DELETE" });
					toast(bi("Объект удалён", "Record deleted"));
					location.hash = "#/projects/" + encodeURIComponent(pl.project_slug || "");
					route();
				} catch (e) {
					toast(e.message, "bad");
				}
			});
		} catch (e) {
			main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "pipelines" && p1 && p2 === "builds") {
		const pid = decodeURIComponent(p1);
		$root.innerHTML = layout({
			title: bi("Сборки", "Builds"),
			subtitle: pid.slice(0, 12) + "…",
			activeNav: "/projects",
			breadcrumbs: [
				{ label: bi("Проекты", "Projects"), href: "/projects" },
				{ label: bi("Пайплайн", "Pipeline"), href: "/pipelines/" + encodeURIComponent(pid) },
				{ label: bi("Сборки", "Builds"), href: "/pipelines/" + encodeURIComponent(pid) + "/builds" },
			],
			body: skGrid(4),
		});
		themeApply();
		wireNavigationChrome();
		const main = document.getElementById("view");
		try {
			const [detail, buildsRaw] = await Promise.all([
				api("/pipelines/" + encodeURIComponent(pid)),
				api(
					"/pipelines/" +
						encodeURIComponent(pid) +
						"/builds?limit=" +
						encodeURIComponent(String(LIM.builds)),
				),
			]);
			const detailOk = detail && typeof detail === "object";
			const builds = arr(buildsRaw);
			if (!detailOk) throw new Error(bi("Пайплайн не найден", "Pipeline not found"));
			main.innerHTML = `
<div class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold">${esc(detail.name)}</h2>
			<p class="mt-1 font-mono text-xs text-neutral-500">${esc(detail.id)} · ${esc(detail.project_slug)}</p>
		</div>
		<div class="flex gap-2">
			<a href="#/pipelines/${encodeURIComponent(pid)}" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">YAML</a>
			<a href="#/projects/${encodeURIComponent(detail.project_slug || "")}" class="rounded-md border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-800">${esc(bi("Проект", "Project"))}</a>
		</div>
	</div>
</div>
<form id="build-form" class="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
	<label class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
		${esc(bi("Статус", "Status"))}
		<select name="status" class="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950">
			<option>queued</option><option>running</option><option>passed</option><option>failed</option>
		</select>
	</label>
	<button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("Новая тестовая сборка", "New stub build"))}</button>
</form>
<div class="mt-6 space-y-4">${builds.length ? builds.map(renderBuildNode).join("") : `<p class="text-sm text-neutral-500">${esc(bi("Сборки отсутствуют", "No builds"))}</p>`}</div>`;
			document.getElementById("build-form")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				const status = String(fd.get("status") || "queued");
				try {
					await api("/pipelines/" + encodeURIComponent(pid) + "/builds", {
						method: "POST",
						body: JSON.stringify({
							status,
							log_tail: "[stub] no runner\n",
						}),
					});
					toast(bi("Сборка зарегистрирована", "Build recorded"));
					location.hash = "#/pipelines/" + encodeURIComponent(pid) + "/builds";
					route();
				} catch (err) {
					toast(err.message, "bad");
				}
			});
		} catch (e) {
			main.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	if (p0 === "admin") {
		if (FD_SESSION?.role !== "admin") {
			toast(bi("Только админ", "Admin only"), "bad");
			location.hash = "#/";
			$root.removeAttribute("aria-busy");
			return;
		}
		$root.innerHTML = layout({
			title: bi("Админка", "Admin"),
			subtitle: bi("Whitelabel и учётки", "Whitelabel & accounts"),
			activeNav: "/admin",
			body: `<div id="admin-root" class="space-y-8">${skGrid(2)}</div>`,
		});
		themeApply();
		wireNavigationChrome();
		const holder = document.getElementById("admin-root");
		try {
			const [st, users] = await Promise.all([api("/admin/settings"), api("/admin/users")]);
			const uls = arr(users);
			holder.innerHTML = `
<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
<h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">${esc(bi("Инстанс", "Instance"))}</h2>
<form id="adm-settings" class="mt-4 grid gap-4 md:grid-cols-2">
<label class="block text-xs font-medium md:col-span-2">${esc(bi("Имя продукта", "Product name"))}<input name="product_name" value="${esc(st.product_name || "")}" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium md:col-span-2">${esc(bi("Подзаголовок / слоган", "Tagline"))}<input name="product_tagline" value="${esc(st.product_tagline || "")}" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium">${esc(bi("Лого URL", "Logo URL"))}<input name="logo_url" value="${esc(st.logo_url || "")}" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="block text-xs font-medium">${esc(bi("Акцент", "Accent"))}<div class="mt-1 flex items-center gap-3"><input type="color" id="adm-accent-well" value="${esc(hexForColorInput(st.accent_hex))}" class="fd-color-well h-9 w-11 shrink-0 cursor-pointer rounded-[10px] border border-neutral-200 bg-transparent dark:border-neutral-600" /><input name="accent_hex" value="${esc(st.accent_hex || "")}" autocomplete="off" placeholder="#171717" class="min-w-0 flex-1 rounded-md border border-neutral-200 px-3 py-2 font-mono text-sm dark:border-neutral-800 dark:bg-neutral-950"></div></label>
<label class="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="registration_open" ${st.registration_open ? "checked" : ""}> ${esc(bi("Открытая регистрация", "Open registration"))}</label>
<label class="block text-xs font-medium md:col-span-2">${esc(bi("Новый код доступа (оставь пустым — не менять)", "New access code (empty = keep)"))}<input name="access_code" type="password" autocomplete="new-password" class="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" name="clear_access_code"> ${esc(bi("Сбросить код доступа", "Clear access code"))}</label>
<button type="submit" class="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white md:col-span-2 dark:bg-white dark:text-neutral-950">${esc(bi("Сохранить настройки", "Save settings"))}</button>
</form>
<p class="mt-3 text-xs text-neutral-500">${esc(st.access_code_active ? bi("Код доступа активен", "Access code active") : bi("Код доступа выключен", "No access code"))}</p>
</section>
<section class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
<h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">${esc(bi("Пользователи", "Users"))}</h2>
<form id="adm-new-user" class="mt-4 flex flex-wrap items-end gap-3 border-b border-neutral-100 pb-4 dark:border-neutral-900">
<label class="text-xs font-medium">${esc(bi("Логин", "Username"))}<input name="username" required class="mt-1 block rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="text-xs font-medium">${esc(bi("Пароль", "Password"))}<input name="password" type="password" required class="mt-1 block rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"></label>
<label class="text-xs font-medium">${esc(bi("Роль", "Role"))}<select name="role" class="mt-1 block rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-950"><option value="user">user</option><option value="admin">admin</option></select></label>
<button type="submit" class="rounded-md border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">${esc(bi("Добавить", "Add"))}</button>
</form>
<ul class="mt-4 divide-y divide-neutral-100 dark:divide-neutral-900">${uls.map((u) => `<li class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span class="font-mono text-xs">${esc(u.username)}</span><span class="text-xs text-neutral-500">${esc(u.role)}</span>${u.username !== FD_SESSION?.username ? `<button type="button" class="adm-del rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:text-red-300" data-id="${esc(u.id)}">${esc(bi("Удалить", "Delete"))}</button>` : `<span class="text-xs text-neutral-400">${esc(bi("ты", "you"))}</span>`}</li>`).join("")}</ul>
</section>`;
			wireAccentColorWell(holder);
			document.getElementById("adm-settings")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				try {
					await api("/admin/settings", {
						method: "PATCH",
						body: JSON.stringify({
							product_name: String(fd.get("product_name") || ""),
							product_tagline: String(fd.get("product_tagline") || ""),
							logo_url: String(fd.get("logo_url") || ""),
							accent_hex: String(fd.get("accent_hex") || ""),
							registration_open: fd.get("registration_open") === "on",
							access_code: String(fd.get("access_code") || "") || undefined,
							clear_access_code: fd.get("clear_access_code") === "on",
						}),
					});
					await refreshMeta();
					toast(bi("Настройки сохранены", "Settings saved"));
					route();
				} catch (e) {
					toast(e.message, "bad");
				}
			});
			document.getElementById("adm-new-user")?.addEventListener("submit", async (ev) => {
				ev.preventDefault();
				const fd = new FormData(ev.target);
				try {
					await api("/admin/users", {
						method: "POST",
						body: JSON.stringify({
							username: String(fd.get("username") || ""),
							password: String(fd.get("password") || ""),
							role: String(fd.get("role") || "user"),
						}),
					});
					toast(bi("Пользователь создан", "User created"));
					route();
				} catch (e) {
					toast(e.message, "bad");
				}
			});
			holder.querySelectorAll(".adm-del").forEach((btn) => {
				btn.addEventListener("click", async () => {
					const id = btn.getAttribute("data-id");
					if (!id || !confirm(bi("Удалить пользователя?", "Delete user?"))) return;
					try {
						await api("/admin/users/" + encodeURIComponent(id), { method: "DELETE" });
						toast(bi("Удалено", "Deleted"));
						route();
					} catch (e) {
						toast(e.message, "bad");
					}
				});
			});
		} catch (e) {
			holder.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p>`;
		}
		$root.removeAttribute("aria-busy");
		return;
	}

	$root.innerHTML = layout({
		title: bi("Страница не найдена", "Page not found"),
		subtitle: "404",
		activeNav: "/",
		body: `<div class="rounded-lg border border-neutral-200 bg-white p-8 dark:border-neutral-800 dark:bg-neutral-950"><p class="text-neutral-600 dark:text-neutral-400">${esc("#/" + parts.join("/"))}</p><a href="#/" class="mt-4 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-950">${esc(bi("На главную", "Home"))}</a></div>`,
	});
	themeApply();
	wireNavigationChrome();
	$root.removeAttribute("aria-busy");
}

themeApply();
window.addEventListener("hashchange", route);
window.addEventListener("fd-auth-lost", async () => {
	FD_SESSION = null;
	try {
		await refreshMeta();
	} catch {}
	renderLoginGate();
});
gateBoot();
