# Image/container name: ttb-label-verify-backend
# (this is the name passed to `docker build -t` and `docker run --name`
# below in ARCHITECTURE_AND_DEPLOYMENT.md 2.3, not this file's name)
#
# Builds and runs the label-verification API's backend. This runs
# inside Docker because the VPS host itself has no working Node
# install (see ARCHITECTURE_AND_DEPLOYMENT.md 1.2), it's not a
# stylistic choice, the backend genuinely has no alternative.
#
# What happens at build time (`docker build`):
#   1. npm install (full install, including devDependencies, since
#      typescript, ts-node, and ts-json-schema-generator all need to
#      be present at build time to compile and generate schemas, even
#      though none of them run at container start)
#   2. npm run generate:schemas — regenerates schemas.generated.ts
#      from the actual service interfaces (services/matching.ts,
#      services/batch.ts, services/extraction.ts), so the OpenAPI
#      spec served at /api/docs can't drift out of sync with the code
#   3. npx tsc — compiles server.ts, swagger-spec.ts, and
#      services/**/*.ts to dist/
#
# What happens at container start:
#   node dist/server.js listens on port 3002 inside the container.
#   Only the compiled output runs, not the .ts source, Node can't
#   execute TypeScript directly without a transpiler at runtime.
#
# How this reaches production:
#   deploy-to-vps.yml rsyncs source to /opt/label-verify on the VPS,
#   runs `docker build` here to produce the ttb-label-verify-backend
#   image, then `docker run -d --name ttb-label-verify-backend
#   --restart unless-stopped -p 3002:3002 --env-file .env
#   ttb-label-verify-backend` to create the running container. Port
#   3002 is bound to 127.0.0.1 only, never exposed publicly. Apache's
#   reverse proxy (configured separately, one-time, not by this
#   pipeline, see ARCHITECTURE_AND_DEPLOYMENT.md 2.4) forwards
#   /mvps/label-verify/api/* to 127.0.0.1:3002/api/*. That Apache rule
#   is the only public path to anything this container does.
#
# Rebuilding replaces the image; the old container is removed and a
# new one is created from the new image, the container is never
# updated in place.

FROM node:20-alpine

WORKDIR /app

# Full install (not --omit=dev): typescript and the @types/* packages
# are devDependencies, needed here at build time to compile, even
# though they're not needed at runtime.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Generates schemas.generated.ts from the actual service interfaces,
# then compiles server.ts, swagger-spec.ts, and services/**/*.ts to dist/.
# Order matters: swagger-spec.ts imports schemas.generated.ts, so it must
# exist before tsc runs, not after.
RUN npm run generate:schemas && npx tsc

EXPOSE 3002

# Runs the compiled output, not the TypeScript source directly, since
# Node cannot execute .ts files without a transpiler at runtime.
CMD ["node", "dist/server.js"]
