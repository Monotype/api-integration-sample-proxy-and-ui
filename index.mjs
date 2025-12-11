import express from 'express';
import path from 'path';
import session from 'express-session';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as readline from 'readline';

// Load environment variables
dotenv.config();

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8081;

const API_DOMAIN = process.env.API_DOMAIN || 'pp-api.monotype.com';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET; // REQUIRED for Auth Code flow
const AUTH0_SCOPE = 'openid email profile';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_LIFESPAN = 24 * 60 * 60 * 1000; // 24 hours in ms
const tokenUrl = `https://${API_DOMAIN}/v2/oauth/token`;

// Validate required environment variables
if (!AUTH0_CLIENT_SECRET) {
    console.error('ERROR: AUTH0_CLIENT_SECRET environment variable is required for Authorization Code flow');
    console.error('Please set AUTH0_CLIENT_SECRET in your .env file or environment variables');
    process.exit(1);
}

// Create and connect Redis client
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error:', err));

await redisClient.connect();
console.log('Connected to Redis');

// Set up Redis session store
const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'sess:',
});

// Session middleware
app.use(session({
    store: redisStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in prod with HTTPS
        httpOnly: true,
        maxAge: SESSION_LIFESPAN,
    }
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 2️⃣ Middleware for non-API requests
app.use((req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api')) return next();
    if (req.path.endsWith('.html')) return next();
    if (req.path.endsWith('/')) return next();
    return res.sendStatus(404);
});
// Serve static files
app.use(express.static(path.join(__dirname)));

// Routes

app.get('/api/authorize', (req, res) => {
    const redirectUri = req.query.redirect_uri;

    if (!redirectUri) {
        return res.status(400).json({ error: 'redirect_uri parameter is required' });
    }

    let authUrl = `https://${API_DOMAIN}/v2/oauth/authorize` +
        `?response_type=code` +
        `&client_id=${AUTH0_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(AUTH0_SCOPE)}`;
    if (req?.query?.accessToken) {
        authUrl += `&accessKey=${encodeURIComponent(req.query.accessToken)}`;
    }
    console.log('Redirecting to Auth0:', authUrl);
    res.redirect(authUrl);
});

app.post('/api/token', async (req, res) => {
    try {
        const body = {
            grant_type: 'authorization_code',
            code: req.body.code,
            redirect_uri: req.body.redirect_uri
        };
        const authCode = btoa(AUTH0_CLIENT_ID + ':' + AUTH0_CLIENT_SECRET);
        const formBody = new URLSearchParams(body).toString();
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${authCode}`
            },
            body: formBody
        });

        const tokenData = await response.json();
        console.log("Response from token URL:", tokenData);

        if (tokenData.access_token) {
            const accessToken = tokenData.access_token;
            const idToken = tokenData.id_token;
            const refreshToken = tokenData.refresh_token;
            const expiresIn = tokenData.expires_in || 3600;

            const sessionId = `session:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;

            // Store tokens & metadata in Redis
            await redisClient.setEx(`${sessionId}:access_token`, expiresIn, accessToken);
            if (idToken) await redisClient.setEx(`${sessionId}:id_token`, expiresIn, idToken);
            if (refreshToken) await redisClient.setEx(`${sessionId}:refresh_token`, expiresIn * 24, refreshToken);
            await redisClient.setEx(`${sessionId}:metadata`, expiresIn, JSON.stringify({
                created_at: new Date().toISOString(),
                expires_in: expiresIn,
                client_id: AUTH0_CLIENT_ID,
                user_code: req.body.code
            }));

            req.session.sessionId = sessionId;
            req.session.authenticated = true;
            req.session.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

            console.log(`Tokens stored in Redis with session ID: ${sessionId}`);
            res.json({
                success: true,
                message: "Token exchange successful",
                sessionId,
                expiresAt: req.session.tokenExpiry,
                hasAccessToken: !!accessToken,
                hasIdToken: !!idToken,
                hasRefreshToken: !!refreshToken
            });
        } else {
            res.status(400).json({
                success: false,
                message: "Token exchange failed",
                error: tokenData.error || 'Unknown error',
                error_description: tokenData.error_description
            });
        }
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error during token exchange",
            error: error.message
        });
    }
});

app.get('/api/session', async (req, res) => {
    if (!req.session.sessionId) {
        return res.json({ authenticated: false, message: 'No active session' });
    }

    try {
        const metadata = await redisClient.get(`${req.session.sessionId}:metadata`);
        const hasAccessToken = await redisClient.exists(`${req.session.sessionId}:access_token`);

        res.json({
            authenticated: req.session.authenticated,
            sessionId: req.session.sessionId,
            tokenExpiry: req.session.tokenExpiry,
            hasValidTokens: hasAccessToken === 1,
            metadata: metadata ? JSON.parse(metadata) : null
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check session status', message: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    if (req.session.sessionId) {
        try {
            await redisClient.del(`${req.session.sessionId}:access_token`);
            await redisClient.del(`${req.session.sessionId}:id_token`);
            await redisClient.del(`${req.session.sessionId}:refresh_token`);
            await redisClient.del(`${req.session.sessionId}:metadata`);
            console.log(`Cleaned up Redis data for session: ${req.session.sessionId}`);
        } catch (error) {
            console.error('Error cleaning up Redis data:', error);
        }
    }

    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to destroy session', message: err.message });
        }
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

app.use('/api/proxy', async (req, res) => {

    const subPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
    const proxyUrl = `https://${API_DOMAIN}/${subPath}`;

    // Sanitize req.method
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    let sanitizedMethod = String(req.method).toUpperCase();
    if (!allowedMethods.includes(sanitizedMethod)) {
        return res.status(405).json({ error: 'Method Not Allowed', message: `HTTP method ${req.method} is not allowed.` });
    }

    console.log(`${sanitizedMethod} request to proxy:`, proxyUrl);

    let accessToken = null;
    if (req.session.sessionId) {
        try {
            accessToken = await redisClient.get(`${req.session.sessionId}:access_token`);

            if (!accessToken || isTokenExpired(accessToken)) {
                const refreshToken = await redisClient.get(`${req.session.sessionId}:refresh_token`);
                if (refreshToken) {
                    // Attempt to refresh token from Auth0
                    const refreshBody = {
                        grant_type: 'refresh_token',
                        client_id: AUTH0_CLIENT_ID,
                        client_secret: AUTH0_CLIENT_SECRET,
                        refresh_token: refreshToken
                    };
                    const formBody = new URLSearchParams(refreshBody).toString();
                    const refreshResponse = await fetch(tokenUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'x-client-id': AUTH0_CLIENT_ID,

                        },
                        body: formBody
                    });
                    const refreshData = await refreshResponse.json();
                    console.log('Refresh token response:', refreshData);

                    if (refreshData.access_token) {
                        accessToken = refreshData.access_token;
                        const decoded = jwt.decode(accessToken);
                        let expiresIn = refreshData.expires_in || 3600;
                        if (decoded && decoded.exp) {
                            const currentTime = Math.floor(Date.now() / 1000);
                            expiresIn = decoded.exp - currentTime;
                        }
                        await redisClient.setEx(`${req.session.sessionId}:access_token`, expiresIn, accessToken);

                        req.session.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

                        if (refreshData.refresh_token) {
                            await redisClient.setEx(`${req.session.sessionId}:refresh_token`, expiresIn * 24, refreshData.refresh_token);
                        }
                    } else {
                        return res.status(401).json({ error: 'Authentication failed', message: 'Unable to refresh expired token' });
                    }
                } else {
                    return res.status(401).json({ error: 'Authentication required', message: 'No valid tokens available. Please log in again.' });
                }
            }
        } catch (error) {
            console.error('Error getting access token from Redis:', error);
            return res.status(500).json({ error: 'Session error', message: 'Failed to retrieve authentication tokens' });
        }
    } else {
        return res.status(401).json({ error: 'Not authenticated', message: 'No active session. Please log in first.' });
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            'bypass-cache': 'true',
            'Accept': 'application/json',
            ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
        };
        const response = await fetch(proxyUrl, {
            method: sanitizedMethod,
            headers,
            body: ['POST', 'PUT', 'PATCH'].includes(sanitizedMethod) ? JSON.stringify(req.body) : undefined
        });

        // Check if this is a download request that returns binary data
        const contentType = response.headers.get('content-type');
        const isDownload = subPath.includes('/download') ||
            contentType?.includes('application/octet-stream') ||
            contentType?.includes('font/') ||
            contentType?.includes('application/font');

        if (isDownload) {
            // Handle binary/file downloads
            const buffer = await response.buffer();

            // Copy relevant headers
            if (response.headers.get('content-disposition')) {
                res.set('content-disposition', response.headers.get('content-disposition'));
            }
            if (contentType) {
                res.set('content-type', contentType);
            }

            res.status(response.status).send(buffer);
        } else {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/event-stream')) {
                // Set up streaming response to browser
                res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

                // Set longer timeout for streaming responses
                res.setTimeout(0); // Disable timeout
                req.setTimeout(0); // Disable request timeout

                // Handle client disconnect
                req.on('close', () => {
                    console.log('Client disconnected from stream');
                    if (response.body && typeof response.body.destroy === 'function') {
                        response.body.destroy();
                    }
                });

                req.on('error', (err) => {
                    console.error('Request error during stream:', err);
                    if (response.body && typeof response.body.destroy === 'function') {
                        response.body.destroy();
                    }
                });

                // Handle streaming data manually to avoid pipe buffering issues
                response.body.on('data', (chunk) => {
                    // Write the chunk exactly as received without any modification
                    res.write(chunk);
                });

                response.body.on('end', () => {
                    console.log('Upstream stream ended');
                    res.end();
                });

                response.body.on('error', (err) => {
                    console.error('Stream error:', err);
                    res.end();
                });
            }
            else {
                // Handle JSON responses
                if (response.status === 204 || response.headers.get('content-length') === '0') {
                    res.status(response.status).json({ message: `${response.status} response` });
                } else {
                    const data = await response.json();
                    res.status(response.status).json(data);
                }
            }
        }
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Serving static files from: ${__dirname}`);
    console.log('Available endpoints:');
    console.log('  GET  /              - Serves index.html');
    console.log('  GET  /api/authorize - Login API endpoint');
    console.log('  POST /api/token     - Token exchange endpoint (creates session)');
    console.log('  GET  /api/session   - Check current session status');
    console.log('  POST /api/logout    - Logout and destroy session');
    console.log('  ALL  /api/proxy/*   - Proxy endpoint for all methods');
    console.log('  GET  /health        - Health check');
});

function isTokenExpired(token) {
    try {
        const decoded = jwt.decode(token);
        if (!decoded || !decoded.exp) return true;

        const currentTime = Math.floor(Date.now() / 1000);
        const bufferTime = 60;

        return decoded.exp <= (currentTime + bufferTime);
    } catch (error) {
        console.error('Error decoding token:', error);
        return true;
    }
}
