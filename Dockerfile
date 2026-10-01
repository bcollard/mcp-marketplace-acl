# ---- build stage ----
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- production stage ----
FROM node:22-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Run as non-root user
USER node

EXPOSE 3001

# env vars (TOKEN_EXCHANGE_URL, CLIENT_ID, CLIENT_SECRET, TARGET_RESOURCE, TARGET_SCOPES, PORT)
# must be supplied at runtime via --env / --env-file or an orchestrator secret store.
CMD ["node", "--enable-source-maps", "dist/server.js"]
