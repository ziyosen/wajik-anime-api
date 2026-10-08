import type { Request, Response, NextFunction } from "express";
import { parse } from "node-html-parser";
import type { HTMLElement } from "node-html-parser";
import animekiidConfig from "@configs/animekiid.config.js";
import setPayload from "@helpers/setPayload.js";
import getHTML from "@helpers/getHTML.js";

const { baseUrl } = animekiidConfig;

/* Animekiid native (riset 2026-10-08):
   animekiid.com memakai tema WordPress mirip samehadaku.li: kartu
   arsip `.bsx`, detail `.spe`, daftar episode `.epl-num`, dan player
   episode berupa iframe streaming. REST WordPress-nya hanya tipe
   standar, jadi jalur yang terbukti adalah parser HTML native ini. */

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

function titleFromSlug(slug: string): string {
  return decodeEntities(slug.replace(/-/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase());
}

function textOf(el?: HTMLElement | null): string {
  return decodeEntities(el?.text || "");
}

function realImageUrl(img?: HTMLElement | null): string {
  if (!img) return "";
  const dataSrc = img.getAttribute("data-src") || img.getAttribute("data-litespeed-src") || "";
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

function slugFromRootUrl(url = ""): string {
  try {
    const parts = new URL(url, baseUrl).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function makePagination(page: number, hasNextPage: boolean, totalPages: number | null = null): IPagination {
  return {
    currentPage: page,
    prevPage: page > 1 ? page - 1 : null,
    hasPrevPage: page > 1,
    nextPage: hasNextPage ? page + 1 : null,
    hasNextPage,
    totalPages,
  };
}

function genreCardFromSlug(genreSlug: string) {
  return {
    title: titleFromSlug(genreSlug),
    genreId: genreSlug,
    href: `/animekiid/genres/${genreSlug}`,
    animekiidUrl: `${baseUrl}/genres/${genreSlug}/`,
  };
}

function parseCards(root: HTMLElement) {
  return root
    .querySelectorAll(".bsx")
    .map((card) => {
      const anchor = card.querySelector("a[href*='/anime/']");
      const sourceUrl = anchor?.getAttribute("href") || "";
      const animeId = slugFromAnimeUrl(sourceUrl);
      return {
        title: textOf(card.querySelector(".tt h2") || card.querySelector(".tt")) || anchor?.getAttribute("title") || titleFromSlug(animeId),
        poster: realImageUrl(card.querySelector("img")),
        status: textOf(card.querySelector(".status")),
        type: textOf(card.querySelector(".typez")),
        score: textOf(card.querySelector(".numscore")),
        episodes: textOf(card.querySelector(".epx")),
        animeId,
        href: `/animekiid/anime/${animeId}`,
        animekiidUrl: sourceUrl,
        genreList: [] as ReturnType<typeof genreCardFromSlug>[],
      };
    })
    .filter((card) => card.animeId);
}

async function fetchArchive(params: Record<string, string>, page: number) {
  const search = new URLSearchParams();
  if (page > 1) search.set("page", String(page));
  Object.entries(params).forEach(([key, value]) => search.set(key, value));
  const pathname = `/anime/?${search.toString()}`;
  const html = await getHTML(baseUrl, pathname);
  const root = parse(html) as unknown as HTMLElement;
  const animeList = parseCards(root);
  const hasNextPage = root
    .querySelectorAll("a")
    .some((a) => (a.getAttribute("href") || "").includes(`page=${page + 1}`));

  return { animeList, pagination: makePagination(page, hasNextPage) };
}

function pageFromRequest(req: Request): number {
  return Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
}

function orderFromRequest(req: Request, fallback = "update"): string {
  const order = String(req.query.order || fallback).toLowerCase();
  return ["title", "titlereverse", "update", "latest", "popular", "rating"].includes(order) ? order : fallback;
}

async function getArchive(kind: "latest" | "ongoing" | "completed" | "popular" | "movies", req: Request) {
  const page = pageFromRequest(req);
  const order = orderFromRequest(req, kind === "popular" ? "popular" : "update");
  const params: Record<string, string> = { status: "", type: "", order };

  if (kind === "ongoing") params.status = "Ongoing";
  if (kind === "completed") params.status = "Completed";
  if (kind === "movies") params.type = "Movie";
  if (kind === "popular") params.order = "popular";

  return fetchArchive(params, page);
}

async function getGenres() {
  const html = await getHTML(baseUrl, "/anime/");
  const root = parse(html) as unknown as HTMLElement;
  const seen = new Map<string, ReturnType<typeof genreCardFromSlug>>();

  root.querySelectorAll('input[name="genre[]"]').forEach((input) => {
    const slug = String(input.getAttribute("value") || "").trim();
    if (slug) seen.set(slug, genreCardFromSlug(slug));
  });

  return { genreList: [...seen.values()] };
}

async function getGenreAnimes(genreId: string, page: number) {
  const slug = slugify(genreId);
  const pathname = page > 1 ? `/genres/${slug}/page/${page}/` : `/genres/${slug}/`;
  const html = await getHTML(baseUrl, pathname);
  const root = parse(html) as unknown as HTMLElement;
  const animeList = parseCards(root);
  const hasNextPage = root
    .querySelectorAll("a")
    .some((a) => (a.getAttribute("href") || "").includes(`/genres/${slug}/page/${page + 1}/`));

  return { animeList, pagination: makePagination(page, hasNextPage) };
}

async function searchAnimes(q: string) {
  const html = await getHTML(baseUrl, `/?s=${encodeURIComponent(q)}`);
  const root = parse(html) as unknown as HTMLElement;
  return { animeList: parseCards(root), pagination: makePagination(1, false, 1) };
}

function parseSpe(root: HTMLElement): Record<string, string> {
  const info: Record<string, string> = {};
  root.querySelectorAll(".spe span").forEach((span) => {
    const key = textOf(span.querySelector("b")).replace(/:$/, "").trim();
    if (!key) return;
    info[key.toLowerCase()] = textOf(span).replace(new RegExp(`^${key}:?`, "i"), "").trim();
  });
  return info;
}

async function getAnimeDetails(animeId: string) {
  const slug = slugify(animeId);
  const html = await getHTML(baseUrl, `/anime/${slug}/`);
  const root = parse(html) as unknown as HTMLElement;
  const info = parseSpe(root);
  const genreList: ReturnType<typeof genreCardFromSlug>[] = [];

  root.querySelectorAll('a[href*="/genres/"]').forEach((a) => {
    const href = a.getAttribute("href") || "";
    const genreSlug = href.split("/genres/")[1]?.replace(/\/$/, "");
    if (genreSlug && !genreList.some((genre) => genre.genreId === genreSlug)) {
      genreList.push(genreCardFromSlug(genreSlug));
    }
  });

  const episodeList = root
    .querySelectorAll(".epl-num")
    .map((numEl) => {
      const anchor = numEl.closest("a");
      const sourceUrl = anchor?.getAttribute("href") || "";
      const episodeId = slugFromRootUrl(sourceUrl);
      const item = numEl.closest("li");
      const titleNum = Number.parseInt(textOf(numEl), 10);
      return {
        title: Number.isFinite(titleNum) ? titleNum : null,
        episodeId,
        href: `/animekiid/episode/${episodeId}`,
        animekiidUrl: sourceUrl,
        releasedOn: textOf(item?.querySelector(".epl-date")),
      };
    })
    .filter((ep) => ep.episodeId)
    .sort((a, b) => Number(a.title || 0) - Number(b.title || 0));

  const paragraphs = root
    .querySelectorAll(".entry-content p, .desc p, .synopsis p")
    .map((p) => textOf(p))
    .filter(Boolean)
    .slice(0, 6);
  const episodes = Number.parseInt(info.episode || "", 10);

  return {
    title: textOf(root.querySelector("h1.entry-title") || root.querySelector("h1")) || titleFromSlug(slug),
    poster: realImageUrl(root.querySelector("img.ts-post-image") || root.querySelector(".thumb img") || root.querySelector(".postbody img")),
    score: { value: textOf(root.querySelector(".numscore")), users: "" },
    japanese: "",
    synonyms: textOf(root.querySelector(".alter")),
    english: "",
    status: info.status || "",
    type: info.tipe || info.type || "",
    source: "",
    duration: info.durasi || info.duration || "",
    episodes: Number.isFinite(episodes) ? episodes : null,
    season: info.season || "",
    studios: info.studio || "",
    producers: info.producers || "",
    aired: info.dirilis || info.released || "",
    trailer: "",
    synopsis: { paragraphs, connections: [] },
    genreList,
    episodeList,
  };
}

async function getEpisodeDetails(episodeId: string) {
  const slug = slugify(episodeId);
  const html = await getHTML(baseUrl, `/episode/${slug}/`);
  const root = parse(html) as unknown as HTMLElement;
  const embedList = root
    .querySelectorAll("iframe")
    .map((frame) => frame.getAttribute("data-litespeed-src") || frame.getAttribute("data-src") || frame.getAttribute("src") || "")
    .map((url) => url.trim())
    .filter((url) => url && url !== "about:blank");

  return {
    episodeId: slug,
    title: textOf(root.querySelector("h1.entry-title") || root.querySelector("h1")) || titleFromSlug(slug),
    href: `/animekiid/episode/${slug}`,
    animekiidUrl: `${baseUrl}/episode/${slug}/`,
    releasedOn: textOf(root.querySelector(".epxdate, .released, .time-post")),
    embedList,
    defaultEmbed: embedList[0] || "",
    serverList: [] as { label: string; url: string }[],
    navigation: {
      all: root.querySelector('.naveps .nvsc a')?.getAttribute("href") || "",
      next: root.querySelector('a[rel="next"]')?.getAttribute("href") || "",
      prev: root.querySelector('a[rel="prev"]')?.getAttribute("href") || "",
    },
  };
}

const animekiidController = {
  async getRoot(req: Request, res: Response, next: NextFunction) {
    const routes: IRouteData[] = [
      { method: "GET", path: "/animekiid/home", description: "Daftar terbaru (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/search", description: "Pencarian (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/ongoing", description: "Anime ongoing (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/completed", description: "Anime completed (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/popular", description: "Anime popular (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/movies", description: "Anime movie (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/genres", description: "Semua genre (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/genres/{genreId}", description: "Anime per genre (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/anime/{animeId}", description: "Detail anime (native animekiid.com)", pathParams: [], queryParams: [] },
      { method: "GET", path: "/animekiid/episode/{episodeId}", description: "Detail episode (native animekiid.com)", pathParams: [], queryParams: [] },
    ];

    res.json(setPayload(res, { data: { sourceUrl: baseUrl, routes } }));
  },

  async home(req: Request, res: Response, next: NextFunction) {
    try {
      const { animeList, pagination } = await getArchive("latest", req);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = String(req.query.q || req.query.search || "").trim();
      if (!q) {
        res.status(400).json(setPayload(res, { message: "query q wajib diisi" }));
        return;
      }
      const { animeList, pagination } = await searchAnimes(q);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async ongoing(req: Request, res: Response, next: NextFunction) {
    try {
      const { animeList, pagination } = await getArchive("ongoing", req);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async completed(req: Request, res: Response, next: NextFunction) {
    try {
      const { animeList, pagination } = await getArchive("completed", req);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async popular(req: Request, res: Response, next: NextFunction) {
    try {
      const { animeList, pagination } = await getArchive("popular", req);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async movies(req: Request, res: Response, next: NextFunction) {
    try {
      const { animeList, pagination } = await getArchive("movies", req);
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async genres(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await getGenres();
      res.json(setPayload(res, { data }));
    } catch (err) {
      next(err);
    }
  },

  async genreAnimes(req: Request, res: Response, next: NextFunction) {
    try {
      const { animeList, pagination } = await getGenreAnimes(String(req.params.genreId || ""), pageFromRequest(req));
      res.json(setPayload(res, { data: { animeList }, pagination }));
    } catch (err) {
      next(err);
    }
  },

  async animeDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await getAnimeDetails(String(req.params.animeId || ""));
      res.json(setPayload(res, { data }));
    } catch (err) {
      next(err);
    }
  },

  async episodeDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await getEpisodeDetails(String(req.params.episodeId || ""));
      res.json(setPayload(res, { data }));
    } catch (err) {
      next(err);
    }
  },
};

export default animekiidController;
