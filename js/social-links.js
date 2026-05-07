/**
 * Artist / project outbound links (edit URLs here only).
 *
 * Full URLs (https://…) or scheme-less host/path (https:// is prepended).
 * Leave "" or omit — that row is hidden. Invalid strings are ignored (row hidden).
 *
 * Only http(s) URLs are accepted after normalization.
 */
const SOCIAL_LINKS = {
  x: "http://x.com/shelton",
  instagram: "http://x.com/sheltonc",
  spotify: "http://x.com/sheltonc",
  youtube: "http://x.com/sheltonc"
};

function normalizeSocialUrl(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) {
    if (candidate.startsWith("//")) candidate = "https:" + candidate;
    else candidate = "https://" + candidate.replace(/^\/+/, "");
  }
  try {
    const u = new URL(candidate);
    if (!u.hostname) return "";
    const proto = u.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") return "";
    return u.href;
  } catch (_) {
    return "";
  }
}

function applySocialLinks() {
  const nav = document.querySelector(".social-links");
  let anyVisible = false;

  document.querySelectorAll("a[data-social]").forEach((a) => {
    const key = a.dataset.social;
    const url = normalizeSocialUrl(SOCIAL_LINKS[key]);
    const li = a.closest("li");
    if (!li) return;

    if (url) {
      anyVisible = true;
      li.hidden = false;
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.removeAttribute("aria-disabled");
      a.removeAttribute("title");
    } else {
      li.hidden = true;
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
    }
  });

  if (nav) nav.hidden = !anyVisible;
}

applySocialLinks();
