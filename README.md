# Authorization Code OAuth Proxy Server

A Node.js Express server that implements OAuth 2.0 with Authorization Code flow, featuring Redis-backed session storage and automatic token refresh capabilities.

## Features

- **OAuth 2.0 Authorization Code Flow**: Secure authorization code flow with client secret authentication
- **Redis Session Storage**: Persistent sessions across server restarts using Redis
- **Automatic Token Refresh**: JWT-based token expiration detection with automatic refresh
- **API Proxy**: Authenticated proxy endpoint for making API calls with valid tokens
- **Session Management**: Complete session lifecycle with login/logout endpoints

## Prerequisites

- Node.js (v14 or higher)
- Redis server running on localhost:6379
- Auth0 or compatible OAuth provider
- Client secret from your OAuth provider

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

# Edit .env and add your Auth0 client id, Auth0 secret, and session secret
# AUTH0_CLIENT_SECRET=your_actual_client_secret_here
# AUTH0_CLIENT_ID=your_auth0_client_id_here
# SESSION_SECRET=your_session_secret_here # openssl rand -hex 64
```

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
node index.mjs
```

The server will start on `http://localhost:8081`

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

### Utility Endpoints

- **GET `/health`** - Health check endpoint
- **GET `/`** - Serves static index.html demo page
- **GET `/app.html`** - Serves sample one page application

## Demo Pages

- **`index.html`** - Demo implementation
- **`app.html`** - Sample one page application

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

## Development

### File Structure
```
├── index.mjs         # Main server application
├── index.html        # Authorization Code demo page
├── app.html          # One Page application demo
├── package.json      # Dependencies
└── README.md         # This file
```

### Key Dependencies
- `express` - Web framework
- `express-session` - Session middleware
- `connect-redis` - Redis session store
- `jsonwebtoken` - JWT token handling
- `redis` - Redis client

### Common Issues

1. **Redis Connection Error**: Ensure Redis server is running on localhost:6379
2. **Token Refresh Fails**: Check OAuth provider configuration and refresh token validity
3. **Session Not Persisting**: Verify Redis connection and connect-redis configuration
4. **Authentication Error**: Ensure client secret is properly configured in environment variables
