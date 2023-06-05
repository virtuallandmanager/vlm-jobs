FROM node:lts-alpine AS base

# Upgrade Alpine packages to avoid possible OS vulnerabilities
# Install Tini for handling kernel signals
RUN apk --no-cache upgrade && apk add --no-cache tini redis

WORKDIR /opt/arena

FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY tsconfig.json .
COPY . .

RUN npm run build

FROM base

COPY --from=build /opt/arena/ ./

RUN chmod -R og+r .

EXPOSE 4567

USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
