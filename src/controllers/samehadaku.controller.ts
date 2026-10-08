import type { Request, Response, NextFunction } from "express";
import samehadakuConfig from "@configs/samehadaku.config.js";
import setPayload from "@helpers/setPayload.js";
import getHTML, { userAgent } from "@helpers/getHTML.js";

const { baseUrl, apiBaseUrl } = samehadakuConfig;

/* Samehadaku di wajik (riset 2026-10-08):
   Parser Samehadaku yang terbukti jalan ada di bellonime-api-backup
   (fetch ala browser + parser Cheerio lengkap), sedangkan parser
   Samehadaku bawaan wajik masih kosong. Supaya UI bellonime-same bisa
   langsung menampung dari wajik, route /samehadaku/* diteruskan ke
   engine bellonime (SAMEHADAKU_API_BASE_URL, default service internal
   127.0.0.1:3002). Balasan diteruskan apa adanya — bentuk datanya sama
   persis dengan yang UI harapkan. Port native parser ke wajik adalah
   langkah riset berikutnya, bukan sekarang. */

async function readRawBody(req: Request): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

/* Pencarian Samehadaku native (riset lanjutan 2026-10-08):
   Parser lama di engine bellonime membaca kartu `.animpost` dari
   halaman `?s=...`, tetapi tema samehadaku.li sekarang tidak memakai
   struktur itu untuk hasil pencarian — API balas 404 kosong walau
   judulnya ada. Jalur yang terbukti bersih adalah REST bawaan
   WordPress: tipe khusus `anime` terbuka di `/wp-json/wp/v2/anime`.
   Hasil kosong sekarang dibalas 200 + daftar kosong (bukan 404),
   supaya UI bisa membedakan "tidak ketemu" dari "API rusak". */
const SEARCH_PER_PAGE = 20;

interface IWpAnimeItem {
  slug?: string;
  link?: string;
  featured_media?: number;
  class_list?: string[];
  title?: { rendered?: string };
}

function decodeEntities(text = ""): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchWpJson(pathname: string): Promise<any> {
  const url = new URL(pathname, baseUrl);

  /* REST adalah API JSON publik; coba fetch biasa dulu (cepat), dan
     hanya jatuh ke pengambil ala browser bila diblokir/gagal. */
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`REST menjawab ${response.status}`);
    return JSON.parse(text);
  } catch {
    const raw = await getHTML(baseUrl, pathname);
    return JSON.parse(raw);
  }
}

async function posterMap(items: IWpAnimeItem[]): Promise<Map<number, string>> {
  const ids = [...new Set(items.map((item) => item.featured_media).filter(Boolean))] as number[];
  const map = new Map<number, string>();
  if (!ids.length) return map;

  try {
    const media = await fetchWpJson(
      `/wp-json/wp/v2/media?include=${ids.join(",")}&per_page=${ids.length}&_fields=id,source_url`
    );
    if (Array.isArray(media)) {
      media.forEach((item: any) => {
        if (item?.id && item?.source_url) map.set(Number(item.id), String(item.source_url));
      });
    }
  } catch {
    /* Poster hanya pelengkap; gagal ambil poster tidak menggagalkan pencarian. */
  }

  return map;
}

function wpAnimeToCard(item: IWpAnimeItem, posters: Map<number, string>) {
  const slug = String(item.slug || "");
  const sourceUrl = String(item.link || `${baseUrl}/anime/${slug}/`);
  const classes = Array.isArray(item.class_list) ? item.class_list : [];
  const genreList = classes
    .filter((cls) => cls.startsWith("genres-"))
    .map((cls) => cls.replace(/^genres-/, ""))
    .filter(Boolean)
    .map((genreSlug) => ({
      title: decodeEntities(genreSlug.replace(/-/g, " ")),
      genreId: genreSlug,
      href: `/samehadaku/genres/${genreSlug}`,
      samehadakuUrl: `${baseUrl}/genre/${genreSlug}/`,
    }));

  return {
    title: decodeEntities(item.title?.rendered || slug.replace(/-/g, " ")),
    poster: item.featured_media ? posters.get(Number(item.featured_media)) || "" : "",
    type: "",
    score: "",
    status: "",
    animeId: slug,
    href: `/samehadaku/anime/${slug}`,
    samehadakuUrl: sourceUrl,
    genreList,
  };
}

async function searchSamehadakuRest(q: string, page: number) {
  const params = new URLSearchParams({
    search: q,
    page: String(page),
    per_page: String(SEARCH_PER_PAGE),
    _fields: "slug,link,title,featured_media,class_list",
  });
  const rawItems = await fetchWpJson(`/wp-json/wp/v2/anime?${params.toString()}`);
  let items: IWpAnimeItem[] = Array.isArray(rawItems) ? rawItems : [];

  /* WP REST kadang melewatkan judul yang slug-nya persis sama dengan
     kata kunci tanpa spasi (mis. "onepiece"). Coba slug langsung. */
  if (!items.length) {
    const slug = slugify(q);
    if (slug) {
      const bySlug = await fetchWpJson(
        `/wp-json/wp/v2/anime?slug=${encodeURIComponent(slug)}&_fields=slug,link,title,featured_media,class_list`
      );
      if (Array.isArray(bySlug)) items = bySlug;
    }
  }

  const posters = await posterMap(items);
  const animeList = items.map((item) => wpAnimeToCard(item, posters));
  const hasNextPage = items.length === SEARCH_PER_PAGE;

  return {
    animeList,
    pagination: {
      currentPage: page,
      prevPage: page > 1 ? page - 1 : null,
      hasPrevPage: page > 1,
      nextPage: hasNextPage ? page + 1 : null,
      hasNextPage,
      totalPages: hasNextPage ? null : page,
    } as IPagination,
  };
}

const samehadakuController = {
  async getRoot(req: Request, res: Response, next: NextFunction) {
    const routes: IRouteData[] = [
      { method: "GET", path: "/samehadaku/home", description: "Halaman utama (engine bellonime)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/samehadaku/anime", description: "Daftar semua anime", pathParams: [], queryParams: [] },
      { method: "GET", path: "/samehadaku/schedule", description: "Jadwal rilis", pathParams: [], queryParams: [] },
      { method: "GET", path: "/samehadaku/search", description: "Pencarian", pathParams: [], queryParams: [] },
      { method: "GET", path: "/samehadaku/anime/{animeId}", description: "Detail anime", pathParams: [], queryParams: [] },
      { method: "GET", path: "/samehadaku/episode/{episodeId}", description: "Detail episode", pathParams: [], queryParams: [] },
    ];

    res.json(
      setPayload(res, {
        message: "Status: OK (engine bellonime via tampung wajik)",
        data: { sourceUrl: baseUrl, engine: apiBaseUrl, routes },
      })
    );
  },

  async searchNative(req: Request, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q || req.query.search || "").trim();
      const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);

      if (!q) {
        res.status(400).json(setPayload(res, { message: "query q wajib diisi" }));
        return;
      }

      const { animeList, pagination } = await searchSamehadakuRest(q, page);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async proxy(req: Request, res: Response, next: NextFunction) {
    try {
      const target = new URL(`/samehadaku${req.path}`, apiBaseUrl);
      for (const [key, value] of Object.entries(req.query)) {
        if (Array.isArray(value)) value.forEach((v) => target.searchParams.append(key, String(v)));
        else if (value != null) target.searchParams.set(key, String(value));
      }

      const body = await readRawBody(req);
      const upstream = await fetch(target, {
        method: req.method,
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
          ...(body && req.headers["content-type"] ? { "Content-Type": String(req.headers["content-type"]) } : {}),
        },
        ...(body ? { body } : {}),
      });

      const text = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "";

      res.status(upstream.status);
      if (contentType.includes("application/json")) {
        res.json(text ? JSON.parse(text) : null);
      } else {
        res.type(contentType || "text/plain").send(text);
      }
    } catch (err) {
      next(err);
    }
  },
};

export default samehadakuController;
