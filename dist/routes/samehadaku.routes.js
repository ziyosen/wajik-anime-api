import { Router } from "express";
import { serverCache } from "../middlewares/cache.js";
import samehadakuController from "../controllers/samehadaku.controller.js";
const samehadakuRouter = Router();
samehadakuRouter.get("/", samehadakuController.getRoot);
/* Search ditangani native oleh wajik lewat REST WordPress samehadaku.li;
   parser lama engine mengembalikan 404 untuk pencarian. */
samehadakuRouter.get("/search", serverCache(10), samehadakuController.searchNative);
/* Semua sub-route Samehadaku lain yang dipakai UI (home, anime, schedule,
   genres, batch, anime/:id, episode/:id, server/:id, ...) */
samehadakuRouter.use(serverCache(5), samehadakuController.proxy);
export default samehadakuRouter;
