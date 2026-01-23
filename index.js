// index.js (EXP BOT ONLY) — License keys (one-key-per-placeId) + EXP rank sync routes (setrank/promote)
// ✅ Removed: gamepass route, rate limit, axios, Cronitor, extra safety wrappers
// ✅ Keep it SIMPLE + separated for EXP bot only

const express = require("express");
const rbx = require("noblox.js");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

//======================================================
// **ENV**
//======================================================
const COOKIE = process.env.COOKIE;
if (!COOKIE) {
  console.error("❌ Missing COOKIE in environment variables");
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
// NOTE: Restart clears bindings.
const KEY_BINDINGS = new Map();

function validateKeyForPlace(key, placeId) {
  if (!Number.isFinite(placeId) || placeId <= 0) return { ok: false, reason: "MISSING_PLACEID" };
  if (typeof key !== "string" || key.trim() === "") return { ok: false, reason: "EMPTY_KEY" };
  if (!VALID_KEYS.has(key)) return { ok: false, reason: "INVALID_KEY" };

  const bound = KEY_BINDINGS.get(key);

  if (!bound) {
    KEY_BINDINGS.set(key, placeId);
    console.log(`🔐 Key bound to PlaceId ${placeId}`);
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
// **BOOT**
//======================================================
rbx
  .setCookie(COOKIE)
  .then(() => {
    console.log("✅ Logged in to Roblox");

    app.get("/", (req, res) => {
      res.send("EXP Ranker is alive!");
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
    // **/setrank** (LICENSE PROTECTED)
    //==================================================
    app.get("/setrank", async (req, res) => {
      if (!requireLicense(req, res)) return;

      const userId = parseInt(req.query.userid, 10);
      const rank = parseInt(req.query.rank, 10);
      const groupId = parseInt(req.query.groupid, 10);

      if (!Number.isFinite(userId) || !Number.isFinite(rank) || !Number.isFinite(groupId)) {
        return res.status(400).json({ ok: false, error: "BAD_PARAMS" });
      }

      try {
        await rbx.setRank(groupId, userId, rank);
        return res.json({ ok: true, success: true });
      } catch (err) {
        console.error("❌ Failed to set rank:", err);
        return res.status(500).json({ ok: false, error: "SETRANK_FAILED", message: err.message });
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
        await rbx.promote(groupId, userId);
        return res.json({ ok: true, success: true });
      } catch (err) {
        console.error("❌ Failed to promote:", err);
        return res.status(500).json({ ok: false, error: "PROMOTE_FAILED", message: err.message });
      }
    });

    //==================================================
    // **START**
    //==================================================
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to log in with cookie:", err);
    process.exit(1);
  });
