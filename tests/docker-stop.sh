#!/usr/bin/env bash

export COMPOSE_PROJECT_NAME=chiffre-push-test
export COMPOSE_FILE=$(dirname $0)/docker-compose.yml

# Stop services
docker-compose down
