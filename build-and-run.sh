#!/bin/bash

. /base_settings/customEnvVars.sh

# Define your app name and image name
APP_NAME="crea-expenses_bot"
IMAGE_NAME="crea-expenses_bot"

# Stop the running container (if it exists)
if docker ps -a --filter "name=$APP_NAME" --format '{{.Names}}' | grep -q $APP_NAME; then
  echo "Stopping and removing the running container..."
  docker stop $APP_NAME
  docker rm $APP_NAME
  echo "Stopping and removing the running container... - Done."
fi

# Build the Docker image
docker build -t $IMAGE_NAME .

echo "TG_BOT_EXPENSES_DB_NAME=$TG_BOT_EXPENSES_DB_NAME"

# Run the Docker container
docker run -d --name $APP_NAME --restart unless-stopped \
    -e POSTGRES_USER=$POSTGRES_USER \
    -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
    -e TG_BOT_EXPENSES_TOKEN=$TG_BOT_EXPENSES_TOKEN \
    -e TG_BOT_EXPENSES_DB_NAME=$TG_BOT_EXPENSES_DB_NAME \
    $IMAGE_NAME

# Remove all unused images and data
docker system prune -af

echo "Docker image built, app is running, and unused images are removed."