FROM node:20-alpine
WORKDIR /app

# Install MongoDB MCP server globally
RUN npm install -g mongodb-mcp-server

# Install proxy dependencies
COPY package.json .
RUN npm install

COPY server.js .

EXPOSE 3000

# Start both the MCP server (port 3001) and the proxy (port 3000)
CMD sh -c "mongodb-mcp-server --transport http --port 3001 & node server.js"