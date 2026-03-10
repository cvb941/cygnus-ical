#!/bin/sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-cvb941/cygnus-ical}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER_NAME="${BUILDER_NAME:-cygnus-multiarch}"

if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER_NAME" --driver docker-container --use >/dev/null
fi

docker buildx inspect "$BUILDER_NAME" --bootstrap >/dev/null

docker buildx build \
  --builder "$BUILDER_NAME" \
  --platform "$PLATFORMS" \
  -t "$IMAGE_NAME:$IMAGE_TAG" \
  --push \
  .

echo "Pushed $IMAGE_NAME:$IMAGE_TAG for $PLATFORMS"
