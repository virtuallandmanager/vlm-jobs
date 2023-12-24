# Start with the LTS Alpine-based Node.js image
FROM node:16-alpine AS base

# - Upgrade alpine packages to avoid possible os vulnerabilities
# - Tini for Handling Kernel Signals https://github.com/krallin/tini
#   https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#handling-kernel-signals
# - Install Python, Redis, and build tools
RUN apk --no-cache upgrade && \
    apk add --no-cache tini redis python3 py3-pip build-base gcc


WORKDIR /opt/arena

FROM base AS build

COPY . /opt/arena/
RUN npm ci --only=production
RUN npm run build

FROM base

COPY --from=build /opt/arena/ .
RUN chmod -R og+r .

EXPOSE 4567

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
