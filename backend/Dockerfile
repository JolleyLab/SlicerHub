# Optional extra CA certs (corporate TLS inspection). Empty unless the build is given
# a "certs" context — docker compose passes ./certs; see certs/README.md.
FROM scratch AS certs

# Use a Node LTS image
FROM node:20

COPY --from=certs . /usr/local/share/ca-certificates/extra/
RUN if ls /usr/local/share/ca-certificates/extra/*.crt >/dev/null 2>&1; then update-ca-certificates; fi
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

# Install git + SSH client for SlicerWeb deploy-key updates
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client python3 python3-pip \
    && pip3 install --break-system-packages h5py \
    && rm -rf /var/lib/apt/lists/*

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first for caching
COPY package*.json ./

# Install Node dependencies
RUN npm ci

# Copy all source files (exclude node_modules in .dockerignore to avoid conflicts)
COPY . .

# Expose the port the backend listens on
EXPOSE 8080

# Start the backend
CMD ["node", "src/server.js"]