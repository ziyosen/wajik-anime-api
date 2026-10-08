import { Router } from "express";
import { serverCache } from "@middlewares/cache.js";
import samehadakuController from "@controllers/samehadaku.controller.js";

const samehadakuRouter = Router();

samehadakuRouter.get("/", samehadakuController.getRoot);
/* Semua sub-route Samehadaku yang dipakai UI (home, anime, schedule,
   search, genres, batch, anime/:id, episode/:id, server/:id, ...) */
samehadakuRouter.use(serverCache(5), samehadakuController.proxy);

export default samehadakuRouter;
