// index.js (EXP BOT ONLY) — License keys (one-key-per-placeId) + EXP rank sync route (SETRANK ONLY)
// ✅ Removed: /promote, gamepass route, rate limit, axios, Cronitor, extra wrappers
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
// NOTE: Restart clears bindings.
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
// **OPTIONAL BOT-SIDE SYNC COOLDOWN** (anti-spam safety)
// Server should still enforce cooldown, this is just a backup.
const LAST_SYNC_AT = new Map(); // `${placeId}:${groupId}:${userId}` -> ms
const BOT_SYNC_COOLDOWN_MS = 1500; // 1.5s (tiny, just blocks accidental spam)

//======================================================
// **BOOT**
//======================================================
rbx
  .setCookie(COOKIE)
  .then(() => {
    console.log("✅ Logged in to Roblox");

    app.get("/", (req, res) => {
      res.send("EXP Bot is alive!");
    });

    //==================================================
    // **/validate** (license bind on boot)
    // Roblox calls this once when the server boots
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

      // small extra info for debugging (doesn't break anything)
      return res.json({ ok: true, boundPlaceId: placeId });
    });

    //==================================================
    // **/setrank** (LICENSE PROTECTED) — EXP -> GROUP RANK SYNC
    // Works for BOTH promotion + demotion (lower rank is allowed)
    //==================================================
    app.get("/setrank", async (req, res) => {
      const lic = requireLicense(req, res);
      if (!lic) return;

      const userId = Number(req.query.userid);
      const rank = Number(req.query.rank);
      const groupId = Number(req.query.groupid);

      // **PARAM GUARD**
      if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ ok: false, error: "BAD_USERID" });
      if (!Number.isFinite(groupId) || groupId <= 0) return res.status(400).json({ ok: false, error: "BAD_GROUPID" });

      // Allow rank 0? Roblox setRank expects 1..255 usually. Keep your old behavior: rank must be > 0.
      if (!Number.isFinite(rank) || rank <= 0) return res.status(400).json({ ok: false, error: "BAD_RANK" });

      // extra guard: Roblox group ranks are 1..255 (safe clamp check, not rewriting your logic)
      if (rank > 255) return res.status(400).json({ ok: false, error: "RANK_TOO_HIGH" });

      // bot-side spam shield
      const k = `${lic.placeId}:${groupId}:${userId}`;
      const now = Date.now();
      const last = LAST_SYNC_AT.get(k) || 0;
      if (now - last < BOT_SYNC_COOLDOWN_MS) {
        return res.status(429).json({ ok: false, error: "BOT_COOLDOWN" });
      }
      LAST_SYNC_AT.set(k, now);

      // log every setrank (helps you confirm demotion calls)
      console.log(`📌 /setrank placeId=${lic.placeId} groupId=${groupId} userId=${userId} -> rank=${rank}`);

      try {
        await rbx.setRank(groupId, userId, rank);
        return res.json({ ok: true, success: true });
      } catch (err) {
        console.error("❌ Failed to set rank:", err);
        return res.status(500).json({
          ok: false,
          error: "SETRANK_FAILED",
          message: err?.message || String(err),
        });
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
