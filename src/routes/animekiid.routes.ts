import { Router } from "express";
import { serverCache } from "@middlewares/cache.js";
import animekiidController from "@controllers/animekiid.controller.js";

const animekiidRouter = Router();

animekiidRouter.get("/", animekiidController.getRoot);
animekiidRouter.get("/home", serverCache(10), animekiidController.home);
animekiidRouter.get("/search", serverCache(10), animekiidController.search);
animekiidRouter.get("/ongoing", serverCache(10), animekiidController.ongoing);
animekiidRouter.get("/completed", serverCache(10), animekiidController.completed);
animekiidRouter.get("/popular", serverCache(10), animekiidController.popular);
animekiidRouter.get("/movies", serverCache(10), animekiidController.movies);
animekiidRouter.get("/genres", serverCache(30), animekiidController.genres);
animekiidRouter.get("/genres/:genreId", serverCache(10), animekiidController.genreAnimes);
animekiidRouter.get("/anime/:animeId", serverCache(10), animekiidController.animeDetails);
animekiidRouter.get("/episode/:episodeId", serverCache(10), animekiidController.episodeDetails);

export default animekiidRouter;
