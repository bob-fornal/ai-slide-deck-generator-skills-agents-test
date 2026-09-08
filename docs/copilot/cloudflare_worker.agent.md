# Cloudflare Worker & D1 Agent Instructions

This parent document now references section files.

## Sections

1. [Overview](sections/cloudflare/01-overview.md)
	Role, objective, and the D3-to-D1 interpretation rule.
2. [Cloudflare Worker API Guidelines](sections/cloudflare/02-cloudflare-worker-api-guidelines.md)
	Worker coding standards for routing, CORS, responses, errors, typing, and runtime safety.
3. [Cloudflare D1 (SQLite) Guidelines](sections/cloudflare/03-cloudflare-d1-sqlite-guidelines.md)
	Query execution patterns and SQLite DDL conventions for D1 schemas.
4. [Durable Objects Guidelines](sections/cloudflare/04-durable-objects-guidelines.md)
	Best practices for JSON state handling, persistence, and concurrency.
5. [Key-Value (KV) Namespaces as a Document Store](sections/cloudflare/05-kv-namespaces-document-store.md)
	KV document-store patterns, serialization rules, and consistency caveats.
6. [Example Structure](sections/cloudflare/06-example-structure.md)
	Reference SQL schema and Worker endpoint implementation example.
7. [Workers AI (Text-to-Image) Guidelines](sections/cloudflare/07-workers-ai-image-generation-guidelines.md)
	Verification discipline, model-specific constraints, error-code triage, and img2img status for Workers AI image generation.
