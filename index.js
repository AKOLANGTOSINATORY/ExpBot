// index.js (FULL) — License keys (one-key-per-placeId) + ranker/promote + ranker-gamepass (no license)
// + Cronitor heartbeat (optional) + hard safety (rate limit + timeouts) for multi-group usage

const express = require("express");
const rbx = require("noblox.js");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();

const app = express();

//======================================================
// **ENV**
//======================================================
const COOKIE = process.env.COOKIE;

// **CRONITOR** (optional)
const CRONITOR_PING_URL = process.env.CRONITOR_PING_URL || ""; // ex: https://cronitor.link/p/xxxxxxxx
const CRONITOR_INTERVAL_SEC = Number(process.env.CRONITOR_INTERVAL_SEC || 60);

// **RATE LIMIT**
const MAX_REQ_PER_MIN = Number(process.env.MAX_REQ_PER_MIN || 120);

// **REQUEST TIMEOUT**
const ACTION_TIMEOUT_MS = Number(process.env.ACTION_TIMEOUT_MS || 12000);

if (!COOKIE) {
  console.error("❌ Missing **COOKIE** in environment variables");
  process.exit(1);
}

//======================================================
// **LICENSE SYSTEM**
//======================================================
const VALID_KEYS = new Set([
  "9e2c7b4f1a6d0e8f5c3b9a4d7e1f2c8b6a5",
  "f3a9e1c6d7b0f5e8a2c4b9d1e6f7a3c8b5",
  "6f1e9b3a7d5c8e0f4a2b6d9c1e7f5a8b3",
  "c7b1a9f6e4d8c5f0a2b3e7d1f9a6c8e4",
  "8a5e2d9c1f6b4a7e0f3c8d5b9f1a6e4c2",
  "e4b9f0a7c6d1e8f5a3b2c9d4f7a1e6c8",
  "5c8e1f4a9d6b0c2e7f3a5b8d1c9f6e4",
  "a0f6c9e2b5d8a1f7c4e3b9d6f5a8c2",
  "d9c2f6e1a8b7d4f0c5e9a3b6c8f1e7",
  "1f8c6b9e4a0d5f7c2e3b1a9d6f8c4e",
]);

// In-memory bindings: **key -> placeId**
// Note: restart clears bindings.
const KEY_BINDINGS = new Map();

function validateKeyForPlace(key, placeId) {
  if (!Number.isFinite(placeId) || placeId <= 0) return { ok: false, reason: "MISSING_PLACEID" };
  if (typeof key !== "string" || key.trim() === "") return { ok: false, reason: "EMPTY_KEY" };
  if (!VALID_KEYS.has(key)) return { ok: false, reason: "INVALID_KEY" };

  const bound = KEY_BINDINGS.get(key);

  if (!bound) {
    KEY_BINDINGS.set(key, placeId);
    console.log(`🔐 Key bound to **PlaceId ${placeId}**`);
    return { ok: true };
  }

  if (bound !== placeId) return { ok: false, reason: "KEY_ALREADY_USED" };
  return { ok: true };
}

function requireLicense(req, res) {
  const key = String(req.query.key ?? "");
  const placeId = Number(req.query.placeid);

  const result = validateKeyForPlace(key, placeId);
  if (!result.ok) {
    res.status(result.reason === "MISSING_PLACEID" ? 400 : 403).json({
      ok: false,
      error: result.reason,
    });
    return null;
  }

  return { key, placeId };
}

//======================================================
// **HARD SAFETY** (simple in-memory rate limiter)
//======================================================
const RL_BUCKET = new Map(); // ip -> { count, resetAt }

function rateLimit(req, res, next) {
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const now = Date.now();
  const resetEvery = 60_000;

  let b = RL_BUCKET.get(ip);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + resetEvery };
    RL_BUCKET.set(ip, b);
  }

  b.count += 1;

  if (b.count > MAX_REQ_PER_MIN) {
    return res.status(429).json({
      ok: false,
      error: "RATE_LIMIT",
      message: "Too many requests. Slow down.",
    });
  }

  next();
}

app.use(rateLimit);

//======================================================
// **UTIL** timeout wrapper
//======================================================
function withTimeout(promise, ms, label = "ACTION") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

//======================================================
// **CRONITOR** heartbeat (optional)
//======================================================
async function pingCronitor() {
  if (!CRONITOR_PING_URL) return;
  try {
    await axios.get(CRONITOR_PING_URL, { timeout: 8000 });
    // keep logs light
  } catch (e) {
    console.warn("⚠️ Cronitor ping failed:", e?.message || e);
  }
}

setInterval(() => {
  pingCronitor();
}, Math.max(15, CRONITOR_INTERVAL_SEC) * 1000);

//======================================================
// **BOOT**
//======================================================
rbx
  .setCookie(COOKIE)
  .then(() => {
    console.log("✅ Logged in to Roblox");

    // quick startup ping
    pingCronitor();

    app.get("/", (req, res) => {
      res.send("Roblox Ranker is alive!");
    });

    //==================================================
    // **/validate** (license bind on boot)
    //==================================================
    app.get("/validate", (req, res) => {
      const key = String(req.query.key ?? "");
      const placeId = Number(req.query.placeid);

      const result = validateKeyForPlace(key, placeId);
      if (!result.ok) {
        return res.status(result.reason === "MISSING_PLACEID" ? 400 : 403).json({
          ok: false,
          error: result.reason,
        });
      }

      return res.json({ ok: true });
    });

    //==================================================
    // **/ranker** (LICENSE PROTECTED)
    //==================================================
    app.get("/ranker", async (req, res) => {
      if (!requireLicense(req, res)) return;

      const userId = parseInt(req.query.userid, 10);
      const rank = parseInt(req.query.rank, 10);
      const groupId = parseInt(req.query.groupid, 10);

      if (!Number.isFinite(userId) || !Number.isFinite(rank) || !Number.isFinite(groupId)) {
        return res.status(400).json({ ok: false, error: "BAD_PARAMS" });
      }

      try {
        await withTimeout(rbx.setRank(groupId, userId, rank), ACTION_TIMEOUT_MS, "SETRANK");
        return res.json({ ok: true, success: true, message: `Ranked user ${userId} in group ${groupId}` });
      } catch (err) {
        console.error("❌ Failed to rank:", err);
        return res.status(500).json({ ok: false, error: "RANK_FAILED", message: err.message });
      }
    });

    //==================================================
    // **/promote** (LICENSE PROTECTED)
    //==================================================
    app.get("/promote", async (req, res) => {
      if (!requireLicense(req, res)) return;

      const userId = parseInt(req.query.userid, 10);
      const groupId = parseInt(req.query.groupid, 10);

      if (!Number.isFinite(userId) || !Number.isFinite(groupId)) {
        return res.status(400).json({ ok: false, error: "BAD_PARAMS" });
      }

      try {
        await withTimeout(rbx.promote(groupId, userId), ACTION_TIMEOUT_MS, "PROMOTE");
        return res.json({ ok: true, success: true, message: `Promoted user ${userId} in group ${groupId}` });
      } catch (err) {
        console.error("❌ Failed to promote:", err);
        return res.status(500).json({ ok: false, error: "PROMOTE_FAILED", message: err.message });
      }
    });

    //==================================================
    // **/ranker-gamepass** (NO LICENSE)
    //==================================================
    app.get("/ranker-gamepass", async (req, res) => {
      const userId = parseInt(req.query.userid, 10);
      const rank = parseInt(req.query.rank, 10);
      const groupId = parseInt(req.query.groupid, 10);

      if (!Number.isFinite(userId) || !Number.isFinite(rank) || !Number.isFinite(groupId)) {
        return res.status(400).json({ ok: false, error: "BAD_PARAMS" });
      }

      try {
        await withTimeout(rbx.setRank(groupId, userId, rank), ACTION_TIMEOUT_MS, "SETRANK_GP");
        return res.json({ ok: true, success: true, message: "Ranked via gamepass system" });
      } catch (err) {
        console.error("❌ Gamepass rank failed:", err);
        return res.status(500).json({ ok: false, error: "GAMEPASS_RANK_FAILED", message: err.message });
      }
    });

    //==================================================
    // **START**
    //==================================================
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port **${PORT}**`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to log in with cookie:", err);
    process.exit(1);
  });
