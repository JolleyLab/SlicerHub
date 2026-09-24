# Shared by the API locations in default.conf (included inside each location).
# The upstream is resolved per request so nginx picks up the backend's new IP after a container
# recreate, and the client's original host, scheme and address are passed through.
resolver 127.0.0.11 valid=10s;
set $api_upstream backend;
proxy_pass http://$api_upstream:8080;
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-Host $http_host;
proxy_set_header X-Forwarded-Proto $forwarded_proto_effective;
proxy_set_header X-Real-IP $remote_addr;
