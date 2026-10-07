import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { adminAccountResetPath, adminToolKey, adminToolPath, legacyAdminWorkspacePath, supportsAdminScope, validatedAdminReturn } from "./adminNavigation";
import { accountContext, accountQuery } from "./accountHierarchy";

function read(key: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string" && entry.length <= 10000)) : {};
  } catch { return {}; }
}
export const ADMIN_RETURN_STATE = { adminRestore: true };
const ACTIVE_ACCOUNT_KEY = "posetek-admin-active-account";

export function useAdminToolLinks(uid: string) {
  const location = useLocation(), key = `posetek-admin-navigation:${uid}`, stored = read(key);
  useEffect(() => {
    if (!uid) return;
    const history = read(key), tool = adminToolKey(location.pathname);
    const record = /^\/admin\/accounts\/(?:player|coach)\//.test(location.pathname);
    const back = validatedAdminReturn(new URLSearchParams(location.search).get("returnTo"));
    // A record's returnTo is the directory/report origin, not a replacement
    // for its remembered filters. Reporting pagination is never directory state.
    if (!record) history[tool] = location.search;
    else if (back && adminToolKey(back.split("?")[0]) === "directory") history.directory = back.split("?")[0] === "/admin" ? legacyAdminWorkspacePath(back.split("?")[1] || "").split("?")[1] || "" : back.split("?")[1] || "";
    if (supportsAdminScope(location.pathname)) history.scope = accountQuery(accountContext(location.search));
    try { sessionStorage.setItem(key, JSON.stringify(history)); } catch { /* navigation works without browser storage */ }
  }, [uid, key, location.pathname, location.search]);
  return (destination: string) => {
    const retainedScope = accountContext(stored.scope !== undefined ? stored.scope : stored.directory || stored.report || location.search);
    const retained = stored[adminToolKey(destination)] ?? (adminToolKey(destination) === "directory" && stored.report ? legacyAdminWorkspacePath(stored.report).split("?")[1] || "" : "");
    return adminToolPath(destination, location.pathname, location.search, retained, retainedScope);
  };
}

// Only viewport/focus and URL state survive; no account records are stored here.
export function useAdminScrollRestoration(uid: string) {
  const location = useLocation(), action = useNavigationType(), navigate = useNavigate();
  const pendingReturn = useRef("");
  const route = `${location.pathname}${location.search}`, key = `posetek-admin-position:${uid}:${route}`;
  useLayoutEffect(() => {
    if (!uid) return;
    try {
      const previous = sessionStorage.getItem(ACTIVE_ACCOUNT_KEY);
      const changed = Boolean(previous && previous !== uid);
      for (const entry of Object.keys(sessionStorage)) if (/^posetek-admin-(?:navigation|position):/.test(entry)
        && entry !== `posetek-admin-navigation:${uid}` && !entry.startsWith(`posetek-admin-position:${uid}:`)) sessionStorage.removeItem(entry);
      if (changed) {
        sessionStorage.removeItem(`posetek-admin-navigation:${uid}`);
        for (const entry of Object.keys(sessionStorage)) if (entry.startsWith(`posetek-admin-position:${uid}:`)) sessionStorage.removeItem(entry);
      }
      sessionStorage.setItem(ACTIVE_ACCOUNT_KEY, uid);
      if (changed) { pendingReturn.current = ""; navigate(adminAccountResetPath(location.pathname), { replace: true }); }
    } catch { /* unavailable storage does not prevent authorized navigation */ }
  }, [uid, navigate, location.pathname]);

  useLayoutEffect(() => {
    if (!uid) return;
    let cancelled = false, frame = 0;
    const deadline = performance.now() + 15000;
    let capturedFocus = "";
    let capturedY: number | undefined;
    let saved: { y?: number; focus?: string } = {};
    const explicitReturn = Boolean((location.state as { adminRestore?: boolean } | null)?.adminRestore) || pendingReturn.current === route;
    pendingReturn.current = "";
    if (action === "POP" || explicitReturn) try {
      const value = JSON.parse(sessionStorage.getItem(key) || "{}");
      saved = { ...(typeof value?.y === "number" && Number.isFinite(value.y) && value.y >= 0 ? { y: value.y } : {}), ...(typeof value?.focus === "string" ? { focus: value.focus.slice(0, 250) } : {}) };
    } catch { /* no saved position */ }
    if (saved.y === undefined) window.scrollTo(0, 0);
    const restore = () => {
      if (cancelled) return;
      if (saved.y !== undefined) window.scrollTo(0, saved.y);
      const target = saved.focus ? document.getElementById(saved.focus) : null;
      if (target) target.focus({ preventScroll: true });
      // Lazy panels can render after the shell. Stop once the saved position fits.
      if (performance.now() < deadline && (document.documentElement.scrollHeight < (saved.y || 0) + window.innerHeight || saved.focus && !target)) frame = requestAnimationFrame(restore);
    };
    frame = requestAnimationFrame(restore);
    const save = () => {
      const focus = capturedFocus || document.activeElement?.id;
      try { sessionStorage.setItem(key, JSON.stringify({ y: capturedY ?? window.scrollY, ...(focus ? { focus } : {}) })); } catch { /* storage unavailable */ }
    };
    const capture = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href, window.location.origin);
      if (target.origin !== window.location.origin || !target.pathname.startsWith("/admin")) return;
      capturedFocus = anchor.id || anchor.closest("tr")?.querySelector<HTMLAnchorElement>('[id^="admin-player-"]')?.id || document.activeElement?.id || "";
      capturedY = window.scrollY;
      save();
      const back = validatedAdminReturn(new URLSearchParams(location.search).get("returnTo"));
      if (back === `${target.pathname}${target.search}`) pendingReturn.current = back;
    };
    const scroll = () => { if (capturedY !== undefined) capturedY = window.scrollY; };
    document.addEventListener("click", capture, true);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => { cancelled = true; cancelAnimationFrame(frame); save(); document.removeEventListener("click", capture, true); window.removeEventListener("scroll", scroll); window.removeEventListener("pagehide", save); };
  }, [action, key, uid, route, location.state, location.search]);
}
