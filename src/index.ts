import { clientCache } from "@middlewares/cache.js";
import appConfig from "@configs/app.config.js";
import express from "express";
import errorHandler from "@middlewares/errorHandler.js";
import otakudesuRouter from "@routes/otakudesu.routes.js";
import samehadakuRouter from "@routes/samehadaku.routes.js";
import animekiidRouter from "@routes/animekiid.routes.js";
import kuramanimeRouter from "@routes/kuramanime.routes.js";
import catalogRouter from "@routes/catalog.routes.js";
import setPayload from "@helpers/setPayload.js";
import { probeSources } from "@helpers/sourceStatus.js";
import cors from "cors";

const { PORT } = appConfig;
const app = express();

app.use(cors());
app.use(clientCache(1));

app.get("/", (req, res) => {
  const routes: IRouteData[] = [
    {
      method: "GET",
      path: "/otakudesu",
      description: "Otakudesu",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/kuramanime",
      description: "Kuramanime",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/samehadaku",
      description: "Samehadaku (engine bellonime ditampung wajik)",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/sumber/status",
      description: "Status jangkauan tiap sumber dari server ini",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/katalog",
      description: "Katalog gabungan anti-dobel lintas sumber",
      pathParams: [],
      queryParams: [],
    },
    {
      method: "GET",
      path: "/animekiid",
      description: "Animekiid (native animekiid.com)",
      pathParams: [],
      queryParams: [],
    },
  ];

  res.json(
    setPayload(res, {
      data: { routes },
    })
  );
});

app.get("/sumber/status", async (req, res, next) => {
  try {
    const sources = await probeSources();
    res.json(setPayload(res, { data: { sources } }));
  } catch (err) {
    next(err);
  }
});

app.use("/otakudesu", otakudesuRouter);
app.use("/kuramanime", kuramanimeRouter);
app.use("/samehadaku", samehadakuRouter);
app.use("/animekiid", animekiidRouter);
app.use("/katalog", catalogRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`server is running on http://localhost:${PORT}`);
});
