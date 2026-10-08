import { parse } from "node-html-parser";
import samehadakuConfig from "../configs/samehadaku.config.js";
import setPayload from "../helpers/setPayload.js";
import getHTML, { userAgent } from "../helpers/getHTML.js";
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
async function readRawBody(req) {
    if (req.method === "GET" || req.method === "HEAD")
        return undefined;
    const chunks = [];
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
function decodeEntities(text = "") {
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
function slugify(text) {
    return text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function titleFromSlug(slug) {
    return decodeEntities(slug.replace(/-/g, " ")).replace(/\b\w/g, (c) => c.toUpperCase());
}
function genreCardFromSlug(genreSlug) {
    return {
        title: titleFromSlug(genreSlug),
        genreId: genreSlug,
        href: `/samehadaku/genres/${genreSlug}`,
        samehadakuUrl: `${baseUrl}/genres/${genreSlug}/`,
    };
}
function genreListFromClasses(classes = []) {
    return classes
        .filter((cls) => cls.startsWith("genres-"))
        .map((cls) => cls.replace(/^genres-/, ""))
        .filter(Boolean)
        .map(genreCardFromSlug);
}
function makePagination(page, hasNextPage, totalPages = null) {
    return {
        currentPage: page,
        prevPage: page > 1 ? page - 1 : null,
        hasPrevPage: page > 1,
        nextPage: hasNextPage ? page + 1 : null,
        hasNextPage,
        totalPages,
    };
}
function textOf(el) {
    return decodeEntities(el?.text || "");
}
function realImageUrl(img) {
    if (!img)
        return "";
    const dataSrc = img.getAttribute("data-src") || "";
    if (dataSrc.startsWith("http"))
        return dataSrc;
    const src = img.getAttribute("src") || "";
    return src.startsWith("http") ? src : "";
}
function slugFromAnimeUrl(url = "") {
    try {
        const parts = new URL(url, baseUrl).pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("anime");
        return idx >= 0 ? parts[idx + 1] || "" : parts[parts.length - 1] || "";
    }
    catch {
        return "";
    }
}
function slugFromRootUrl(url = "") {
    try {
        const parts = new URL(url, baseUrl).pathname.split("/").filter(Boolean);
        return parts[parts.length - 1] || "";
    }
    catch {
        return "";
    }
}
function parseArchiveCards(root) {
    return root.querySelectorAll(".bsx").map((card) => {
        const anchor = card.querySelector("a");
        const sourceUrl = anchor?.getAttribute("href") || "";
        const animeId = slugFromAnimeUrl(sourceUrl);
        const img = card.querySelector("img");
        const title = textOf(card.querySelector(".tt h2") || card.querySelector(".tt")) || titleFromSlug(animeId);
        const type = textOf(card.querySelector(".typez"));
        const status = textOf(card.querySelector(".epx")) || textOf(card.querySelector(".status"));
        return {
            title,
            poster: realImageUrl(img),
            status,
            type,
            score: textOf(card.querySelector(".numscore")),
            animeId,
            href: `/samehadaku/anime/${animeId}`,
            samehadakuUrl: sourceUrl,
            genreList: [],
        };
    }).filter((card) => card.animeId);
}
async function fetchNativeArchive(pathname, page) {
    const html = await getHTML(baseUrl, pathname);
    const root = parse(html);
    const animeList = parseArchiveCards(root);
    const hasNextPage = root
        .querySelectorAll("a")
        .some((a) => (a.getAttribute("href") || "").includes(`page=${page + 1}`));
    return { animeList, pagination: makePagination(page, hasNextPage) };
}
function archivePath(params) {
    const search = new URLSearchParams(params);
    return `/anime/?${search.toString()}`;
}
function stripHtmlToParagraphs(html = "") {
    const root = parse(html || "");
    const paragraphs = root
        .querySelectorAll("p")
        .map((p) => textOf(p))
        .filter(Boolean);
    if (paragraphs.length)
        return paragraphs;
    const text = textOf(root);
    return text ? [text] : [];
}
async function fetchWpJson(pathname) {
    const url = new URL(pathname, baseUrl);
    /* REST adalah API JSON publik; coba fetch biasa dulu (cepat), dan
       hanya jatuh ke pengambil ala browser bila diblokir/gagal. */
    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json", "User-Agent": userAgent },
            signal: AbortSignal.timeout(20_000),
        });
        const text = await response.text();
        if (!response.ok)
            throw new Error(`REST menjawab ${response.status}`);
        return JSON.parse(text);
    }
    catch {
        const raw = await getHTML(baseUrl, pathname);
        return JSON.parse(raw);
    }
}
async function posterMap(items) {
    const ids = [...new Set(items.map((item) => item.featured_media).filter(Boolean))];
    const map = new Map();
    if (!ids.length)
        return map;
    try {
        const media = await fetchWpJson(`/wp-json/wp/v2/media?include=${ids.join(",")}&per_page=${ids.length}&_fields=id,source_url`);
        if (Array.isArray(media)) {
            media.forEach((item) => {
                if (item?.id && item?.source_url)
                    map.set(Number(item.id), String(item.source_url));
            });
        }
    }
    catch {
        /* Poster hanya pelengkap; gagal ambil poster tidak menggagalkan pencarian. */
    }
    return map;
}
function wpAnimeToCard(item, posters) {
    const slug = String(item.slug || "");
    const sourceUrl = String(item.link || `${baseUrl}/anime/${slug}/`);
    const genreList = genreListFromClasses(Array.isArray(item.class_list) ? item.class_list : []);
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
async function searchSamehadakuRest(q, page) {
    const params = new URLSearchParams({
        search: q,
        page: String(page),
        per_page: String(SEARCH_PER_PAGE),
        _fields: "slug,link,title,featured_media,class_list",
    });
    const rawItems = await fetchWpJson(`/wp-json/wp/v2/anime?${params.toString()}`);
    let items = Array.isArray(rawItems) ? rawItems : [];
    /* WP REST kadang melewatkan judul yang slug-nya persis sama dengan
       kata kunci tanpa spasi (mis. "onepiece"). Coba slug langsung. */
    if (!items.length) {
        const slug = slugify(q);
        if (slug) {
            const bySlug = await fetchWpJson(`/wp-json/wp/v2/anime?slug=${encodeURIComponent(slug)}&_fields=slug,link,title,featured_media,class_list`);
            if (Array.isArray(bySlug))
                items = bySlug;
        }
    }
    const posters = await posterMap(items);
    const animeList = items.map((item) => wpAnimeToCard(item, posters));
    const hasNextPage = items.length === SEARCH_PER_PAGE;
    return {
        animeList,
        pagination: makePagination(page, hasNextPage, hasNextPage ? null : page),
    };
}
function pageFromRequest(req) {
    return Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
}
function orderFromRequest(req, fallback = "update") {
    const order = String(req.query.order || fallback).toLowerCase();
    return ["title", "titlereverse", "update", "latest", "popular", "rating"].includes(order) ? order : fallback;
}
async function getNativeArchive(kind, req) {
    const page = pageFromRequest(req);
    const order = orderFromRequest(req, kind === "popular" ? "popular" : "update");
    const params = { status: "", type: "", order, page: String(page) };
    if (kind === "ongoing")
        params.status = "Ongoing";
    if (kind === "completed")
        params.status = "Completed";
    if (kind === "movies")
        params.type = "Movie";
    if (kind === "popular")
        params.order = "popular";
    return fetchNativeArchive(archivePath(params), page);
}
async function getNativeGenres() {
    const html = await getHTML(baseUrl, "/anime/");
    const root = parse(html);
    const seen = new Map();
    root.querySelectorAll('input[name="genre[]"]').forEach((input) => {
        const slug = String(input.getAttribute("value") || "").trim();
        if (slug)
            seen.set(slug, genreCardFromSlug(slug));
    });
    return { genreList: [...seen.values()] };
}
async function getNativeGenreAnimes(genreId, page) {
    const slug = slugify(genreId);
    const pathname = page > 1 ? `/genres/${slug}/page/${page}/` : `/genres/${slug}/`;
    const html = await getHTML(baseUrl, pathname);
    const root = parse(html);
    const animeList = parseArchiveCards(root);
    const hasNextPage = root
        .querySelectorAll("a")
        .some((a) => (a.getAttribute("href") || "").includes(`/genres/${slug}/page/${page + 1}/`));
    return { animeList, pagination: makePagination(page, hasNextPage) };
}
function parseSpe(root) {
    const info = {};
    root.querySelectorAll(".spe span").forEach((span) => {
        const key = textOf(span.querySelector("b")).replace(/:$/, "").trim();
        if (!key)
            return;
        info[key.toLowerCase()] = textOf(span).replace(new RegExp(`^${key}:?`, "i"), "").trim();
    });
    return info;
}
async function getNativeAnimeDetails(animeId) {
    const slug = slugify(animeId);
    const [wpItems, html] = await Promise.all([
        fetchWpJson(`/wp-json/wp/v2/anime?slug=${encodeURIComponent(slug)}`).catch(() => []),
        getHTML(baseUrl, `/anime/${slug}/`),
    ]);
    const wpItem = Array.isArray(wpItems) ? wpItems[0] : undefined;
    const root = parse(html);
    const posters = wpItem ? await posterMap([wpItem]) : new Map();
    const poster = (wpItem && posters.get(Number(wpItem.featured_media))) || realImageUrl(root.querySelector(".thumb img") || root.querySelector(".postbody img"));
    const info = parseSpe(root);
    const title = textOf(root.querySelector("h1.entry-title")) || decodeEntities(wpItem?.title?.rendered || "") || titleFromSlug(slug);
    const paragraphs = stripHtmlToParagraphs(wpItem?.content?.rendered || root.querySelector(".entry-content")?.outerHTML || "");
    const genreList = wpItem ? genreListFromClasses(wpItem.class_list || []) : [];
    if (!genreList.length) {
        root.querySelectorAll('a[href*="/genres/"]').forEach((a) => {
            const href = a.getAttribute("href") || "";
            const genreSlug = href.split("/genres/")[1]?.replace(/\/$/, "");
            if (genreSlug)
                genreList.push(genreCardFromSlug(genreSlug));
        });
    }
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
            href: `/samehadaku/episode/${episodeId}`,
            samehadakuUrl: sourceUrl,
            releasedOn: textOf(item?.querySelector(".epl-date")),
        };
    })
        .filter((ep) => ep.episodeId)
        .sort((a, b) => Number(a.title || 0) - Number(b.title || 0));
    const batchList = root
        .querySelectorAll('a[href*="/batch/"]')
        .map((a) => {
        const sourceUrl = a.getAttribute("href") || "";
        const batchId = slugFromRootUrl(sourceUrl);
        return {
            title: textOf(a),
            batchId,
            href: `/samehadaku/batch/${batchId}`,
            samehadakuUrl: sourceUrl,
        };
    })
        .filter((batch, idx, arr) => batch.batchId && arr.findIndex((x) => x.batchId === batch.batchId) === idx);
    const scoreValue = root.querySelector('meta[itemprop="ratingValue"]')?.getAttribute("content") || textOf(root.querySelector(".numscore"));
    const scoreUsers = root.querySelector('meta[itemprop="ratingCount"]')?.getAttribute("content") || "";
    const episodes = Number.parseInt(info.episodes || "", 10);
    return {
        title,
        poster,
        score: { value: scoreValue, users: scoreUsers },
        japanese: "",
        synonyms: textOf(root.querySelector(".alter")),
        english: "",
        status: info.status || "",
        type: info.type || "",
        source: "",
        duration: info.duration || "",
        episodes: Number.isFinite(episodes) ? episodes : null,
        season: info.season || "",
        studios: info.studio || "",
        producers: info.producer || "",
        aired: info.released || info["released on"] || "",
        trailer: root.querySelector("iframe")?.getAttribute("src") || "",
        synopsis: { paragraphs, connections: [] },
        genreList,
        batchList,
        episodeList,
    };
}
const samehadakuController = {
    async getRoot(req, res, next) {
        const routes = [
            { method: "GET", path: "/samehadaku/home", description: "Halaman utama (engine bellonime)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/anime", description: "Daftar semua anime (engine bellonime)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/ongoing", description: "Anime ongoing (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/completed", description: "Anime completed (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/popular", description: "Anime popular (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/movies", description: "Anime movie (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/genres", description: "Semua genre (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/genres/{genreId}", description: "Anime per genre (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/schedule", description: "Jadwal rilis (masih engine bellonime)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/search", description: "Pencarian (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/anime/{animeId}", description: "Detail anime (native samehadaku.li)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/episode/{episodeId}", description: "Detail episode (engine bellonime)", pathParams: [], queryParams: [] },
        ];
        res.json(setPayload(res, {
            message: "Status: OK (engine bellonime via tampung wajik)",
            data: { sourceUrl: baseUrl, engine: apiBaseUrl, routes },
        }));
    },
    async searchNative(req, res, next) {
        try {
            const q = String(req.query.q || req.query.search || "").trim();
            const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
            if (!q) {
                res.status(400).json(setPayload(res, { message: "query q wajib diisi" }));
                return;
            }
            const { animeList, pagination } = await searchSamehadakuRest(q, page);
            res.json(setPayload(res, { data: { animeList }, pagination }));
        }
        catch (err) {
            next(err);
        }
    },
    async ongoingNative(req, res, next) {
        try {
            const { animeList, pagination } = await getNativeArchive("ongoing", req);
            res.json(setPayload(res, { data: { animeList }, pagination }));
        }
        catch (err) {
            next(err);
        }
    },
    async completedNative(req, res, next) {
        try {
            const { animeList, pagination } = await getNativeArchive("completed", req);
            res.json(setPayload(res, { data: { animeList }, pagination }));
        }
        catch (err) {
            next(err);
        }
    },
    async popularNative(req, res, next) {
        try {
            const { animeList, pagination } = await getNativeArchive("popular", req);
            res.json(setPayload(res, { data: { animeList }, pagination }));
        }
        catch (err) {
            next(err);
        }
    },
    async moviesNative(req, res, next) {
        try {
            const { animeList, pagination } = await getNativeArchive("movies", req);
            res.json(setPayload(res, { data: { animeList }, pagination }));
        }
        catch (err) {
            next(err);
        }
    },
    async genresNative(req, res, next) {
        try {
            const data = await getNativeGenres();
            res.json(setPayload(res, { data }));
        }
        catch (err) {
            next(err);
        }
    },
    async genreAnimesNative(req, res, next) {
        try {
            const { animeList, pagination } = await getNativeGenreAnimes(String(req.params.genreId || ""), pageFromRequest(req));
            res.json(setPayload(res, { data: { animeList }, pagination }));
        }
        catch (err) {
            next(err);
        }
    },
    async animeDetailsNative(req, res, next) {
        try {
            const data = await getNativeAnimeDetails(String(req.params.animeId || ""));
            res.json(setPayload(res, { data }));
        }
        catch (err) {
            next(err);
        }
    },
    async proxy(req, res, next) {
        try {
            const target = new URL(`/samehadaku${req.path}`, apiBaseUrl);
            for (const [key, value] of Object.entries(req.query)) {
                if (Array.isArray(value))
                    value.forEach((v) => target.searchParams.append(key, String(v)));
                else if (value != null)
                    target.searchParams.set(key, String(value));
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
            }
            else {
                res.type(contentType || "text/plain").send(text);
            }
        }
        catch (err) {
            next(err);
        }
    },
};
export default samehadakuController;
