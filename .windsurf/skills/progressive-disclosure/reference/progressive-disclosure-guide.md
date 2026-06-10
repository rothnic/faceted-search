# Progressive Disclosure: A Deep Dive

Progressive disclosure is the foundational principle for effective skill design. This guide explains the concept, implementation patterns, and practical strategies.

## Table of Contents
- What is Progressive Disclosure (line 15)
- Why It Matters for AI Agents (line 45)
- Implementation Patterns (line 90)
- Real-World Examples (line 180)
- Anti-Patterns to Avoid (line 250)
- Measuring Effectiveness (line 310)

## What is Progressive Disclosure

### Definition

**Progressive disclosure** is an information architecture pattern where you reveal complexity gradually rather than all at once. You provide:
1. **Essential information first** (always visible)
2. **Detailed information on demand** (loaded when needed)
3. **Supporting information last** (accessed rarely)

### Origins

This concept comes from UX design:
- Don't overwhelm users with every feature upfront
- Reveal advanced options only to those who need them
- Maintain simplicity for common cases while supporting complex ones

### Applied to AI Agents

For AI agents, progressive disclosure means:
- **SKILL.md**: Core workflow and pointers to details
- **reference/ files**: Extended documentation loaded on demand
- **scripts/**: Executable code that doesn't consume context
- **External docs**: Links to authoritative sources

The agent starts with minimal context, then expands only what it needs for the current task.

## Why It Matters for AI Agents

### The Context Window Problem

LLMs have finite attention:
- Context windows are large (100K+ tokens) but not infinite
- **Context rot**: Performance degrades as token count increases
- Every token competes with other information
- Models trained on shorter sequences perform better at shorter contexts

### The Attention Budget

Think of attention as a budget:
- Each token in context "costs" attention
- Essential information: High ROI, always worth the cost
- Optional details: Low ROI unless currently needed
- Irrelevant content: Negative ROI, actively hurts performance

### Real Cost Examples

**Scenario: Writing a React component**

**Without progressive disclosure** (all in SKILL.md):
```
Context loaded:
- React basics (500 tokens)
- State management patterns (800 tokens)
- Testing approaches (600 tokens)
- Performance optimization (700 tokens)
- Deployment strategies (400 tokens)
- Security best practices (500 tokens)
= 3,500 tokens ALWAYS loaded
```

Agent must parse all this even though the task only needs state management.

**With progressive disclosure** (SKILL.md + references):
```
SKILL.md loaded:
- When to use this skill (100 tokens)
- Core component patterns (300 tokens)
- Pointers to reference files (50 tokens)
= 450 tokens loaded initially

reference/state-management.md loaded on demand:
- State management patterns (800 tokens)
= 1,250 tokens total when needed
```

**Savings**: 2,250 tokens (64% reduction) for tasks not needing full detail.

## Implementation Patterns

### Pattern 1: Core + References

**Structure**:
```
skill-name/
├── SKILL.md              # Core workflow only
└── reference/
    ├── detailed-api.md   # Loaded when agent needs API details
    ├── examples.md       # Loaded when agent needs examples
    └── troubleshooting.md # Loaded when agent hits issues
```

**SKILL.md**:
```markdown
## Working with the API

Make API calls using the standard client:
```python
client = APIClient(api_key)
result = client.query(params)
```

For detailed API reference, see reference/detailed-api.md
For common usage examples, see reference/examples.md
If you encounter errors, see reference/troubleshooting.md
```

**When agent needs details**, it reads the appropriate reference file.

### Pattern 2: Table of Contents References

For longer reference files, start with a table of contents:

**reference/api-guide.md**:
```markdown
# API Guide

## Contents
- Authentication (line 30)
- Endpoints (line 120)
- Request Formatting (line 250)
- Response Handling (line 380)
- Error Codes (line 480)
- Rate Limiting (line 550)

## Authentication
[Detailed auth documentation]

## Endpoints
[Detailed endpoints documentation]
...
```

Agent can scan the TOC and read only the relevant section.

### Pattern 3: Executable Scripts

Instead of detailed instructions, provide scripts:

**SKILL.md**:
```markdown
## Validate Configuration

Run the validation script:
```bash
python scripts/validate_config.py --input config.json
```

The script checks all requirements and outputs actionable errors.
```

**Why this works**:
- Script code doesn't load into context (just runs)
- Only script output (usually small) consumes tokens
- Deterministic, no LLM interpretation needed
- Can be complex internally without context cost

### Pattern 4: Conditional Loading Hints

Give the agent explicit hints about when to load details:

**SKILL.md**:
```markdown
## Database Operations

For simple queries, use:
```python
db.query("SELECT * FROM users WHERE id = ?", user_id)
```

**If you need to**:
- Perform joins → see reference/complex-queries.md
- Handle transactions → see reference/transactions.md
- Optimize performance → see reference/query-optimization.md
- Debug query issues → see reference/query-debugging.md
```

The agent loads references only when those conditions apply.

### Pattern 5: External Documentation Links

For widely-known tools, link to official docs:

**SKILL.md**:
```markdown
## Using FastAPI

This project uses FastAPI. For framework documentation, see:
https://fastapi.tiangolo.com/

Project-specific patterns:
- All routes in `api/routes/`
- Authentication via `auth.py` middleware
- Validation uses Pydantic models
```

Don't duplicate FastAPI documentation. Assume the agent can read external docs when needed.

### Pattern 6: Layered Workflows

Structure workflows with clear progression:

**SKILL.md**:
```markdown
## Deployment Workflow

### Basic Deployment (most common)
1. Run tests: `npm test`
2. Build: `npm run build`
3. Deploy: `npm run deploy`

### Advanced Deployment
If basic deployment fails or you need custom configuration:
See reference/advanced-deployment.md

### Emergency Rollback
If production issues occur:
See reference/emergency-procedures.md
```

Most tasks use basic workflow. Advanced details stay out of context until needed.

## Real-World Examples

### Example 1: API Client Skill

**Problem**: Skill for working with a complex REST API with 50+ endpoints.

**❌ Without Progressive Disclosure**:
```markdown
SKILL.md (5,000 lines):
- Overview
- Authentication details
- All 50 endpoints documented
- Request/response examples for each
- Error handling for each endpoint
- Rate limiting rules
- Retry strategies
- Pagination details
- Filtering options
- ...
```

Result: Agent loads 5,000 lines every time, even for simple single-endpoint tasks.

**✅ With Progressive Disclosure**:
```markdown
SKILL.md (300 lines):
- Overview
- Authentication basics
- Common patterns (CRUD operations)
- Pointer to reference/endpoints.md

reference/endpoints.md:
# Endpoints Reference

## Contents
- User Management (line 30)
- Data Queries (line 150)
- File Operations (line 280)
...

[Detailed endpoint docs]
```

Result: Agent loads 300 lines initially, expands only when specific endpoints needed.

### Example 2: Testing Patterns Skill

**Problem**: Skill for testing in a project with unit, integration, E2E, and performance tests.

**❌ Without Progressive Disclosure**:
All testing documentation in SKILL.md:
- Unit testing guide (1,000 lines)
- Integration testing guide (800 lines)
- E2E testing guide (1,200 lines)
- Performance testing guide (600 lines)
- Mocking strategies (400 lines)
= 4,000 lines total

**✅ With Progressive Disclosure**:
```
SKILL.md (400 lines):
- When to use each test type
- Basic test structure
- Running tests
- Pointers to detailed guides

reference/
├── unit-testing.md      # 1,000 lines
├── integration-testing.md # 800 lines
├── e2e-testing.md       # 1,200 lines
└── performance-testing.md # 600 lines
```

Agent loads only the relevant testing guide for current task.

### Example 3: Database Schema Skill

**Problem**: Complex database with 30 tables, relationships, indexes, and constraints.

**✅ With Progressive Disclosure**:
```markdown
SKILL.md:
- Schema overview (5 main domain areas)
- Common query patterns
- Pointer to reference/schema-details.md

reference/schema-details.md:
# Schema Details

## Contents
- User Domain (line 50)
- Product Domain (line 200)
- Order Domain (line 350)
- Analytics Domain (line 500)
- System Domain (line 650)

[Detailed schema for each domain]

scripts/generate_schema_diagram.py:
# Generates visual ER diagram on demand
```

Agent loads overview, then drills into specific domains when working with those tables.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Deep Nesting

**❌ Don't**:
```
SKILL.md references →
reference/guide.md references →
reference/detailed-guide.md references →
reference/even-more-detail.md
```

**Why it fails**: Agent loses mental model navigating multiple hops.

**✅ Do**:
```
SKILL.md references → reference/guide.md
(stop there, put all detail in that file)
```

Keep it one level deep.

### Anti-Pattern 2: Circular References

**❌ Don't**:
```
SKILL.md → reference/a.md → reference/b.md → SKILL.md
```

Agent gets stuck in loops.

**✅ Do**: Make references flow one direction (SKILL.md → references, never back).

### Anti-Pattern 3: Unclear Loading Triggers

**❌ Don't**:
```markdown
See reference/advanced.md for more information.
```

When should the agent load it?

**✅ Do**:
```markdown
If you need to handle transactions or complex joins,
see reference/advanced-queries.md
```

Clear trigger condition.

### Anti-Pattern 4: Duplicated Content

**❌ Don't**:
```
SKILL.md: Brief version of workflow
reference/workflow.md: Detailed version of workflow
```

Keep one version, reference it.

**✅ Do**:
```
SKILL.md: Core workflow steps
reference/workflow.md: Extended examples and edge cases
```

No overlap, clear separation.

### Anti-Pattern 5: Reference Files Too Small

**❌ Don't**:
```
reference/
├── auth-step1.md (50 lines)
├── auth-step2.md (50 lines)
├── auth-step3.md (50 lines)
└── auth-step4.md (50 lines)
```

Too granular, agent needs to load multiple files.

**✅ Do**:
```
reference/
└── authentication.md (200 lines with TOC)
```

Consolidate related content.

### Anti-Pattern 6: Everything as Script

**❌ Don't**:
```
# In SKILL.md: Run script for everything
python scripts/do_task_a.py
python scripts/do_task_b.py
python scripts/do_task_c.py
```

Loses the benefit of LLM reasoning.

**✅ Do**: Use scripts for deterministic operations, LLM reasoning for adaptive tasks.

## Measuring Effectiveness

### Metrics to Track

**Token Usage**:
- Average tokens per task execution
- Tokens loaded vs tokens actually needed
- Track over time: Are skills getting bloated?

**Agent Performance**:
- Task completion rate
- Number of correction rounds needed
- Types of errors made

**Skill Usage Patterns**:
- Which reference files get loaded?
- Which never get loaded? (candidates for removal)
- What triggers reference loading?

### Evaluation Approach

Test skills with representative tasks:

1. **Simple task**: Should load minimal context
2. **Medium task**: Should load 1-2 reference files
3. **Complex task**: Should load multiple references as needed
4. **Edge case**: Should find troubleshooting info

Measure:
- Token count at each step
- Whether agent found needed information
- If agent loaded irrelevant information

### Optimization Process

1. **Instrument**: Log what gets loaded for each task
2. **Analyze**: Find patterns (what's always loaded? never loaded?)
3. **Refactor**: Move rarely-used content to references
4. **Test**: Verify agent still works correctly
5. **Repeat**: Continuous improvement

### Signs Your Progressive Disclosure Works

✅ **Good indicators**:
- Agent loads <30% of total skill content for simple tasks
- Reference files clearly separated by concern
- Agent rarely loads irrelevant references
- Task success rate high across different complexity levels

❌ **Warning signs**:
- Agent loads everything every time
- Agent frequently fails to find information it needs
- Reference files rarely accessed (might as well be in SKILL.md)
- Agent gets confused navigating references

## Key Takeaways

1. **Start minimal**: SKILL.md should be as small as possible while remaining useful
2. **One level deep**: SKILL.md → references, don't nest further
3. **Clear triggers**: Tell agent when to load details
4. **Scripts for determinism**: Use scripts for complex but fixed logic
5. **External docs**: Link to official documentation, don't duplicate
6. **Measure and iterate**: Track what gets loaded, optimize based on data
7. **Consolidate related content**: Don't fragment too much
8. **Test across task types**: Simple, medium, complex should use different amounts

Progressive disclosure is about respecting the agent's attention budget. Give it what it needs when it needs it, and nothing more.
