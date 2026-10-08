import { gotScraping } from "got-scraping";
import errorinCuy from "./errorinCuy.js";
import sanitizeHtml from "sanitize-html";

export const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0";

/* Pengambil HTML riset (2026-10-08):
   - Memakai got-scraping (header + sidik TLS ala Chrome) meniru belloFetch
     di bellonime-api-backup; fetch polos gampang kena Cloudflare.
   - Retry terbatas + deteksi halaman challenge. Bila sumber menjawab 403 /
     "Just a moment...", error diteruskan apa adanya (403) supaya pemanggil
     tahu sumbernya yang memblokir, bukan API-nya yang kosong.
   - Cookie sesi (cf_clearance dsb) SENGAJA tidak dipakai di sini. */
const MAX_ATTEMPT = 3;
const REQUEST_TIMEOUT_MS = 25_000;

function bodyToString(body: unknown): string {
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf-8");
  return body == null ? "" : String(body);
}

export default async function getHTML(
  baseUrl: string,
  pathname: string,
  ref?: string,
  sanitize = false
): Promise<string> {
  const url = new URL(pathname, baseUrl);
  const referer = ref
    ? ref.startsWith("http")
      ? ref
      : new URL(ref, baseUrl).toString()
    : url.toString();

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
    try {
      const response = await gotScraping({
        url: url.toString(),
        http2: false,
        retry: { limit: 0 },
        timeout: { request: REQUEST_TIMEOUT_MS },
        headerGeneratorOptions: {
          browsers: [{ name: "chrome" }],
          operatingSystems: ["windows"],
        },
        headers: { Referer: referer },
      });

      const html = bodyToString(response.body);

      if (response.statusCode === 403 || /<title>Just a moment\.\.\.<\/title>/i.test(html)) {
        errorinCuy(403, "Sumber memblokir permintaan (Cloudflare)");
      }

      if (response.statusCode < 200 || response.statusCode >= 400) {
        errorinCuy(response.statusCode || 404);
      }

      if (!html.trim()) errorinCuy(404);

      if (sanitize) {
        return sanitizeHtml(html, {
          allowedTags: [
            "address",
            "article",
            "aside",
            "footer",
            "header",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "main",
            "nav",
            "section",
            "blockquote",
            "div",
            "dl",
            "figcaption",
            "figure",
            "hr",
            "li",
            "main",
            "ol",
            "p",
            "pre",
            "ul",
            "a",
            "abbr",
            "b",
            "br",
            "code",
            "data",
            "em",
            "i",
            "mark",
            "span",
            "strong",
            "sub",
            "sup",
            "time",
            "u",
            "img",
          ],
          allowedAttributes: {
            a: ["href", "name", "target"],
            img: ["src"],
            "*": ["class", "id"],
          },
        });
      }

      return html;
    } catch (err: any) {
      /* errorinCuy melempar {status}; jangan di-retry bila sudah jelas 403/404 */
      if (err && typeof err.status === "number") throw err;
      lastError = err;
      if (attempt < MAX_ATTEMPT) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }

  throw lastError ?? new Error("Gagal mengambil HTML dari sumber");
}
