# Container Lifecycle Management

## Two Modes of Operation

### 1. **Iframe Mode (Default - Recommended)**
✅ Better user experience - stays on your site
✅ Automatic cleanup when user clicks "Close"
✅ Easy to manage lifecycle

**How it works:**
- Trame app loads in an embedded iframe
- User sees a "Close Trame" button
- Clicking "Close" stops and removes the container
- No orphaned containers

### 2. **New Tab Mode**
- Opens Trame in a new browser tab
- User has full window for the app
- ⚠️ No automatic cleanup (container stays running until manually stopped)

## Usage

### Toggle Between Modes
Check/uncheck the "Open in iframe (embedded)" checkbox before clicking "Start Trame"

### Stopping Containers Manually

#### Via API:
```bash
curl http://localhost:8082/api/jobs/stop -Method POST -Body '{"userId":"user1"}' -ContentType "application/json"
```

#### Via Docker:
```bash
# Stop and remove a specific user's container
docker stop trame-user1
docker rm trame-user1

# Or force remove
docker rm -f trame-user1
```

#### List all user containers:
```bash
docker ps --filter name=trame-
```

## Trame iframe Compatibility

Trame works well in iframes because:
- ✅ WebSocket connections work through iframe
- ✅ VTK rendering works normally
- ✅ User interactions (mouse, keyboard) pass through
- ✅ File uploads/downloads still function

**Potential issues to watch for:**
- Some browsers may block certain features in iframes (rare)
- Cross-origin issues are avoided since everything goes through nginx
- Full-screen mode might need special handling

## Future Enhancements

### Option A: Heartbeat Mechanism
Add periodic pings to keep container alive:

```javascript
// Frontend sends heartbeat every 30 seconds
setInterval(async () => {
  await fetch('/api/jobs/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ userId: 'user1' })
  });
}, 30000);

// Backend cleanup job runs every 5 minutes
// Removes containers that haven't received heartbeat in 10 minutes
```

### Option B: Session Timeout
Automatically stop containers after X minutes of inactivity:
- Track last access time
- Background job checks for stale containers
- Removes containers older than threshold

### Option C: beforeunload Handler (New Tab Mode)
Attempt cleanup when tab closes (unreliable):

```javascript
window.addEventListener('beforeunload', async () => {
  // Send beacon request (doesn't wait for response)
  navigator.sendBeacon('/api/jobs/stop', 
    JSON.stringify({ userId: this.userId })
  );
});
```

**Note:** This is unreliable because:
- Browser might kill the tab before request completes
- User might just navigate to another page
- Works better with heartbeat mechanism

## Recommended Setup for Production

1. **Use iframe mode by default** for better UX and lifecycle control
2. **Add heartbeat mechanism** to detect abandoned sessions
3. **Implement cleanup job** that runs every 5-10 minutes:
   - Remove containers with no heartbeat for 15+ minutes
   - Remove containers older than 4 hours (max session time)
4. **Add resource limits** in docker-compose:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 4G
   ```
5. **Track active sessions in database** for monitoring
6. **Add user quotas** (max 1 container per user at a time)

## Current Behavior

- **Container reuse:** If user clicks "Start Trame" and container already exists, it reuses it
- **No auto-cleanup:** Containers persist until explicitly stopped
- **Manual cleanup required:** Admin should periodically check for orphaned containers

## Testing

### Test iframe mode:
1. Go to http://localhost:8082
2. Ensure "Open in iframe" is checked
3. Click "Start Trame"
4. Trame loads in iframe below
5. Click "Close Trame"
6. Verify container is stopped: `docker ps --filter name=trame-user1`

### Test new tab mode:
1. Uncheck "Open in iframe"
2. Click "Start Trame"
3. New tab opens with Trame
4. Container stays running even if you close the tab
5. Manually stop: `docker rm -f trame-user1`

### Test cleanup endpoint:
```powershell
# Start container
curl http://localhost:8082/api/jobs/run -Method POST -Body '{"userId":"user1"}' -ContentType "application/json" -UseBasicParsing

# Verify running
docker ps --filter name=trame-user1

# Stop it
curl http://localhost:8082/api/jobs/stop -Method POST -Body '{"userId":"user1"}' -ContentType "application/json" -UseBasicParsing

# Verify stopped
docker ps --filter name=trame-user1
```
