export type NavLinks = { neshan: string; balad: string; google: string; dest?: { lat: number; lon: number; name: string } };

const ANDROID = /android/i.test(navigator.userAgent);
const MOBILE = ANDROID || /iphone|ipad|ipod/i.test(navigator.userAgent);
const WEBVIEW = /; wv\)/.test(navigator.userAgent); // an app's built-in browser (Telegram, Instagram), not Chrome

/** Android: a geo: link, so the phone itself asks which installed map app to open (Neshan, Balad, Google
    Maps or whatever is there) and opens the web map when none can. Chrome takes it as an intent: link
    that carries its own web fallback; inside an app's built-in browser that cannot launch apps, the web
    map opens after a moment unless the page lost focus to the chooser or an app. iPhone gives web pages
    no such list, so it gets Google Maps' link, which opens the app when installed and the web otherwise. */
function openRoute(nav: NavLinks) {
  const web = nav.google;
  if (!ANDROID || !nav.dest) {
    if (MOBILE) window.location.href = web;
    else window.open(web, "_blank", "noopener");
    return;
  }
  const { lat, lon, name } = nav.dest;
  const geo = `${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name)})`;
  if (WEBVIEW) { // Chrome falls back on its own; a built-in browser may just ignore the link
    let left = false;
    const away = () => { left = true; };
    window.addEventListener("blur", away, { once: true });
    document.addEventListener("visibilitychange", away, { once: true });
    window.setTimeout(() => {
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", away);
      if (!left) window.location.href = web;
    }, 1500);
  }
  window.location.href = `intent:${geo}#Intent;scheme=geo;S.browser_fallback_url=${encodeURIComponent(web)};end`;
}

/** Routing opens in the person's own map app; the phone's «open with» list decides which. */
export function useNavPick() {
  return { open: (nav: NavLinks) => openRoute(nav) };
}
