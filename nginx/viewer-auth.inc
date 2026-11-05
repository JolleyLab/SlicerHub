# Gate a viewer location on the logged-in app session (included inside each viewer location).
# The backend checks the session cookie and that the path belongs to that user
# (backend/src/routes/viewerAuth.js). Subrequests share variables with the main request,
# so /_viewer_auth reads $viewer_auth_uri, the normalized path this location matched.
set $viewer_auth_uri $uri;
auth_request /_viewer_auth;
