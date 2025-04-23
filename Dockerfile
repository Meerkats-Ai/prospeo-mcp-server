FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Set executable permissions for the entry point
RUN chmod +x dist/index.js

# Run the server
CMD ["node", "dist/index.js"]
