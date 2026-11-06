# Shared by the /sso/ locations in default.conf. Strips the /sso prefix and forwards
# to Keycloak on the Docker network, resolved per request so nginx starts even when the
# keycloak compose profile is not running (requests then fail with 502).
resolver 127.0.0.11 valid=10s;
set $keycloak_upstream keycloak;
rewrite ^/sso/(.*)$ /$1 break;
proxy_pass http://$keycloak_upstream:8080;
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Forwarded-Proto $forwarded_proto_effective;
# Overwrite (not append): Keycloak records this as the client IP in its events.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
# Keycloak's sign-in responses carry large cookies/headers.
proxy_buffer_size 128k;
proxy_buffers 4 256k;
proxy_busy_buffers_size 256k;
