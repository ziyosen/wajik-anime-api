import { Router } from "express";
import { serverCache } from "../middlewares/cache.js";
import samehadakuController from "../controllers/samehadaku.controller.js";
const samehadakuRouter = Router();
samehadakuRouter.get("/", samehadakuController.getRoot);
/* Route native samehadaku.li (riset 2026-10-08):
   Search, daftar ongoing/completed/popular/movies, genre, dan detail
   anime dibaca langsung dari samehadaku.li karena parser engine lama
   membalas 404 untuk halaman-halaman itu. Route lain masih diteruskan
   ke engine bellonime sampai parser episodenya selesai diporting. */
samehadakuRouter.get("/search", serverCache(10), samehadakuController.searchNative);
samehadakuRouter.get("/ongoing", serverCache(10), samehadakuController.ongoingNative);
samehadakuRouter.get("/completed", serverCache(10), samehadakuController.completedNative);
samehadakuRouter.get("/popular", serverCache(10), samehadakuController.popularNative);
samehadakuRouter.get("/movies", serverCache(10), samehadakuController.moviesNative);
samehadakuRouter.get("/genres", serverCache(30), samehadakuController.genresNative);
samehadakuRouter.get("/genres/:genreId", serverCache(10), samehadakuController.genreAnimesNative);
samehadakuRouter.get("/anime/:animeId", serverCache(10), samehadakuController.animeDetailsNative);
/* Sisa sub-route yang masih memakai engine (home, anime list, recent,
   schedule, batch, episode/:id, server/:id, ...). */
samehadakuRouter.use(serverCache(5), samehadakuController.proxy);
export default samehadakuRouter;
