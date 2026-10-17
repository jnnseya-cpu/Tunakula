# Customer storefront — its own deployable unit: a Next.js static export served by nginx.
# Build from the repo root:  docker build -f frontend/customer/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.tunakula.com -t tunakula-web-customer .
# NEXT_PUBLIC_API_URL is baked into the static output at build time, so the image is environment-specific.
FROM node:22-slim AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY shared ./shared
COPY frontend/customer ./frontend/customer
RUN npm ci --include-workspace-root --include=dev \
      -w @tunakula/ts-contracts -w @tunakula/ts-money -w @tunakula/web-customer
RUN npm run build -w @tunakula/web-customer

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/frontend/customer/out /usr/share/nginx/html
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
