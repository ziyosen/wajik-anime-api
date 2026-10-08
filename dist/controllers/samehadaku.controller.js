import samehadakuConfig from "../configs/samehadaku.config.js";
import setPayload from "../helpers/setPayload.js";
import { userAgent } from "../helpers/getHTML.js";
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
const samehadakuController = {
    async getRoot(req, res, next) {
        const routes = [
            { method: "GET", path: "/samehadaku/home", description: "Halaman utama (engine bellonime)", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/anime", description: "Daftar semua anime", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/schedule", description: "Jadwal rilis", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/search", description: "Pencarian", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/anime/{animeId}", description: "Detail anime", pathParams: [], queryParams: [] },
            { method: "GET", path: "/samehadaku/episode/{episodeId}", description: "Detail episode", pathParams: [], queryParams: [] },
        ];
        res.json(setPayload(res, {
            message: "Status: OK (engine bellonime via tampung wajik)",
            data: { sourceUrl: baseUrl, engine: apiBaseUrl, routes },
        }));
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
