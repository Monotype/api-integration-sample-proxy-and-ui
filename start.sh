#!/bin/bash

# Use Node.js 18 with nvm
source ~/.nvm/nvm.sh
nvm use 18

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the application in development mode
npm run dev
