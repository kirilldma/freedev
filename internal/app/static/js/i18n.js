const STORAGE_KEY = "freedev-lang";

export function getLang() {
	const v = localStorage.getItem(STORAGE_KEY);
	return v === "en" ? "en" : "ru";
}

export function setLang(code) {
	const lang = code === "en" ? "en" : "ru";
	localStorage.setItem(STORAGE_KEY, lang);
	document.documentElement.lang = lang === "ru" ? "ru" : "en";
}

export function bi(ru, en) {
	return getLang() === "ru" ? ru : en;
}

export const LANG_LIST = [
	{ code: "ru", label: "Русский", flagCode: "ru" },
	{ code: "en", label: "English", flagCode: "us" },
];

export function flagSrc(flagCode, w = 80) {
	return `https://flagcdn.com/w${w}/${flagCode}.png`;
}

export function langOverlay(show, message) {
	let el = document.getElementById("fd-lang-overlay");
	if (!el && show) {
		el = document.createElement("div");
		el.id = "fd-lang-overlay";
		el.className =
			"fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm";
		el.innerHTML = `<div class="rounded-[22px] bg-white px-10 py-9 shadow-2xl ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10"><div class="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-neutral-200 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white"></div><p class="fd-lang-overlay-msg mt-5 max-w-[14rem] text-center text-[13px] font-medium leading-snug text-neutral-600 dark:text-neutral-300"></p></div>`;
		document.body.appendChild(el);
	}
	if (!el) return;
	const msgEl = el.querySelector(".fd-lang-overlay-msg");
	if (msgEl) msgEl.textContent = message || "";
	el.style.display = show ? "flex" : "none";
}

export async function withLangOverlay(message, fn) {
	langOverlay(true, message);
	try {
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		await fn();
	} finally {
		langOverlay(false, "");
	}
}

export function langDropdownMarkup() {
	const cur = getLang();
	const items = LANG_LIST.map(
		(L) =>
			`<button type="button" role="menuitem" data-lang="${L.code}" class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${L.code === cur ? "bg-neutral-50 dark:bg-neutral-900/80" : ""}">
				<img src="${flagSrc(L.flagCode, 80)}" alt="" width="28" height="20" class="h-5 w-[28px] shrink-0 rounded-[4px] object-cover shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.12]" loading="lazy" decoding="async" />
				<span class="flex-1">${L.label}</span>
				${L.code === cur ? `<span class="text-neutral-400">✓</span>` : ""}
			</button>`,
	).join("");
	const active = LANG_LIST.find((x) => x.code === cur) || LANG_LIST[0];
	return `<div class="relative" id="fd-lang-wrap">
	<button type="button" id="btn-lang" aria-haspopup="menu" aria-expanded="false" class="flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold tracking-tight shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-950 dark:hover:bg-neutral-800">
		<img id="btn-lang-flag" src="${flagSrc(active.flagCode, 80)}" alt="" width="28" height="20" class="h-4 w-[22px] rounded-[3px] object-cover shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.12]" loading="lazy" decoding="async" />
		<span id="btn-lang-label">${active.label}</span>
		<svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="text-neutral-500"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
	</button>
	<div id="panel-lang" role="menu" hidden class="absolute right-0 top-[calc(100%+6px)] z-[120] min-w-[216px] overflow-hidden rounded-xl border border-neutral-200/90 bg-white py-1 shadow-xl ring-1 ring-black/[0.04] dark:border-neutral-700 dark:bg-neutral-950 dark:ring-white/[0.06]">${items}</div>
</div>`;
}

export function syncLangButtonUI() {
	const cur = getLang();
	const active = LANG_LIST.find((x) => x.code === cur) || LANG_LIST[0];
	const img = document.getElementById("btn-lang-flag");
	const lab = document.getElementById("btn-lang-label");
	if (img) {
		img.src = flagSrc(active.flagCode, 80);
		img.alt = "";
	}
	if (lab) lab.textContent = active.label;
	document.querySelectorAll("#panel-lang [data-lang]").forEach((btn) => {
		const on = btn.getAttribute("data-lang") === cur;
		btn.classList.toggle("bg-neutral-50", on);
		btn.classList.toggle("dark:bg-neutral-900/80", on);
	});
}
