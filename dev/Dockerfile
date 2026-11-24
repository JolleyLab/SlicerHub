# Optional extra CA certs (corporate TLS inspection). Empty unless the build is given
# a "certs" context — docker compose passes ./certs; see certs/README.md.
FROM scratch AS certs

FROM node:18-alpine

# Alpine ships the CA bundle without update-ca-certificates, so append directly.
COPY --from=certs . /usr/local/share/ca-certificates/extra/
RUN if ls /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then \
      cat /usr/local/share/ca-certificates/extra/*.crt >> /etc/ssl/certs/ca-certificates.crt; fi
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

EXPOSE 5173
ENV NODE_OPTIONS=--openssl-legacy-provider
CMD ["npm", "run", "serve", "--", "--host"]