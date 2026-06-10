# Shared Documentation

Cross-cutting concerns that apply to multiple search options.

## Contents

- **`example-schema.md`** - Complete PostgreSQL schema for house search example
- **`comparison.md`** - Detailed feature and use-case comparison of all options
- **`domain-modeling.md`** - Schema design, document structure, denormalization patterns
- **`embeddings.md`** - Embedding generation, field selection, cost management
- **`saved-searches.md`** - Saved search implementation, alerting, zero-hit support
- **`autocomplete.md`** - Autocomplete and suggestions for all search engines
- **`frontend-integration.md`** - InstantSearch.js patterns, custom adapters
- **`deployment-overview.md`** - General Docker conventions and environment setup

## Use These When

**Understanding the example:**
- Read `example-schema.md` to see the complete house search schema
- Reference this schema throughout all documentation
- Use as a template for your own domain

**Planning your architecture:**
- Read `comparison.md` to choose between options
- Read `deployment-overview.md` for Docker conventions

**Designing your schema:**
- Start with `example-schema.md` to understand the normalized source
- Read `domain-modeling.md` for document structure patterns
- Applies to all options, but especially Meilisearch/Typesense

**Implementing semantic search:**
- Read `embeddings.md` for field selection and cost management
- Applies to all options using vector search

**Building saved searches:**
- Read `saved-searches.md` for criteria storage and alerting
- Applies to all options

**Adding autocomplete:**
- Read `autocomplete.md` for suggestion patterns
- Applies to all options

**Integrating frontend:**
- Read `frontend-integration.md` for InstantSearch.js patterns
- Meilisearch/Typesense have direct adapters
- PostgreSQL/pg_search need custom adapters

## Quick Navigation

### I'm evaluating options
→ Start with `comparison.md`

### I chose PostgreSQL-only
→ Go to `../postgresql-native/`

### I chose pg_search extension
→ Go to `../pg-search/`

### I chose Meilisearch
→ Go to `../meilisearch/`

### I chose Typesense
→ Go to `../typesense/`
