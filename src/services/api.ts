import express from "express";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { curveConfig, runtimeConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

const dataFilePath = () =>
  path.join(process.cwd(), "data", `${curveConfig.pool.address}.ndjson`);

export const createApp = () => {
  const app = express();

  app.get("/health", (req, res) => {
    try {
      const filePath = dataFilePath();
      if (!fs.existsSync(filePath)) {
        return res.json({ ok: false, message: "no samples yet" });
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) {
        return res.json({ ok: false, message: "samples file empty" });
      }
      const lines = content.split("\n");
      const latest = JSON.parse(lines[lines.length - 1] ?? "{}");
      return res.json({ ok: true, latest });
    } catch (error) {
      logger.error({ err: error }, "health endpoint failure");
      return res.status(500).json({ ok: false, error: String(error) });
    }
  });

  return app;
};

export const startApi = () => {
  const app = createApp();
  app.listen(runtimeConfig.httpPort, () => {
    logger.info(
      { port: runtimeConfig.httpPort },
      "HTTP API listening for health checks"
    );
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApi();
}
