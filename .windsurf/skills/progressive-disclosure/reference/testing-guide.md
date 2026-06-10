# Testing Guide for Skills

Testing skills ensures they work reliably across different models and scenarios. This guide covers practical testing strategies.

## Table of Contents
- Why Test Skills (line 15)
- Building Evaluations (line 45)
- Testing Across Models (line 90)
- Test Scenarios (line 140)
- Iteration Based on Tests (line 200)
- Automated Testing (line 260)

## Why Test Skills

### Skills Are Code

Like any code, skills can:
- Have bugs (incorrect instructions)
- Miss edge cases
- Break with changes
- Work differently than intended
- Degrade over time

### Agent Behavior Is Non-Deterministic

Unlike traditional code:
- Same input may produce different outputs
- Different models interpret differently
- Context matters (what else is loaded)
- Temperature and sampling affect results

### Testing Reduces Surprises

Good testing catches:
- Instructions that confuse the agent
- Missing information agents need
- Workflows that don't match reality
- Model-specific limitations
- Token inefficiencies

## Building Evaluations

### Start Before Writing the Skill

Create test cases first:
1. List 3-5 realistic tasks the skill should handle
2. Write expected behaviors for each
3. Include at least one edge case
4. Document success criteria

### Example: API Client Skill

**Test Case 1: Simple Query**
```
Task: Fetch user data for user ID 123
Expected:
- Agent uses correct endpoint
- Includes authentication
- Handles response correctly
- Extracts relevant data

Success criteria:
- Correct API call made
- No errors
- Data properly extracted
```

**Test Case 2: Error Handling**
```
Task: Fetch user that doesn't exist (ID 99999)
Expected:
- Agent handles 404 gracefully
- Provides meaningful error message
- Doesn't retry unnecessarily

Success criteria:
- Recognizes error condition
- Communicates clearly to user
- Doesn't cause agent failure
```

**Test Case 3: Complex Query**
```
Task: Fetch paginated list of users with filters
Expected:
- Agent recognizes need for pagination
- Applies filters correctly
- Handles multiple pages
- Aggregates results

Success criteria:
- All pages fetched
- Filters applied correctly
- Complete dataset returned
```

### Evaluation Template

Create an evaluation document for each skill:

```markdown
# [Skill Name] Evaluations

## Test Case 1: [Name]

**Scenario**: [Describe the task]

**Given**: [Initial conditions/context]

**When**: [User request or trigger]

**Then**: [Expected behavior]

**Success Criteria**:
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

**Tested With**:
- [ ] Claude Opus
- [ ] Claude Sonnet
- [ ] Claude Haiku

**Results**: [Document outcomes]

**Issues Found**: [List problems]

**Fixes Applied**: [What changed]

---

## Test Case 2: [Name]
...
```

## Testing Across Models

### Why Test Multiple Models

Different models have different characteristics:

**Haiku** (fastest, most cost-effective):
- May miss nuanced instructions
- Better for straightforward workflows
- Tests if skill is clear enough

**Sonnet** (balanced):
- Good for most tasks
- Tests typical usage
- Representative of common deployment

**Opus** (most capable):
- Handles complex instructions
- Tests if skill enables advanced usage
- May compensate for skill weaknesses

### Testing Strategy

**Phase 1: Sonnet First**
- Most projects use Sonnet
- Good baseline for typical performance
- Catches major issues

**Phase 2: Haiku for Clarity**
- Tests if instructions are clear
- Exposes ambiguities
- Validates essential workflows

**Phase 3: Opus for Complexity**
- Tests advanced scenarios
- Validates complex workflows
- Ensures skill doesn't limit capabilities

### What to Look For

**Haiku**:
- Does it understand when to load the skill?
- Can it follow basic workflows?
- Does it get confused by complexity?

**Sonnet**:
- Does it handle typical scenarios well?
- Are instructions at right altitude?
- Does it navigate references effectively?

**Opus**:
- Can it handle edge cases?
- Does it make good decisions?
- Does it use advanced patterns appropriately?

## Test Scenarios

### Scenario Categories

#### 1. Discovery Tests
**Purpose**: Verify agent finds the skill when appropriate

**Test**:
- Give task that should trigger skill
- Verify agent loads it
- Give task that shouldn't trigger skill
- Verify agent doesn't load it

**Example**:
```
✅ "Create a REST API endpoint" → loads api-design skill
❌ "Write a function to sort an array" → doesn't load api-design skill
```

#### 2. Workflow Tests
**Purpose**: Verify agent follows workflows correctly

**Test**:
- Give task requiring multi-step workflow
- Verify agent follows steps in order
- Check for skipped or incorrect steps

**Example**:
```
Task: "Deploy the application"
Expected workflow:
1. Run tests
2. Build application
3. Deploy to staging
4. Verify staging
5. Deploy to production
```

#### 3. Reference Navigation Tests
**Purpose**: Verify agent finds and uses reference files

**Test**:
- Give task requiring detail not in SKILL.md
- Verify agent loads appropriate reference
- Check that agent doesn't load irrelevant references

**Example**:
```
Task: "Handle API authentication error"
Should load: reference/error-handling.md
Should not load: reference/performance-optimization.md
```

#### 4. Script Execution Tests
**Purpose**: Verify agent uses scripts appropriately

**Test**:
- Give task with available script
- Verify agent runs script (doesn't reimplement)
- Check agent handles script output correctly

**Example**:
```
Task: "Validate this configuration"
Should: Run scripts/validate_config.py
Should not: Write validation logic from scratch
```

#### 5. Boundary Tests
**Purpose**: Verify agent respects constraints

**Test**:
- Give task that violates stated constraints
- Verify agent refuses or warns
- Check agent suggests alternatives

**Example**:
```
Constraint: "Cannot modify files in system/ directory"
Task: "Update system/config.json"
Expected: Agent refuses and explains why
```

#### 6. Progressive Disclosure Tests
**Purpose**: Verify token efficiency

**Test**:
- Give simple task
- Measure tokens loaded
- Verify only essential content loaded

**Example**:
```
Task: "Make simple API call"
Should load: SKILL.md only (~500 tokens)
Should not load: All reference files (~5000 tokens)
```

### Creating Test Cases

For each skill, create at least one test for each category:

```markdown
## Skill: [Name]

### Discovery Test
- Task: [What to ask]
- Expected: [Should/shouldn't load skill]

### Workflow Test
- Task: [Multi-step task]
- Expected steps: [1, 2, 3...]

### Reference Navigation Test
- Task: [Requires reference]
- Should load: [Which reference]

### Script Execution Test
- Task: [Uses script]
- Should run: [Which script]

### Boundary Test
- Task: [Violates constraint]
- Expected: [Refusal or warning]

### Progressive Disclosure Test
- Task: [Simple task]
- Expected tokens: [Approximate count]
```

## Iteration Based on Tests

### The Test-Fix Loop

1. **Run test**: Execute task with agent
2. **Observe**: What did agent do?
3. **Compare**: How does it differ from expected?
4. **Diagnose**: Why did it differ?
5. **Fix**: Update skill
6. **Retest**: Verify fix works
7. **Regression test**: Ensure other tests still pass

### Common Issues and Fixes

**Issue**: Agent doesn't load skill when it should
**Diagnosis**: Description doesn't match task keywords
**Fix**: Add relevant terms to description

**Issue**: Agent loads skill when it shouldn't
**Diagnosis**: Description too broad
**Fix**: Make description more specific

**Issue**: Agent skips workflow steps
**Diagnosis**: Steps not clearly sequential
**Fix**: Number steps, add "in order" language

**Issue**: Agent doesn't find reference files
**Diagnosis**: Pointers not clear
**Fix**: Add explicit "see reference/file.md" statements

**Issue**: Agent reimplements script logic
**Diagnosis**: Doesn't know script exists or how to use it
**Fix**: Document script clearly with usage example

**Issue**: Agent loads all references every time
**Diagnosis**: No conditional loading hints
**Fix**: Add "if you need X, see Y" guidance

### Regression Prevention

After fixing an issue:
1. Add test case for that scenario
2. Run all existing tests
3. Document the issue and fix
4. Consider if other skills have same problem

## Automated Testing

### Evaluation Frameworks

Several frameworks support agent evaluation:

**Claude Evaluation Framework**:
```python
from anthropic import Anthropic

client = Anthropic()

test_case = {
    "task": "Create a REST API endpoint for user registration",
    "expected_actions": ["load skill", "follow workflow", "use templates"],
    "model": "claude-sonnet-4-20250514"
}

# Run test
response = client.messages.create(
    model=test_case["model"],
    system="[Your skill content]",
    messages=[{"role": "user", "content": test_case["task"]}]
)

# Evaluate response
# Check if expected actions occurred
```

**Custom Test Runner**:
```python
# test_skills.py
import json
from pathlib import Path

def load_test_cases(skill_name):
    """Load test cases for a skill"""
    test_file = Path(f"tests/{skill_name}_tests.json")
    return json.loads(test_file.read_text())

def run_test(test_case, model):
    """Execute a single test case"""
    # Setup agent with skill
    # Run task
    # Evaluate result
    pass

def test_skill(skill_name, models=["haiku", "sonnet", "opus"]):
    """Test a skill across models"""
    test_cases = load_test_cases(skill_name)
    results = {}
    
    for model in models:
        results[model] = []
        for test in test_cases:
            result = run_test(test, model)
            results[model].append(result)
    
    return results
```

### CI/CD Integration

Add skill testing to your CI pipeline:

```yaml
# .github/workflows/test-skills.yml
name: Test Skills

on:
  pull_request:
    paths:
      - '.windsurf/skills/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run skill tests
        run: python scripts/test_all_skills.py
      - name: Check token counts
        run: python scripts/check_token_usage.py
```

### Metrics to Track

**Per Test**:
- Pass/fail status
- Tokens used
- Execution time
- Model used

**Per Skill**:
- Overall pass rate
- Pass rate by model
- Average tokens per task
- Token efficiency (tokens used / task complexity)

**Over Time**:
- Test pass rate trends
- Token usage trends
- New test coverage
- Regression count

### Test Documentation

Document test results:

```markdown
# [Skill Name] Test Results

## Last Updated
2026-06-10

## Summary
- Total tests: 12
- Passing: 11
- Failing: 1
- Models tested: Haiku, Sonnet, Opus

## Results by Model

### Claude Opus
- Tests passed: 12/12
- Average tokens: 1,250
- Issues: None

### Claude Sonnet  
- Tests passed: 11/12
- Average tokens: 950
- Issues: Fails on edge case #7 (missing reference navigation)

### Claude Haiku
- Tests passed: 10/12
- Average tokens: 800
- Issues: 
  - Fails edge case #7
  - Struggles with complex workflow #5

## Action Items
- [ ] Fix reference navigation for edge case #7
- [ ] Simplify workflow #5 for Haiku
- [ ] Add more explicit triggers in description
```

## Best Practices Summary

### Before Writing
- [ ] Create 3-5 test cases covering different scenarios
- [ ] Document expected behaviors
- [ ] Define success criteria

### During Development
- [ ] Test with Sonnet first (baseline)
- [ ] Test with Haiku (clarity check)
- [ ] Test with Opus (advanced cases)
- [ ] Iterate based on failures

### After Writing
- [ ] Run all test cases
- [ ] Measure token usage
- [ ] Document results
- [ ] Create regression test suite

### Ongoing
- [ ] Test after any skill changes
- [ ] Add tests for reported issues
- [ ] Track metrics over time
- [ ] Update tests as product evolves

### Warning Signs

🚨 **Red flags** indicating testing problems:
- Skill "works" but you haven't formally tested it
- Only tested with one model
- No test cases documented
- High variance in agent behavior
- Frequent "weird" agent actions
- Token usage not measured
- No regression tests after fixes

✅ **Green flags** indicating good testing:
- 3+ documented test cases per skill
- Tested across model tiers
- Pass rate >90% on target model
- Token usage measured and acceptable
- Regression tests prevent recurring issues
- Test suite runs automatically
- Results documented and tracked

## Key Takeaways

1. **Test early**: Create test cases before writing the skill
2. **Test broadly**: Use multiple models and scenarios
3. **Test systematically**: Document cases and results
4. **Test continuously**: Retest after changes
5. **Test realistically**: Use actual tasks users will give
6. **Measure tokens**: Track efficiency, not just correctness
7. **Document results**: Track what works, what doesn't, and why
8. **Automate when possible**: CI/CD integration for critical skills

Good testing is the difference between skills that "kind of work sometimes" and skills that reliably deliver correct behavior.
