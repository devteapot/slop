FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
# Drop workspace globs that don't ship in this build context (apps/, examples/, website/, benchmarks/)
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=p.workspaces.filter(w=>w.startsWith('packages/typescript'));fs.writeFileSync('package.json',JSON.stringify(p,null,2));"
COPY packages/typescript ./packages/typescript

RUN bun install
RUN cd packages/typescript/integrations/relay-cli && bun run build
RUN cd packages/typescript/integrations/bridge-server && bun run build

FROM oven/bun:1-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/typescript ./packages/typescript

EXPOSE 8080

CMD ["bun", "packages/typescript/integrations/bridge-server/dist/cli.js"]
