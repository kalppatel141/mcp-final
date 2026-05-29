FROM node:20-alpine
WORKDIR /app
RUN npm install -g mongodb-mcp-server
EXPOSE 3000
CMD ["mongodb-mcp-server", "--transport", "http", "--port", "3000"]