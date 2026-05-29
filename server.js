import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || "mongo-mcp-client";
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "mongo-mcp-secret";
const BASE_URL = process.env.BASE_URL;

const validTokens = new Set();

// ─── Start MongoDB MCP server as child process ───────────────────
const mcpProcess = spawn("mongodb-mcp-server", ["--transport", "http", "--port", "3001"], {
    env: { ...process.env },
    stdio: "inherit",
});

mcpProcess.on("error", (err) => {
    console.error("[MCP PROCESS] Failed to start:", err.message);
});

mcpProcess.on("exit", (code) => {
    console.error("[MCP PROCESS] Exited with code:", code);
});

console.log("[MCP PROCESS] Started MongoDB MCP server on port 3001");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Debug Middleware ────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// ─── OAuth Protected Resource Metadata (Claude requires this) ────
app.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.json({
        resource: BASE_URL,
        authorization_servers: [BASE_URL],
    });
});

app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
    res.json({
        resource: `${BASE_URL}/mcp`,
        authorization_servers: [BASE_URL],
    });
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
        return res.status(400).json({ error: "missing redirect_uri" });
    }

    const code = uuidv4();
    validTokens.add(code);
    console.log("[AUTH] Generated code:", code);

    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);

    res.redirect(redirectUrl.toString());
});

// ─── Token endpoint ──────────────────────────────────────────────
app.post("/oauth/token", (req, res) => {
    const { code, grant_type, client_id, client_secret } = req.body;
    console.log("[TOKEN] Token request", { code, grant_type, client_id });

    if (client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
        console.log("[TOKEN] Invalid client credentials");
        return res.status(401).json({ error: "invalid_client" });
    }

    if (grant_type === "client_credentials") {
        const token = uuidv4();
        validTokens.add(token);
        console.log("[TOKEN] client_credentials token issued");
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
        console.log("[TOKEN] authorization_code token issued");
        return res.json({
            access_token: token,
            token_type: "bearer",
            expires_in: 86400,
        });
    }

    console.log("[TOKEN] invalid_grant");
    res.status(401).json({ error: "invalid_grant" });
});

// ─── Auth Middleware ─────────────────────────────────────────────
const requireAuth = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];
    console.log("[MCP] Token received:", token);

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