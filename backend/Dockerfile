# Use a Node LTS image
FROM node:20

# Install git + SSH client for SlicerWeb deploy-key updates
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
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