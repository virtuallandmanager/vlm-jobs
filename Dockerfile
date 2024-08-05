# Start with the LTS Alpine-based Node.js image
FROM node:16-alpine AS base

# Upgrade alpine packages to avoid possible OS vulnerabilities
# Tini for Handling Kernel Signals https://github.com/krallin/tini
# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#handling-kernel-signals
# Install Python, Redis, and build tools
RUN apk --no-cache upgrade && \
    apk add --no-cache tini redis python3 py3-pip build-base gcc

WORKDIR /opt/arena

# Install all dependencies
FROM base AS build
COPY package*.json ./
RUN npm install

# Copy source files and build the project
COPY . .
RUN npm run build

# Final stage to create the runtime image
FROM base

WORKDIR /opt/arena

# Copy built files and necessary dependencies
COPY --from=build /opt/arena/dist ./dist
COPY --from=build /opt/arena/node_modules ./node_modules
COPY package*.json ./

RUN chown -R node:node ./dist

USER node

EXPOSE 4567

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "-r", "dotenv/config", "dist/app.js"]
