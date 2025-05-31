#!/bin/bash
set -e

echo "🤖 Starting GitLab MR Coach..."

# Validate required environment variables
if [ -z "$CI_MERGE_REQUEST_IID" ]; then
    echo "❌ Not a merge request pipeline. Skipping..."
    exit 0
fi

if [ -z "$GITLAB_TOKEN" ] || [ -z "$GOOGLE_AI_API_KEY" ]; then
    echo "❌ Missing required environment variables: GITLAB_TOKEN, GOOGLE_AI_API_KEY"
    exit 1
fi

echo "📋 Processing MR #$CI_MERGE_REQUEST_IID in project $CI_PROJECT_ID"

# Run the Node.js coach
node coach.js

echo "✅ MR Coach completed successfully!"