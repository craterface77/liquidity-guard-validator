import express from "express";
import fs from "fs";
import path from "path";
import { POOL_ADDRESS, PORT } from "./config";

const app = express();

app.get("/health", (req, res) => {
  try {
    const p = path.join(process.cwd(), "data", `${POOL_ADDRESS}.ndjson`);
    if (!fs.existsSync(p)) return res.json({ ok: false, msg: "no data yet" });
    const lines = fs.readFileSync(p, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    res.json({ ok: true, latest: last });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log("API listening on", PORT));
