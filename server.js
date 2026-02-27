import express from "express";
import path from "node:path";
import multer from "multer";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

import { computeFromState } from "./server/prompt_engine.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(helmet({ contentSecurityPolicy: false })); // CSP should be configured per deployment
app.use(cors({ origin: false })); // lock down behind your reverse proxy / same-origin
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 13 } });

const __filename = fileURLToPath(import.meta.url);
const publicDir = path.join(path.dirname(__filename), "public");
app.use(express.static(publicDir, { etag: false, maxAge: "0" }));

app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/api/ui/buttons", (req, res) => {
  res.sendFile(path.join(publicDir, "config", "ui-buttons.json"));
});

// --- API: prompt generation
app.post("/api/prompt", upload.array("images", 13), async (req, res) => {
  try {
    let state = {};
    if (req.is("application/json")) {
      state = req.body?.state ?? req.body ?? {};
    } else {
      const raw = req.body?.state;
      state = raw ? JSON.parse(raw) : {};
    }

    // Attach reference images metadata (width/height) if available
    const files = req.files ?? [];
    if (files.length) {
      state.referenceImages = [];
      for (const f of files) {
        let meta = {};
        try {
          const md = await sharp(f.buffer).metadata();
          meta.width = md.width;
          meta.height = md.height;
        } catch {
          // ignore metadata failures
        }
        state.referenceImages.push({
          name: f.originalname,
          width: meta.width,
          height: meta.height,
          description: "" // client can extend later
        });
      }
    } else {
      state.referenceImages = state.referenceImages ?? [];
    }

    const out = computeFromState(state);
    res.json({ prompt: out.prompt, json: out.json, warnings: [] });
  } catch (e) {
    res.status(400).json({ error: "Bad request", details: String(e?.message ?? e) });
  }
});

// --- API: compact (placeholder: trims whitespace)
app.post("/api/compact", (req, res) => {
  const prompt = String(req.body?.prompt ?? "");
  const compacted = prompt.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  res.json({ prompt: compacted });
});

// --- API: translate via MyMemory (same as client, server-side)
app.post("/api/translate", async (req, res) => {
  try {
    const text = String(req.body?.text ?? "").trim();
    const to = String(req.body?.to ?? "en").trim();
    if (!text) return res.status(400).json({ error: "Empty text" });

    // MyMemory is free but rate-limited; you should swap to a paid provider if needed.
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", `ru|${to}`);

    const r = await fetch(url.toString(), { method: "GET" });
    if (!r.ok) {
      return res.status(502).json({ error: "Translate upstream failed", status: r.status });
    }
    const j = await r.json();
    const out = j?.responseData?.translatedText ?? "";
    res.json({ text: out || text });
  } catch (e) {
    res.status(500).json({ error: "Translate failed", details: String(e?.message ?? e) });
  }
});

// --- API: enhance (Customized/Detached)
app.post("/api/enhance", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  // Detached Groq logic. Returns text unchanged.
  res.json({ text });
});

// --- API: n8n forwarder (REMOVED)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
