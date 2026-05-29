FROM node:20-alpine
WORKDIR /app

RUN npm install -g mongodb-mcp-server

COPY package.json .
RUN npm install

COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]