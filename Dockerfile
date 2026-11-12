FROM node:20-alpine

# Diretório de trabalho da aplicação
WORKDIR /app

# Instala tzdata para garantir o fuso horário correto de Brasília (America/Sao_Paulo)
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

# Copia manifestos de dependências
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm ci --omit=dev

# Copia todo o código-fonte da aplicação
COPY . .

# Cria pasta de dados para persistência/fallback caso não exista
RUN mkdir -p /app/data

# Define ambiente como produção
ENV NODE_ENV=production

# Comando de inicialização do bot
CMD ["node", "src/index.js"]
