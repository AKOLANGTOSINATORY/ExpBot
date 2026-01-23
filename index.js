// index.js (EXP BOT ONLY) — License keys (one-key-per-placeId) + EXP rank sync route (SETRANK ONLY)
// ✅ Handles: same role, role not found, bot insufficient permissions, demote+promote fast
// ✅ Keep it SIMPLE + EXP bot only

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
// OPTIONAL BOT-SIDE SYNC COOLDOWN (set to 0 to feel instant)
//======================================================
const LAST_SYNC_AT = new Map(); // `${placeId}:${groupId}:${userId}` -> ms
const BOT_SYNC_COOLDOWN_MS = 0; // ✅ set 0 for no delay (recommended)

function inCooldown(k) {
  if (BOT_SYNC_COOLDOWN_MS <= 0) return false;
  const now = Date.now();
  const last = LAST_SYNC_AT.get(k) || 0;
  if (now - last < BOT_SYNC_COOLDOWN_MS) return true;
  LAST_SYNC_AT.set(k, now);
  return false;
}

//======================================================
// BOT ID (from cookie session)
//======================================================
let BOT_USER_ID = null;

//======================================================
// Group roles cache: groupId -> { ranks:Set<number>, expiresAt:number }
//======================================================
const ROLE_CACHE = new Map();
const ROLE_CACHE_TTL_MS = 60_000; // 60s

async function getGroupRanks(groupId) {
  const now = Date.now();
  const cached = ROLE_CACHE.get(groupId);
  if (cached && cached.expiresAt > now) return cached.ranks;

  const roles = await rbx.getRoles(groupId); // [{id,name,rank,...}]
  const ranks = new Set();
  for (const r of roles) ranks.add(Number(r.rank));

  ROLE_CACHE.set(groupId, { ranks, expiresAt: now + ROLE_CACHE_TTL_MS });
  return ranks;
}

//======================================================
// Helpers
//======================================================
function jsonError(res, status, error, extra = {}) {
  return res.status(status).json({ ok: false, error, ...extra });
}

function isSameRoleErrorMessage(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("cannot change the user's role to the same role") || s.includes("same role");
}

function isRoleNotFoundMessage(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("role not found");
}

function isPermissionMessage(msg) {
  const s = String(msg || "").toLowerCase();
  return (
    s.includes("not authorized") ||
    s.includes("not permitted") ||
    s.includes("forbidden") ||
    s.includes("does not have permission") ||
    s.includes("insufficient")
  );
}

//======================================================
// **BOOT**
//======================================================
rbx
  .setCookie(COOKIE)
  .then(async () => {
    console.log("✅ Logged in to Roblox");

    // Identify bot user id
    const me = await rbx.getCurrentUser();
    BOT_USER_ID = Number(me?.UserID || me?.userId || me?.id);
    console.log(`🤖 Bot UserId = ${BOT_USER_ID}`);

    app.get("/", (req, res) => {
      res.send("EXP Bot is alive!");
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

      return res.json({ ok: true, boundPlaceId: placeId });
    });

    //==================================================
    // **/setrank** (LICENSE PROTECTED) — EXP -> GROUP RANK SYNC
    // Works for BOTH promotion + demotion
    //==================================================
    app.get("/setrank", async (req, res) => {
      const lic = requireLicense(req, res);
      if (!lic) return;

      const userId = Number(req.query.userid);
      const rank = Number(req.query.rank);
      const groupId = Number(req.query.groupid);

      // PARAM GUARD
      if (!Number.isFinite(userId) || userId <= 0) return jsonError(res, 400, "BAD_USERID");
      if (!Number.isFinite(groupId) || groupId <= 0) return jsonError(res, 400, "BAD_GROUPID");
      if (!Number.isFinite(rank) || rank <= 0) return jsonError(res, 400, "BAD_RANK");
      if (rank > 255) return jsonError(res, 400, "RANK_TOO_HIGH");

      const k = `${lic.placeId}:${groupId}:${userId}`;
      if (inCooldown(k)) {
        return res.status(429).json({ ok: false, error: "BOT_COOLDOWN" });
      }

      console.log(`📌 /setrank placeId=${lic.placeId} groupId=${groupId} userId=${userId} -> rank=${rank}`);

      try {
        // 1) Validate requested rank exists in this group
        const validRanks = await getGroupRanks(groupId);
        if (!validRanks.has(rank)) {
          return jsonError(res, 400, "ROLE_NOT_FOUND", { rank });
        }

        // 2) Check bot's own rank in group (prevents "bot can't set same/higher")
        if (BOT_USER_ID) {
          const botRank = await rbx.getRankInGroup(groupId, BOT_USER_ID);
          // If rank is same or higher than bot, block.
          if (Number.isFinite(botRank) && botRank > 0 && rank >= botRank) {
            return jsonError(res, 403, "INSUFFICIENT_BOT_RANK", { botRank, requestedRank: rank });
          }
        }

        // 3) Check target current rank (avoid spam + "same role" errors)
        const currentRank = await rbx.getRankInGroup(groupId, userId);
        if (currentRank === rank) {
          return res.json({ ok: true, success: true, ignored: "SAME_ROLE" });
        }

        // 4) Apply
        await rbx.setRank(groupId, userId, rank);
        return res.json({ ok: true, success: true, from: currentRank, to: rank });
      } catch (err) {
        const msg = err?.message || String(err);

        // "ignore" common non-fatal cases (anti-crash)
        if (isSameRoleErrorMessage(msg)) {
          return res.json({ ok: true, success: true, ignored: "SAME_ROLE" });
        }
        if (isRoleNotFoundMessage(msg)) {
          return jsonError(res, 400, "ROLE_NOT_FOUND", { message: msg });
        }
        if (isPermissionMessage(msg)) {
          return jsonError(res, 403, "PERMISSION_DENIED", { message: msg });
        }

        console.error("❌ Failed to set rank:", err);
        return res.status(500).json({
          ok: false,
          error: "SETRANK_FAILED",
          message: msg,
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
