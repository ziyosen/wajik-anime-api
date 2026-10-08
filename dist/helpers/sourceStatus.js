import otakudesuConfig from "../configs/otakudesu.config.js";
import kuramanimeConfig from "../configs/kuramanime.config.js";
import samehadakuConfig from "../configs/samehadaku.config.js";
import { userAgent } from "./getHTML.js";
const PROBE_TIMEOUT_MS = 10_000;
async function probe(source, url) {
    const started = Date.now();
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": userAgent, Accept: "text/html,application/json" },
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const text = await response.text().catch(() => "");
        const blocked = response.status === 403 || /just a moment/i.test(text);
        return {
            source,
            url,
            reachable: response.status >= 200 && response.status < 400 && !blocked,
            blocked,
            status: response.status,
            latencyMs: Date.now() - started,
            note: blocked ? "Diblokir Cloudflare dari IP server ini" : response.ok ? "Terjangkau" : "Menjawab bukan 2xx",
        };
    }
    catch (err) {
        return {
            source,
            url,
            reachable: false,
            blocked: false,
            status: null,
            latencyMs: Date.now() - started,
            note: `Tidak terjangkau: ${String(err?.message || err).slice(0, 120)}`,
        };
    }
}
/* Status kejujuran sumber: UI/agregator bisa membedakan
   "API kita mati" vs "sumbernya yang memblokir server ini". */
export async function probeSources() {
    return Promise.all([
        probe("otakudesu", otakudesuConfig.baseUrl),
        probe("kuramanime", kuramanimeConfig.baseUrl),
        probe("samehadaku", samehadakuConfig.baseUrl),
        probe("samehadaku-engine", `${samehadakuConfig.apiBaseUrl}/samehadaku/home`),
        probe("animekiid", "https://animekiid.com"),
    ]);
}
