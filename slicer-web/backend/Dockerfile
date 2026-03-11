# Use a Node LTS image
FROM node:20

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first for caching
COPY package*.json ./

# Install Node dependencies
RUN npm ci

# Copy all source files
COPY . .

# Expose the port the backend listens on
EXPOSE 8080

# Start the backend
CMD ["node", "src/server.js"]