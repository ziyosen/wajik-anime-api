import type { Request, Response, NextFunction } from "express";
import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import samehadakuConfig from "@configs/samehadaku.config.js";
import setPayload from "@helpers/setPayload.js";
import getHTML, { userAgent } from "@helpers/getHTML.js";

const { baseUrl, apiBaseUrl } = samehadakuConfig;
const PER_PAGE = 20;

interface ICatalogSourceRef {
  source: "samehadaku-li" | "samehadaku-v2";
  animeId: string;
  href: string;
  samehadakuUrl: string;
  priority: number;
}

interface ICatalogItem {
  key: string;
  title: string;
  aliases: string[];
  season: number | null;
  part: number | null;
  poster: string;
  type: string;
  score: string;
  status: string;
  genreList: { title: string; genreId: string; href: string; samehadakuUrl: string }[];
  sources: ICatalogSourceRef[];
}

interface ISourceCard {
  title: string;
  poster?: string;
  type?: string;
  score?: string;
  status?: string;
  animeId: string;
  samehadakuUrl: string;
  genreList?: ICatalogItem["genreList"];
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

function cleanTitle(title = ""): string {
  return decodeEntities(title).replace(/\s+/g, " ").trim();
}

function titleFromSlug(slug: string): string {
  return cleanTitle(slug.replace(/-/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase());
}

function genreCardFromSlug(genreSlug: string) {
  return {
    title: titleFromSlug(genreSlug),
    genreId: genreSlug,
    href: `/samehadaku/genres/${genreSlug}`,
    samehadakuUrl: `${baseUrl}/genres/${genreSlug}/`,
  };
}

/* Kunci kanonik union: judul dasar dibersihkan, sedangkan season/part
   dipisah dan ditempel lagi sebagai penanda. Dengan begitu
   "2nd Season", "Season 2", dan "S2" menyatu, tetapi season yang
   berbeda tidak ikut dilebur. */
export function canonicalTitleKey(rawTitle: string) {
  let title = cleanTitle(rawTitle)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  let season: number | null = null;
  let part: number | null = null;

  const seasonMatch =
    title.match(/\bseason\s*(\d{1,2})\b/) ||
    title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/) ||
    title.match(/\bs\s*(\d{1,2})\b/);
  if (seasonMatch?.[1]) season = Number.parseInt(seasonMatch[1], 10);

  const partMatch = title.match(/\bpart\s*(\d{1,2})\b/);
  if (partMatch?.[1]) part = Number.parseInt(partMatch[1], 10);

  title = title
    .replace(/\bseason\s*\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\s*season\b/g, " ")
    .replace(/\bs\s*\d{1,2}\b/g, " ")
    .replace(/\bpart\s*\d{1,2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    key: `${title}|s${season ?? ""}|p${part ?? ""}`,
    baseTitle: title,
    season,
    part,
  };
}

function makePagination(page: number, hasNextPage: boolean): IPagination {
  return {
    currentPage: page,
    prevPage: page > 1 ? page - 1 : null,
    hasPrevPage: page > 1,
    nextPage: hasNextPage ? page + 1 : null,
    hasNextPage,
    totalPages: null,
  };
}

async function fetchWpJson(pathname: string): Promise<any> {
  const url = new URL(pathname, baseUrl);
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

async function posterMap(items: any[]): Promise<Map<number, string>> {
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
    /* Poster pelengkap saja. */
  }

  return map;
}

function wpItemToCard(item: any, posters: Map<number, string>): ISourceCard {
  const slug = String(item.slug || "");
  const classes: string[] = Array.isArray(item.class_list) ? item.class_list : [];
  return {
    title: decodeEntities(item.title?.rendered || titleFromSlug(slug)),
    poster: item.featured_media ? posters.get(Number(item.featured_media)) || "" : "",
    animeId: slug,
    samehadakuUrl: String(item.link || `${baseUrl}/anime/${slug}/`),
    genreList: classes
      .filter((cls) => cls.startsWith("genres-"))
      .map((cls) => cls.replace(/^genres-/, ""))
      .filter(Boolean)
      .map(genreCardFromSlug),
  };
}

async function fetchLiLatest(page: number): Promise<ISourceCard[]> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(PER_PAGE),
    orderby: "modified",
    order: "desc",
    _fields: "slug,link,title,featured_media,class_list",
  });
  const items = await fetchWpJson(`/wp-json/wp/v2/anime?${params.toString()}`);
  const list = Array.isArray(items) ? items : [];
  const posters = await posterMap(list);
  return list.map((item) => wpItemToCard(item, posters));
}

async function fetchLiSearch(q: string, page: number): Promise<ISourceCard[]> {
  const params = new URLSearchParams({
    search: q,
    page: String(page),
    per_page: String(PER_PAGE),
    _fields: "slug,link,title,featured_media,class_list",
  });
  const items = await fetchWpJson(`/wp-json/wp/v2/anime?${params.toString()}`);
  const list = Array.isArray(items) ? items : [];
  const posters = await posterMap(list);
  return list.map((item) => wpItemToCard(item, posters));
}

function textOf(el?: HTMLElement | null): string {
  return decodeEntities(el?.text || "");
}

function realImageUrl(img?: HTMLElement | null): string {
  if (!img) return "";
  const dataSrc = img.getAttribute("data-src") || "";
  if (dataSrc.startsWith("http")) return dataSrc;
  const src = img.getAttribute("src") || "";
  return src.startsWith("http") ? src : "";
}

function slugFromAnimeUrl(url = ""): string {
  try {
    const parts = new URL(url, baseUrl).pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("anime");
    return idx >= 0 ? parts[idx + 1] || "" : parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

async function fetchLiArchive(kind: "ongoing" | "completed", page: number): Promise<ISourceCard[]> {
  const params = new URLSearchParams({
    status: kind === "ongoing" ? "Ongoing" : "Completed",
    type: "",
    order: "update",
    page: String(page),
  });
  const html = await getHTML(baseUrl, `/anime/?${params.toString()}`);
  const root = parse(html) as unknown as HTMLElement;

  return root
    .querySelectorAll(".bsx")
    .map((card) => {
      const anchor = card.querySelector("a");
      const sourceUrl = anchor?.getAttribute("href") || "";
      const animeId = slugFromAnimeUrl(sourceUrl);
      return {
        title: textOf(card.querySelector(".tt h2") || card.querySelector(".tt")) || titleFromSlug(animeId),
        poster: realImageUrl(card.querySelector("img")),
        type: textOf(card.querySelector(".typez")),
        status: textOf(card.querySelector(".epx")) || textOf(card.querySelector(".status")),
        animeId,
        samehadakuUrl: sourceUrl,
        genreList: [],
      };
    })
    .filter((card) => card.animeId);
}

async function fetchEngineJson(pathname: string): Promise<any | null> {
  try {
    const response = await fetch(new URL(pathname, apiBaseUrl), {
      headers: { Accept: "application/json", "User-Agent": userAgent },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchV2AllCards(): Promise<ISourceCard[]> {
  const payload = await fetchEngineJson("/samehadaku/anime");
  const groups = payload?.data?.list;
  if (!Array.isArray(groups)) return [];

  return groups.flatMap((group: any) =>
    (Array.isArray(group?.animeList) ? group.animeList : []).map((item: any) => ({
      title: cleanTitle(item.title || titleFromSlug(item.animeId || "")),
      animeId: String(item.animeId || ""),
      samehadakuUrl: String(item.samehadakuUrl || ""),
      genreList: [],
    }))
  ).filter((card: ISourceCard) => card.animeId && card.title);
}

function toCatalogItem(card: ISourceCard, source: ICatalogSourceRef["source"], priority: number): ICatalogItem {
  const parsed = canonicalTitleKey(card.title);
  return {
    key: parsed.key,
    title: card.title,
    aliases: [],
    season: parsed.season,
    part: parsed.part,
    poster: card.poster || "",
    type: card.type || "",
    score: card.score || "",
    status: card.status || "",
    genreList: card.genreList || [],
    sources: [
      {
        source,
        animeId: card.animeId,
        href: `/samehadaku/anime/${card.animeId}`,
        samehadakuUrl: card.samehadakuUrl,
        priority,
      },
    ],
  };
}

function mergeCatalog(primary: ISourceCard[], secondary: ISourceCard[], includeSecondaryOnly = false): ICatalogItem[] {
  const byKey = new Map<string, ICatalogItem>();

  primary.forEach((card) => {
    const item = toCatalogItem(card, "samehadaku-li", 1);
    byKey.set(item.key, item);
  });

  secondary.forEach((card) => {
    const item = toCatalogItem(card, "samehadaku-v2", 2);
    const existing = byKey.get(item.key);
    if (!existing) {
      if (includeSecondaryOnly) byKey.set(item.key, item);
      return;
    }

    if (!existing.aliases.includes(item.title) && existing.title !== item.title) existing.aliases.push(item.title);
    if (!existing.poster && item.poster) existing.poster = item.poster;
    if (!existing.type && item.type) existing.type = item.type;
    if (!existing.score && item.score) existing.score = item.score;
    if (!existing.status && item.status) existing.status = item.status;
    if (!existing.genreList.length && item.genreList.length) existing.genreList = item.genreList;
    const sourceRef = item.sources[0];
    if (sourceRef) existing.sources.push(sourceRef);
  });

  return [...byKey.values()];
}

function pageFromRequest(req: Request): number {
  return Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
}

const catalogController = {
  async getRoot(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(
        setPayload(res, {
          message: "Katalog gabungan Samehadaku (.li + v2/Bellonime). Judul sama ditampilkan sekali; season/part berbeda tidak dilebur.",
          data: {
            routes: [
              { method: "GET", path: "/katalog/terbaru", description: "Terbaru gabungan", pathParams: [], queryParams: [] },
              { method: "GET", path: "/katalog/search", description: "Pencarian gabungan", pathParams: [], queryParams: [] },
              { method: "GET", path: "/katalog/ongoing", description: "Ongoing gabungan", pathParams: [], queryParams: [] },
              { method: "GET", path: "/katalog/completed", description: "Completed gabungan", pathParams: [], queryParams: [] },
            ],
          },
        })
      );
    } catch (err) {
      next(err);
    }
  },

  async latest(req: Request, res: Response, next: NextFunction) {
    try {
      const page = pageFromRequest(req);
      const [liCards, v2Cards] = await Promise.all([fetchLiLatest(page), fetchV2AllCards()]);
      const animeList = mergeCatalog(liCards, v2Cards);
      res.json(setPayload(res, { data: { animeList }, pagination: makePagination(page, liCards.length === PER_PAGE) }));
    } catch (err) {
      next(err);
    }
  },

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q || req.query.search || "").trim();
      const page = pageFromRequest(req);
      if (!q) {
        res.status(400).json(setPayload(res, { message: "query q wajib diisi" }));
        return;
      }

      const queryKey = canonicalTitleKey(q).baseTitle;
      const [liCards, allV2] = await Promise.all([fetchLiSearch(q, page), fetchV2AllCards()]);
      const v2Cards = allV2.filter((card) => canonicalTitleKey(card.title).baseTitle.includes(queryKey));
      const animeList = mergeCatalog(liCards, v2Cards, true);
      res.json(setPayload(res, { data: { animeList }, pagination: makePagination(page, liCards.length === PER_PAGE) }));
    } catch (err) {
      next(err);
    }
  },

  async ongoing(req: Request, res: Response, next: NextFunction) {
    try {
      const page = pageFromRequest(req);
      const [liCards, v2Cards] = await Promise.all([fetchLiArchive("ongoing", page), fetchV2AllCards()]);
      const animeList = mergeCatalog(liCards, v2Cards);
      res.json(setPayload(res, { data: { animeList }, pagination: makePagination(page, liCards.length >= 20) }));
    } catch (err) {
      next(err);
    }
  },

  async completed(req: Request, res: Response, next: NextFunction) {
    try {
      const page = pageFromRequest(req);
      const [liCards, v2Cards] = await Promise.all([fetchLiArchive("completed", page), fetchV2AllCards()]);
      const animeList = mergeCatalog(liCards, v2Cards);
      res.json(setPayload(res, { data: { animeList }, pagination: makePagination(page, liCards.length >= 20) }));
    } catch (err) {
      next(err);
    }
  },
};

export default catalogController;
