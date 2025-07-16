# Use official Node.js LTS image
FROM node:lts-alpine

# Set working directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps && npm install -g nodemon

# Copy only source code (for production, but in dev we mount code)
COPY . .

# Expose port
EXPOSE 4000

# Default command (overridden by docker-compose for dev)
CMD ["nodemon", "src/server.js"] 