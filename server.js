import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "mongo-mcp-client";
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "mongo-mcp-secret";
const BASE_URL = process.env.BASE_URL;

const validTokens = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Debug Middleware ────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Query:", JSON.stringify(req.query, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));
    next();
});

// ─── OAuth Metadata ──────────────────────────────────────────────
app.get("/.well-known/oauth-authorization-server", (req, res) => {
    console.log("[META] OAuth metadata requested");
    res.json({
        issuer: BASE_URL,
        authorization_endpoint: `${BASE_URL}/oauth/authorize`,
        token_endpoint: `${BASE_URL}/oauth/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
    });
});

// ─── Authorization endpoint ──────────────────────────────────────
app.get("/oauth/authorize", (req, res) => {
    const { redirect_uri, state, client_id } = req.query;
    console.log("[AUTH] Authorize called", { redirect_uri, state, client_id });

    if (!redirect_uri) {
        console.log("[AUTH] Missing redirect_uri");
        return res.status(400).json({ error: "missing redirect_uri" });
    }

    const code = uuidv4();
    validTokens.add(code);
    console.log("[AUTH] Generated code:", code);

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);

    console.log("[AUTH] Redirecting to:", redirectUrl.toString());
    res.redirect(redirectUrl.toString());
});

// ─── Token endpoint ──────────────────────────────────────────────
app.post("/oauth/token", (req, res) => {
    const { code, grant_type, client_id, client_secret } = req.body;
    console.log("[TOKEN] Token request", { code, grant_type, client_id, client_secret: client_secret ? "***" : undefined });
    console.log("[TOKEN] Expected CLIENT_ID:", CLIENT_ID);
    console.log("[TOKEN] Valid tokens:", [...validTokens]);

    if (client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
        console.log("[TOKEN] Invalid client credentials");
        return res.status(401).json({ error: "invalid_client" });
    }

    if (grant_type === "client_credentials") {
        const token = uuidv4();
        validTokens.add(token);
        console.log("[TOKEN] client_credentials token issued:", token);
        return res.json({
            access_token: token,
            token_type: "bearer",
            expires_in: 86400,
        });
    }

    if (grant_type === "authorization_code" && validTokens.has(code)) {
        validTokens.delete(code);
        const token = uuidv4();
        validTokens.add(token);
        console.log("[TOKEN] authorization_code token issued:", token);
        return res.json({
            access_token: token,
            token_type: "bearer",
            expires_in: 86400,
        });
    }

    console.log("[TOKEN] invalid_grant — code not found or wrong grant_type");
    res.status(401).json({ error: "invalid_grant" });
});

// ─── Auth Middleware ─────────────────────────────────────────────
const requireAuth = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];
    console.log("[MCP] Token received:", token);
    console.log("[MCP] Valid tokens:", [...validTokens]);

    if (!token || !validTokens.has(token)) {
        console.log("[MCP] Unauthorized");
        return res.status(401).json({ error: "unauthorized" });
    }
    next();
};

// ─── Proxy to MongoDB MCP ────────────────────────────────────────
app.use(
    "/mcp",
    requireAuth,
    createProxyMiddleware({
        target: "http://localhost:3001",
        changeOrigin: true,
        on: {
            error: (err, req, res) => {
                console.log("[PROXY] Error:", err.message);
                res.status(502).json({ error: "proxy error", detail: err.message });
            },
        },
    })
);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
    console.log(`OAuth proxy running on port ${PORT}`);
    console.log(`BASE_URL: ${BASE_URL}`);
    console.log(`CLIENT_ID: ${CLIENT_ID}`);
});