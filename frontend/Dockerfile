FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Build for production
RUN npm run build

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built files and server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js

# Railway uses dynamic PORT
EXPOSE 3000

# Start the Express server
CMD ["node", "server.js"]
