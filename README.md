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
cd authorizationCode
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your Auth0 client secret
# AUTH0_CLIENT_SECRET=your_actual_client_secret_here
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

## Configuration

If you want to, you can update the following constants in `index.js` (should be moved to environment variables in production):

```javascript
const API_DOMAIN = 'pp-api.monotype.com';
const AUTH0_CLIENT_ID = 'your-client-id';
const AUTH0_SCOPE = 'openid email profile';
const REDIS_URL = 'redis://localhost:6379';
const SESSION_SECRET = 'your-session-secret';
```

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

## Demo Pages

- **`index.html`** - Demo implementation

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
├── package.json      # Dependencies
└── README.md         # This file
```

### Key Dependencies
- `express` - Web framework
- `express-session` - Session middleware
- `connect-redis` - Redis session store
- `jsonwebtoken` - JWT token handling
- `redis` - Redis client

## Production Considerations

1. **Environment Variables**: Move all configuration to environment variables
2. **HTTPS**: Enable secure cookies and HTTPS in production
3. **Redis Security**: Configure Redis authentication and encryption
4. **Session Secret**: Use a cryptographically strong session secret
5. **Error Handling**: Implement comprehensive error logging
6. **Rate Limiting**: Add rate limiting for authentication endpoints

## Troubleshooting

### Common Issues

1. **Redis Connection Error**: Ensure Redis server is running on localhost:6379
2. **Token Refresh Fails**: Check OAuth provider configuration and refresh token validity
3. **Session Not Persisting**: Verify Redis connection and connect-redis configuration
4. **Authentication Error**: Ensure client secret is properly configured in environment variables

### Debug Mode
Enable detailed logging by checking console output for:
- Redis connection status
- Token expiration times
- Session creation/destruction
- API proxy requests

## License
