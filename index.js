// index.js (EXP BOT ONLY) — License keys (one-key-per-placeId) + EXP rank sync route (OPEN CLOUD V2)
// ✅ NO COOKIES, NO NOBLOX.JS!

const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();
const app = express();
app.use(express.json());

//======================================================
// **ENV**
//======================================================
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;

if (!ROBLOX_API_KEY) {
    console.error("❌ Missing **ROBLOX_API_KEY** in environment variables");
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
        res.status(result.reason === "MISSING_PLACEID" ? 400 : 403).json({ ok: false, error: result.reason });
        return null;
    }
    return { key, placeId };
}

//======================================================
// OPTIONAL BOT-SIDE SYNC COOLDOWN
//======================================================
const LAST_SYNC_AT = new Map(); 
const BOT_SYNC_COOLDOWN_MS = 0; 

function inCooldown(k) {
    if (BOT_SYNC_COOLDOWN_MS <= 0) return false;
    const now = Date.now();
    const last = LAST_SYNC_AT.get(k) || 0;
    if (now - last < BOT_SYNC_COOLDOWN_MS) return true;
    LAST_SYNC_AT.set(k, now);
    return false;
}

//======================================================
// Group roles cache
//======================================================
const ROLE_CACHE = new Map();
const ROLE_CACHE_TTL_MS = 60_000; 

async function getGroupRoles(groupId) {
    const now = Date.now();
    const cached = ROLE_CACHE.get(groupId);
    if (cached && cached.expiresAt > now) return cached.roles;

    try {
        const response = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
        const roles = response.data.roles;
        ROLE_CACHE.set(groupId, { roles, expiresAt: now + ROLE_CACHE_TTL_MS });
        return roles;
    } catch (error) {
        throw new Error("FAILED_TO_FETCH_ROLES");
    }
}

//======================================================
// Helpers
//======================================================
function jsonError(res, status, error, extra = {}) {
    return res.status(status).json({ ok: false, error, ...extra });
}

//======================================================
// **BOOT**
//======================================================

app.get("/", (req, res) => {
    res.send("EXP Bot (Open Cloud Edition) is alive!");
});

app.get("/validate", (req, res) => {
    const key = String(req.query.key ?? "");
    const placeId = Number(req.query.placeid);
    const result = validateKeyForPlace(key, placeId);
    if (!result.ok) {
        return res.status(result.reason === "MISSING_PLACEID" ? 400 : 403).json({ ok: false, error: result.reason });
    }
    return res.json({ ok: true, boundPlaceId: placeId });
});

app.get("/setrank", async (req, res) => {
    const lic = requireLicense(req, res);
    if (!lic) return;

    const userId = Number(req.query.userid);
    const rank = Number(req.query.rank);
    const groupId = Number(req.query.groupid);

    if (!Number.isFinite(userId) || userId <= 0) return jsonError(res, 400, "BAD_USERID");
    if (!Number.isFinite(groupId) || groupId <= 0) return jsonError(res, 400, "BAD_GROUPID");
    if (!Number.isFinite(rank) || rank <= 0) return jsonError(res, 400, "BAD_RANK");
    if (rank > 255) return jsonError(res, 400, "RANK_TOO_HIGH");

    const k = `${lic.placeId}:${groupId}:${userId}`;
    if (inCooldown(k)) {
        return res.status(429).json({ ok: false, error: "BOT_COOLDOWN" });
    }

    try {
        // 1) Fetch roles and translate 0-255 Rank to actual Role ID
        const roles = await getGroupRoles(groupId);
        const targetRole = roles.find(r => r.rank === rank);

        if (!targetRole) {
            return jsonError(res, 400, "ROLE_NOT_FOUND", { rank });
        }

        const rolePath = `groups/${groupId}/roles/${targetRole.id}`;
        const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/memberships/${userId}`;

        // 2) PRE-CHECK: Is the user already this role? (Prevents HTTP 400 Spam)
        try {
            const currentMembership = await axios.get(url, { headers: { "x-api-key": ROBLOX_API_KEY } });
            if (currentMembership.data && currentMembership.data.role === rolePath) {
                console.log(`⚡ User ${userId} is already Rank ${rank}. Skipping request.`);
                return res.json({ ok: true, success: true, ignored: "SAME_ROLE" });
            }
        } catch (checkErr) {
            // Ignore GET errors, let PATCH handle real issues
        }

        // 3) Open Cloud V2 Rank Change Request
        await axios.patch(url, 
            { role: rolePath }, 
            {
                headers: {
                    "x-api-key": ROBLOX_API_KEY,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log(`✅ Success: User ${userId} ranked up to ${targetRole.name}`);
        return res.json({ ok: true, success: true, message: "Rank updated", targetRole: targetRole.name });

    } catch (err) {
        const errorData = err.response?.data || err.message;
        const status = err.response?.status || 500;

        // If Open Cloud still throws a 400 for some other reason, gently return 200 to Lua so it stops looping
        if (status === 400) {
            return res.json({ ok: true, success: true, ignored: "ROBLOX_400_HANDLED" });
        }
        
        if (status === 403) {
            return jsonError(res, 403, "PERMISSION_DENIED", { details: "API Key lacks permissions." });
        }

        console.error("❌ Failed to set rank:", errorData);
        return res.status(status).json({
            ok: false,
            error: "SETRANK_FAILED",
            message: errorData,
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Open Cloud EXPBOT running on port **${PORT}**`);
});
