export async function api(path, opts = {}) {
	const res = await fetch("/api" + path, {
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
		...opts,
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { error: text };
	}
	if (!res.ok) {
		if (res.status === 401 && typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("fd-auth-lost"));
		}
		const err = new Error((data && data.error) || res.statusText);
		err.status = res.status;
		err.body = data;
		throw err;
	}
	return data;
}

export function arr(v) {
	return Array.isArray(v) ? v : [];
}

export function overviewSafe(v) {
	if (!v || typeof v !== "object") {
		return {
			projects: 0,
			pipelines: 0,
			builds: 0,
			issues_total: 0,
			git_repos: 0,
			builds_running: 0,
			builds_queued: 0,
			builds_passed: 0,
			builds_failed: 0,
		};
	}
	return {
		projects: Number(v.projects) || 0,
		pipelines: Number(v.pipelines) || 0,
		builds: Number(v.builds) || 0,
		issues_total: Number(v.issues_total) || 0,
		git_repos: Number(v.git_repos) || 0,
		builds_running: Number(v.builds_running) || 0,
		builds_queued: Number(v.builds_queued) || 0,
		builds_passed: Number(v.builds_passed) || 0,
		builds_failed: Number(v.builds_failed) || 0,
	};
}

export function toast(msg, tone = "neutral") {
	const t = document.createElement("div");
	t.className =
		"fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-lg " +
		(tone === "bad"
			? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/90 dark:text-red-100"
			: "border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50");
	t.textContent = msg;
	document.body.appendChild(t);
	setTimeout(() => t.remove(), 3400);
}
