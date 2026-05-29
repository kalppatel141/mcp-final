import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "mongo-mcp-client";
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "mongo-mcp-secret";
const BASE_URL = process.env.BASE_URL; // your Railway public URL

// Store valid tokens in memory
const validTokens = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── OAuth Endpoints ────────────────────────────────────────────

// 1. Authorization endpoint — Claude hits this first
app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state } = req.query;
    const code = uuidv4();

    // Store code temporarily (in prod use Redis/DB)
    validTokens.add(code);

    // Redirect back to Claude with the code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);

    res.redirect(redirectUrl.toString());
});

// 2. Token exchange endpoint — Claude exchanges code for token
app.post("/oauth/token", (req, res) => {
    const { code, grant_type, client_id, client_secret } = req.body;

    if (grant_type === "client_credentials" || validTokens.has(code)) {
        validTokens.delete(code);
        const token = uuidv4();
        validTokens.add(token);

        return res.json({
            access_token: token,
            token_type: "bearer",
            expires_in: 86400,
        });
    }

    res.status(401).json({ error: "invalid_grant" });
});

// 3. OAuth metadata — Claude discovers your OAuth config here
app.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.json({
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/oauth/authorize`,
        token_endpoint: `${BASE_URL}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
    });
});

// ─── Auth Middleware ─────────────────────────────────────────────

const requireAuth = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];

    if (!token || !validTokens.has(token)) {
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
};

// ─── Proxy to MongoDB MCP ────────────────────────────────────────

// Protected /mcp route — proxies to the actual MCP server
app.use(
    "/mcp",
    requireAuth,
    createProxyMiddleware({
        target: "http://localhost:3001", // MCP server runs on 3001
        changeOrigin: true,
    })
);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
    console.log(`OAuth proxy running on port ${PORT}`);
});