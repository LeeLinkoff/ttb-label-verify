FROM node:20-alpine

WORKDIR /app

# Full install (not --omit=dev): typescript and the @types/* packages
# are devDependencies, needed here at build time to compile, even
# though they're not needed at runtime.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Compiles server.ts, swagger-spec.ts, and services/**/*.ts to dist/.
RUN npx tsc

EXPOSE 3002

# Runs the compiled output, not the TypeScript source directly, since
# Node cannot execute .ts files without a transpiler at runtime.
CMD ["node", "dist/server.js"]
