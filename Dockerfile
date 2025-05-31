# Dockerfile for GitLab MR Coach
FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache curl git

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Make the script executable
RUN chmod +x ./coach.sh

# Default command
CMD ["./coach.sh"]