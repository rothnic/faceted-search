# Advanced Skill Patterns

Beyond basic skill creation, these advanced patterns solve specific challenges in complex scenarios.

## Table of Contents
- Feedback Loop Patterns (line 15)
- Plan-Validate-Execute (line 80)
- Multi-File Generation (line 150)
- Skill Composition (line 210)
- Dynamic Workflows (line 270)
- Error Recovery Patterns (line 330)
- Performance Optimization (line 390)

## Feedback Loop Patterns

### The Problem

For quality-critical work, one-shot generation often isn't enough. The agent needs to:
- Generate draft
- Review against criteria
- Identify issues
- Revise
- Repeat until quality threshold met

### The Pattern

Build feedback loops into the workflow:

```markdown
## Generate Documentation

Follow this feedback loop:

1. **Generate draft**
   - Write initial documentation
   - Save as draft.md

2. **Self-review**
   - Check against quality criteria:
     * All sections present
     * Code examples tested
     * Clear explanations
     * Consistent terminology
   - Document issues in review.md

3. **Revise**
   - Address each issue from review
   - Update draft.md

4. **Final check**
   - Re-review revised version
   - If quality criteria met: Accept
   - If issues remain: Repeat from step 2 (max 3 iterations)

5. **Finalize**
   - Move draft.md to final location
   - Archive review.md
```

### When to Use

✅ **Good for**:
- Documentation generation
- Code review and improvement
- Content creation
- Complex reasoning tasks

❌ **Not needed for**:
- Simple transformations
- Deterministic operations
- Low-stakes tasks

### Implementation Tips

**Provide concrete criteria**:
```markdown
Quality criteria:
- [ ] All function parameters documented
- [ ] At least one example per function
- [ ] No broken links
- [ ] Code examples are syntactically correct
- [ ] Follows project style guide
```

**Limit iterations**:
```markdown
Repeat review-revise cycle up to 3 times.
If issues persist after 3 iterations, flag for human review.
```

**Make criteria checkable**:
- Use objective measures when possible
- Provide examples of good/bad
- Reference style guides or standards

## Plan-Validate-Execute

### The Problem

High-stakes operations can cause damage if done incorrectly:
- Batch file updates
- Database migrations
- Configuration changes
- Mass refactoring

One-shot execution is risky. You need to validate the plan before applying changes.

### The Pattern

Create verifiable intermediate outputs:

```markdown
## Database Migration

Use plan-validate-execute pattern:

1. **Analyze current state**
   - Run `scripts/analyze_schema.py`
   - Review current schema structure

2. **Generate migration plan**
   - Create migration-plan.json with:
     * Tables to modify
     * Columns to add/remove/change
     * Indexes to create/drop
     * Data transformations needed
   - Include rollback steps

3. **Validate plan**
   - Run `scripts/validate_migration.py migration-plan.json`
   - Script checks:
     * No conflicting changes
     * All referenced tables/columns exist
     * Data types are compatible
     * Rollback steps are valid

4. **Review validation**
   - If validation fails: Fix plan and re-validate
   - If validation passes: Proceed to execution

5. **Execute migration**
   - Run `scripts/apply_migration.py migration-plan.json`
   - Script applies changes transactionally
   - Automatically rolls back on error

6. **Verify results**
   - Run `scripts/verify_schema.py`
   - Confirm changes match plan
   - Test sample queries
```

### The Validation Script

```python
# scripts/validate_migration.py
import json
import sys

def validate_migration_plan(plan_file):
    """Validate migration plan before execution"""
    with open(plan_file) as f:
        plan = json.load(f)
    
    errors = []
    warnings = []
    
    # Check for conflicting changes
    for change in plan['changes']:
        if conflicts_detected(change):
            errors.append(f"Conflict: {change}")
    
    # Validate table references
    for table in plan['tables']:
        if not table_exists(table):
            errors.append(f"Table not found: {table}")
    
    # Check data type compatibility
    for col_change in plan['column_changes']:
        if not types_compatible(col_change['from'], col_change['to']):
            warnings.append(f"Type change may lose data: {col_change}")
    
    # Verify rollback steps exist
    if not plan.get('rollback'):
        errors.append("No rollback steps defined")
    
    if errors:
        print("VALIDATION FAILED")
        for error in errors:
            print(f"ERROR: {error}")
        sys.exit(1)
    
    if warnings:
        print("VALIDATION PASSED WITH WARNINGS")
        for warning in warnings:
            print(f"WARNING: {warning}")
    else:
        print("VALIDATION PASSED")
    
    sys.exit(0)
```

### When to Use

✅ **Good for**:
- Database migrations
- Batch file operations
- Configuration updates
- Destructive changes
- Operations requiring rollback

❌ **Overkill for**:
- Single file edits
- Read-only operations
- Easily reversible changes

## Multi-File Generation

### The Problem

Complex tasks often require generating multiple related files:
- New API endpoint + tests + docs
- Database model + migration + fixtures
- Component + styles + stories + tests

Generating them one-by-one loses context. Generating all at once risks inconsistency.

### The Pattern

**Manifest-driven generation**:

```markdown
## Create New Feature

Use manifest-driven generation:

1. **Create feature manifest**
   - Save to feature-manifest.json:
   ```json
   {
     "feature_name": "user-authentication",
     "files_to_generate": [
       {
         "path": "src/auth/authenticate.ts",
         "type": "implementation",
         "depends_on": []
       },
       {
         "path": "src/auth/authenticate.test.ts",
         "type": "test",
         "depends_on": ["src/auth/authenticate.ts"]
       },
       {
         "path": "docs/api/authentication.md",
         "type": "documentation",
         "depends_on": ["src/auth/authenticate.ts"]
       }
     ],
     "shared_context": {
       "auth_method": "JWT",
       "token_expiry": "24h"
     }
   }
   ```

2. **Validate manifest**
   - Run `scripts/validate_manifest.py feature-manifest.json`
   - Checks dependencies are valid
   - Verifies paths don't conflict

3. **Generate in dependency order**
   - For each file in manifest:
     * Generate based on type and shared context
     * Pass previous files as context
     * Save to specified path
   
4. **Cross-validate**
   - Check consistency across files:
     * API signatures match tests
     * Documentation matches implementation
     * No missing dependencies

5. **Integration test**
   - Run project tests
   - Verify new feature integrates correctly
```

### Benefits

- **Consistency**: Shared context prevents divergence
- **Dependency tracking**: Generate in correct order
- **Completeness**: Manifest ensures nothing forgotten
- **Reviewability**: See what will be generated before generation

### When to Use

✅ **Good for**:
- Feature scaffolding
- Boilerplate generation
- Code generation from specs
- Multi-file refactoring

❌ **Overkill for**:
- Single file changes
- Simple additions

## Skill Composition

### The Problem

Complex domains need multiple related skills. How do you organize and reference them?

### Pattern 1: Parent-Child Skills

**Parent skill** (high-level):
```yaml
---
name: web-development
description: Build web applications using our tech stack and conventions
---

# Web Development

This is a meta-skill that coordinates specialized skills.

## Available Sub-Skills

- **frontend-development**: React components and UI patterns
- **backend-development**: API development and database patterns
- **testing**: Testing strategies for web apps
- **deployment**: Deployment and CI/CD workflows

## Workflow

1. Identify which aspect you're working on
2. Load the appropriate sub-skill
3. Follow that skill's guidance
```

**Child skill** (specialized):
```yaml
---
name: frontend-development
description: Build React frontend components following project patterns and design system
---

# Frontend Development

Specialized guidance for React development.
Part of web-development skill family.
...
```

### Pattern 2: Skill References

Skills can reference each other:

```markdown
## Authentication

This project's authentication follows security-best-practices skill.

Project-specific implementation:
- Uses Auth0 specifically
- Tokens stored in httpOnly cookies
- Refresh token rotation enabled

For general security patterns, load security-best-practices skill.
```

### Pattern 3: Skill Hierarchies

```
skills/
├── general/
│   ├── code-style/
│   ├── git-workflow/
│   └── documentation/
├── backend/
│   ├── api-design/
│   ├── database/
│   └── security/
└── frontend/
    ├── react-patterns/
    ├── styling/
    └── testing/
```

Agent can load general + domain-specific skills together.

### When to Use

✅ **Good for**:
- Large, complex domains
- Reusable patterns across projects
- Clear domain boundaries
- Team with specialized roles

❌ **Overkill for**:
- Simple projects
- Single-domain work
- Small teams

## Dynamic Workflows

### The Problem

Sometimes the right workflow depends on context that can't be known in advance.

### The Pattern

**Conditional workflows with inspection**:

```markdown
## Deploy Application

Workflow varies by environment. Inspect first:

1. **Inspect context**
   ```bash
   python scripts/inspect_deployment_context.py
   ```
   
   Script outputs JSON:
   ```json
   {
     "environment": "production",
     "git_branch": "main",
     "pending_migrations": true,
     "breaking_changes": false,
     "last_deploy": "2026-06-09T10:00:00Z"
   }
   ```

2. **Choose workflow based on context**

   **IF** pending_migrations = true:
   - Follow migration workflow (see reference/migration-deploy.md)
   
   **ELSE IF** breaking_changes = true:
   - Follow breaking-change workflow (see reference/breaking-deploy.md)
   
   **ELSE IF** environment = "production":
   - Follow standard production workflow (below)
   
   **ELSE**:
   - Follow fast deployment workflow (below)

3. **Execute chosen workflow**
   [Workflow steps based on condition]
```

### Benefits

- **Adaptive**: Right workflow for the situation
- **Safe**: Inspects before acting
- **Explicit**: Clear decision logic
- **Maintainable**: Add new conditions as needed

### When to Use

✅ **Good for**:
- Deployment scenarios
- Multi-environment workflows
- Context-dependent operations

❌ **Overkill for**:
- Single-path workflows
- Always-the-same operations

## Error Recovery Patterns

### The Problem

Operations fail. Skills should guide recovery, not just initial execution.

### The Pattern

**Structured error handling**:

```markdown
## API Integration

### Normal Workflow
[Standard steps]

### Error Recovery

**IF** you encounter authentication errors:
1. Check if token is expired
2. If expired: Run `scripts/refresh_token.py`
3. Retry original operation
4. If still failing: Check API key validity

**IF** you encounter rate limiting (429):
1. Parse Retry-After header
2. Wait specified duration
3. Retry with exponential backoff
4. Max 3 retries, then report error

**IF** you encounter validation errors (400):
1. Parse error response for specific field
2. Check that field against our validation rules
3. If rules conflict: Document discrepancy
4. Don't retry without fixing input

**IF** you encounter server errors (500):
1. Log full error details
2. Wait 30 seconds
3. Retry once
4. If repeats: Fail fast and report

### Debugging Failed Requests

If errors persist:
1. Run `scripts/test_api_connection.py` to isolate issue
2. Check reference/api-troubleshooting.md
3. Review recent API changelog for breaking changes
4. Document issue for team review
```

### Benefits

- **Resilience**: Handles common failures automatically
- **Debugging guidance**: Clear path when things go wrong
- **Learning**: Errors teach agent about the system

### When to Use

✅ **Good for**:
- External API integrations
- File system operations
- Network operations
- Complex workflows with failure modes

❌ **Not needed for**:
- Simple, low-failure operations
- One-shot tasks

## Performance Optimization

### The Problem

Skills can become slow or token-heavy. How do you optimize?

### Pattern 1: Lazy Loading Optimization

```markdown
## Working with Large Dataset

### Quick Operations
For simple queries, use the standard approach:
[Simple workflow]

### Complex Operations
Only load optimization guide if:
- Processing >10,000 records
- Query taking >5 seconds
- Memory issues encountered

Then see reference/performance-optimization.md
```

Only load expensive content when performance matters.

### Pattern 2: Caching Results

```markdown
## Schema Analysis

1. **Check for cached schema**
   ```bash
   if [ -f .cache/schema.json ]; then
     cat .cache/schema.json
   else
     python scripts/analyze_schema.py > .cache/schema.json
     cat .cache/schema.json
   fi
   ```

2. **Use cached schema for current task**

3. **Invalidate cache if**:
   - Migration applied
   - Schema files modified
   - Cache older than 1 hour
```

Avoid recomputing expensive operations.

### Pattern 3: Incremental Workflows

```markdown
## Large Codebase Refactoring

Don't refactor everything at once. Use incremental approach:

1. **Identify scope**
   - List files needing changes
   - Save to refactor-manifest.json

2. **Process in batches**
   - Take first 10 files from manifest
   - Apply refactoring
   - Test batch
   - Mark complete in manifest

3. **Continue incrementally**
   - Repeat step 2 until manifest complete
   - Context stays small (only current batch)

4. **Final validation**
   - Run full test suite
   - Check all files processed
```

Break large operations into manageable chunks.

### When to Use

✅ **Good for**:
- Large-scale operations
- Expensive computations
- Token-heavy tasks
- Long-running workflows

❌ **Overkill for**:
- Small, fast operations
- One-time tasks

## Key Principles for Advanced Patterns

1. **Solve real problems**: Don't add complexity for its own sake
2. **Test thoroughly**: Advanced patterns have more failure modes
3. **Document clearly**: Complexity needs explanation
4. **Provide escape hatches**: Let agent deviate when needed
5. **Keep it maintainable**: Future you should understand it
6. **Measure effectiveness**: Track if patterns actually help

Advanced patterns trade simplicity for capability. Use them when the problem justifies the complexity.
