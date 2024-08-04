# Start with the LTS Alpine-based Node.js image
FROM node:16-alpine AS base

# Upgrade alpine packages to avoid possible os vulnerabilities
# Tini for Handling Kernel Signals https://github.com/krallin/tini
# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#handling-kernel-signals
# Install Python, Redis, and build tools
RUN apk --no-cache upgrade && \
    apk add --no-cache tini redis python3 py3-pip build-base gcc

WORKDIR /opt/arena

FROM base AS build

COPY package*.json ./
RUN npm ci --only=production

COPY . /opt/arena/
RUN npm run build

FROM base

WORKDIR /opt/arena

COPY --from=build /opt/arena/dist ./dist
COPY package*.json ./
RUN npm install --only=production

RUN chown -R node:node ./dist

USER node

EXPOSE 4567

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--loader", "ts-node/esm", "--experimental-specifier-resolution=node", "-r", "dotenv/config", "dist/app.mjs"]
