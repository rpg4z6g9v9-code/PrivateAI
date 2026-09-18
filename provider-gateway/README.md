# PrivateAI Provider Gateway

Foreground-only provider proxy for PrivateAI.

## Bind

127.0.0.1:8787 by default.

It is intentionally not exposed to the LAN.

## Endpoints

GET /health

POST /claude

POST /search

GET /elevenlabs/voices

## Required environment variables

CLAUDE_API_KEY

TAVILY_API_KEY

ELEVENLABS_API_KEY

## Security rules

The gateway has fixed provider destinations.

It does not support arbitrary URL fetching.

It does not provide shell execution.

It does not provide filesystem access.

It does not run as a daemon or LaunchAgent.

Provider secrets remain outside the iPhone application.
