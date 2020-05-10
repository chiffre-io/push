#!/usr/bin/env bash

autocannon \
  --latency \
  --method POST \
  --headers content-type=text/plain \
  --body "v1.naclbox.test-payload-<id>" \
  --idReplacement \
  http://localhost:3002/event/testProjectID123?perf=42
