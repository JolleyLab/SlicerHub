# Authentication System Setup Guide

## Overview
Your application now has a complete JWT-based authentication system with SQLite database storage.

## Technologies Used (All Open Source - MIT Licensed)
- **jsonwebtoken** - JWT token generation and verification
- **bcrypt** - Password hashing
- **better-sqlite3** - SQLite database (synchronous)
- **express** - Web framework
- **cookie-parser** - Cookie parsing

## How to Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start the Backend
```bash
npm start
```

The database will be automatically created at `backend/data/users.db` on first run.

### 3. Start the Frontend
In a new terminal:
```bash
cd dev
npm install
npm run docs:serve
```

### 4. Access the Application
Open your browser to `http://localhost:8000`

## Features Implemented

### Backend (`backend/`)

#### Database (`src/db/database.js`)
- SQLite database with two tables:
  - `users` - User accounts with hashed passwords
  - `sessions` - Active JWT sessions
- Automatic schema initialization
- Indexed for performance

#### User Model (`src/models/User.js`)
- Create new users with hashed passwords
- Find users by ID, username, or email
- Verify passwords
- Update user information
- Change passwords
- Delete users

#### Authentication Middleware (`src/middleware/authMiddleware.js`)
- `generateToken()` - Create JWT tokens
- `authenticateToken()` - Verify JWT on protected routes
- `requireAdmin()` - Admin-only access
- Session management in database
- Automatic cleanup of expired sessions

#### Auth Routes (`src/routes/auth.js`)
- `POST /api/auth/register` - Create new account
- `POST /api/auth/login` - Login and receive JWT
- `POST /api/auth/logout` - Logout current session
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout-all` - Logout all sessions

#### Protected Routes (`src/routes/jobs.js`)
- `POST /api/jobs/run` - Start Docker job (requires auth)
- `POST /api/jobs/stop` - Stop Docker job (requires auth)
- User ID automatically comes from authenticated user

### Frontend (`dev/`)

#### Login Component (`login-form.js`)
- Username/password login
- Error handling
- Loading states
- Auto-stores JWT in localStorage
- Link to registration

#### Register Component (`register-form.js`)
- Username, email, password registration
- Password confirmation
- Email validation
- Password strength requirements (8+ characters)
- Auto-login after registration

#### Main Component (`my-element.js`)
- Auth state management
- Automatic session restoration
- Protected UI (shows login if not authenticated)
- User header with logout button
- JWT sent with all API requests

## Security Features

1. **Password Hashing**: bcrypt with 10 salt rounds
2. **JWT Tokens**: 7-day expiration
3. **Session Tracking**: Database tracks all active sessions
4. **Logout**: Invalidates specific session
5. **Logout All**: Security feature to kill all sessions
6. **Token Verification**: Middleware checks JWT on every protected route
7. **CORS Protection**: Only allows requests from frontend domains

## Environment Variables

For production, set these in your environment:

```bash
JWT_SECRET=your-super-secret-key-here
NODE_ENV=production
```

## Database Location

- **Development**: `backend/data/users.db`
- SQLite file-based database (no separate server needed)

## API Usage Examples

### Register
```javascript
fetch('http://localhost:8081/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'johndoe',
    email: 'john@example.com',
    password: 'secure123'
  })
})
```

### Login
```javascript
fetch('http://localhost:8081/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'johndoe',
    password: 'secure123'
  })
})
```

### Access Protected Route
```javascript
fetch('http://localhost:8081/api/jobs/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
})
```

## User Management

### Create Admin User
Modify the database directly or add an admin creation script:

```javascript
import User from './src/models/User.js';

const admin = await User.create({
  username: 'admin',
  email: 'admin@example.com',
  password: 'admin123'
});

User.update(admin.id, { role: 'admin' });
```

### View Database
Use any SQLite viewer or CLI:
```bash
sqlite3 backend/data/users.db
.tables
SELECT * FROM users;
```

## Next Steps

1. **Set JWT_SECRET** in production environment
2. **Configure email verification** (optional)
3. **Add password reset** functionality (optional)
4. **Implement role-based access control** for admin features
5. **Add user profile management** UI
6. **Set up HTTPS** for production

## Troubleshooting

### "Access token required" error
- Make sure token is being sent in Authorization header
- Check localStorage has the token
- Try logging out and back in

### Database errors
- Ensure `backend/data/` directory exists
- Check file permissions
- Delete `users.db` to reset (will lose all users)

### CORS errors
- Verify frontend URL is in CORS whitelist
- Check backend is running on port 8081
- Ensure credentials: true in fetch options if using cookies

## File Structure
```
backend/
  src/
    db/
      database.js          # SQLite setup
    models/
      User.js              # User model
    middleware/
      authMiddleware.js    # JWT verification
    routes/
      auth.js              # Auth endpoints
      jobs.js              # Protected job endpoints
    docker/
      launch.js            # Main server (updated)
  data/
    users.db              # SQLite database (auto-created)

dev/
  login-form.js          # Login component
  register-form.js       # Register component
  my-element.js          # Main app (updated)
```
