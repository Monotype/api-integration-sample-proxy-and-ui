# Monotype API Integration Sample

A Node.js/Express proxy and browser UI demonstrating OAuth 2.0 Authorization Code authentication and access to the Monotype Fonts API. Sessions and tokens are stored in Redis, and API requests are sent through the authenticated proxy.

## Features

- **OAuth 2.0 Authorization Code Flow**: Secure authorization code flow with client secret authentication
- **Redis Session Storage**: Persistent sessions across server restarts using Redis
- **Automatic Token Refresh**: JWT-based token expiration detection with automatic refresh
- **API Proxy**: Authenticated proxy endpoint for making API calls with valid tokens
- **Session Management**: Complete session lifecycle with login/logout endpoints
- **Library Browser**: Separate Personal and Shared asset trees loaded from `/v1/fontslibrary/collections-lite`
- **Paginated and Lazy Loading**: Fetches every root page and loads folder, font set, web project, and digital ad contents when opened
- **Font Discovery**: Filtered font search and contextual font recommendations in `app.html`
- **Font Details and Downloads**: Displays font metadata and supports direct font downloads

## Prerequisites

- Node.js 18 or higher
- Redis server running on localhost:6379
- Monotype API OAuth client ID and client secret

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd api-integration-sample-proxy-and-ui
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your OAuth client ID, client secret, and session secret
# AUTH0_CLIENT_SECRET=your_actual_client_secret_here
# AUTH0_CLIENT_ID=your_auth0_client_id_here
# SESSION_SECRET=your_session_secret_here # openssl rand -hex 64
# REDIS_URL=redis://localhost:6379
# API_DOMAIN=api.monotype.com
# ALLOWED_REDIRECT_ORIGINS=http://localhost:8081
```

`ALLOWED_REDIRECT_ORIGINS` accepts a comma-separated list of application origins. When omitted, callbacks must match the current request host; set it explicitly to the public application origin in deployed environments.

4. Start Redis server:
```bash
# Install Redis using Homebrew (macOS)
brew install redis

# Start Redis server
brew services start redis

# Or run Redis manually
redis-server
```

5. Start the application:
```bash
npm start
```

For automatic restarts during development, use `npm run dev`.

The server starts on `http://localhost:8081` by default. Set `PORT` in `.env` to use a different port.

## API Endpoints

### Authentication Endpoints

- **GET `/api/authorize`** - Initiates OAuth authorization flow
  - Query params: `redirect_uri` (required)
  - Redirects to OAuth provider

- **POST `/api/token`** - Exchanges authorization code for tokens
  - Body: `{ code, redirect_uri }`
  - Creates session and stores tokens in Redis

- **GET `/api/session`** - Check current session status
  - Returns session info and token validity

- **POST `/api/logout`** - Logout and destroy session
  - Cleans up Redis tokens and destroys browser session

### Proxy Endpoint

- **ALL `/api/proxy/*`** - Authenticated API proxy
  - Automatically handles token refresh if expired
  - Forwards requests to configured API domain with Bearer token
  - Supports JSON, binary font downloads, and server-sent event streams

### Utility Endpoints

- **GET `/health`** - Health check endpoint
- **GET `/`** - Serves static index.html demo page
- **GET `/app.html`** - Serves sample one page application

## Demo Pages

- **`index.html`** - Demo implementation
- **`app.html`** - Full sample application with contextual and filtered font search

The application provides Home, My Library, and Discover Fonts navigation. My Library shows independently scrollable Personal and Shared trees. The main content area scrolls separately from the left navigation.

## Monotype API Usage

The library browser uses `GET /v1/fontslibrary/collections-lite` through `/api/proxy`.

- Personal and Shared root assets are requested separately with `accessType=personal` and `accessType=shared`.
- All result pages are fetched using `pageNumber` and `pageSize`.
- Opening an expandable asset makes another request with its `assetType` and `assetId` to load its children.
- Unopened assets display `itemCount` when the API supplies it.

Font discovery uses `/v1/fonts/search` and `/v1/fonts/filterslookup`. The contextual search in `app.html` uses `/v1/fontgpt/recommendations` and displays selected progress events from the API while the response is streaming.

## How It Works

### Authorization Code Flow
1. User is redirected to OAuth provider for authorization
2. After authorization, code is exchanged for tokens using client secret
3. Tokens are stored in Redis with session persistence

### Token Management
- Access tokens stored in Redis with JWT-based expiration
- Automatic token refresh using refresh tokens
- 60-second buffer before token expiration for proactive refresh
- Session persistence across server restarts via Redis

### Session Storage
- Sessions stored in Redis using `connect-redis`
- Token metadata and expiration tracking
- Automatic cleanup on logout

## Security Features

- Secure session cookies (httpOnly, configurable secure flag)
- Authorization Code flow with client secret authentication
- Automatic token refresh with proper error handling
- Session-based authentication state management
- OAuth callback-origin validation
- Content Security Policy and content-type hardening
- Cryptographically random server-side token identifiers

## Development

### File Structure
```
├── index.mjs         # Main server application
├── index.html        # Authorization Code demo page
├── app.html          # Full one-page application
├── app.css           # Application styles
├── app.js            # Application behavior and API integration
├── .env.example      # Environment variable template
├── package.json      # Dependencies
└── README.md         # This file
```

### Key Dependencies
- `express` - Web framework
- `express-session` - Session middleware
- `connect-redis` - Redis session store
- `redis` - Redis client

### Common Issues

1. **Redis Connection Error**: Ensure Redis server is running on localhost:6379
2. **Token Refresh Fails**: Check OAuth provider configuration and refresh token validity
3. **Session Not Persisting**: Verify Redis connection and connect-redis configuration
4. **Authentication Error**: Ensure client secret is properly configured in environment variables
5. **No Collections Found**: Confirm the authenticated account has library access and that `API_DOMAIN` targets the intended Monotype environment
