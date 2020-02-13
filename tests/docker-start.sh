#!/usr/bin/env bash

export COMPOSE_PROJECT_NAME=chiffre-push-test
export COMPOSE_FILE=$(dirname $0)/docker-compose.yml

# Start services
docker-compose run wait
