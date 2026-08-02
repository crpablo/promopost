FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Instala o Chromium e as dependências de sistema necessárias UMA VEZ, na
# build da imagem — não a cada execução (era esse o custo de "Snapshot
# Storage" que motivou sair da Vercel Sandbox, ver spec da migração).
RUN npx playwright install --with-deps chromium

RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

CMD ["npm", "start"]
