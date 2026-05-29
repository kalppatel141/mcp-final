FROM node:20-alpine
WORKDIR /app

# Install MongoDB MCP server globally
RUN npm install -g mongodb-mcp-server

# Install proxy dependencies
COPY package.json .
RUN npm install

COPY server.js .

EXPOSE 3000

# Use a shell script to start both processes with logging
CMD sh -c "echo 'Starting MongoDB MCP on port 3001...' && mongodb-mcp-server --transport http --port 3001 & sleep 3 && echo 'Starting OAuth proxy on port 3000...' && node server.js"