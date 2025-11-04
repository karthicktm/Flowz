---
description: Generate and execute a custom workflow from natural language description
---

You are creating a workflow based on the user's request. Follow these steps exactly.

**⚠️ CRITICAL RULES - READ FIRST:**

1. **MATCH THE USER'S REQUEST EXACTLY** - Don't simplify, don't "start simple", don't remove features
2. **DEBUG, DON'T SIMPLIFY** - If something fails, fix the error. Never create a "simpler version"
3. **PERSIST UNTIL IT WORKS** - Keep debugging and fixing until the exact workflow the user requested works
4. **USE ALL AVAILABLE MODULES** - Don't avoid complex modules, they're there to be used
5. **ASK FOR WHAT YOU NEED** - If you need API keys, ask for them. Don't skip features because keys are missing

**Step 1: Discover available modules**

Use the module search script to find relevant modules:

```bash
# List all categories and modules
npx tsx scripts/search-modules.ts

# Search for specific functionality
npx tsx scripts/search-modules.ts "email"
npx tsx scripts/search-modules.ts "twitter"

# List all modules in a category
npx tsx scripts/search-modules.ts --category communication
npx tsx scripts/search-modules.ts --category social
```

Available categories:
- `communication` - Email, Slack, Discord, Telegram
- `social` - Twitter, Reddit, YouTube, Instagram, GitHub
- `data` - MongoDB, PostgreSQL, Airtable, Google Sheets, Notion
- `ai` - OpenAI, Anthropic
- `utilities` - HTTP, RSS, datetime, filesystem, CSV, images, PDF, XML, encryption, compression
- `payments` - Stripe
- `productivity` - Google Calendar

**Alternative:** Read `src/lib/workflows/module-registry.ts` directly for full details.

**Step 2: Generate workflow JSON**

Based on the user's request, create a workflow export format:

```typescript
{
  version: "1.0",
  name: "Short descriptive name",
  description: "What this workflow does",
  config: {
    steps: [
      {
        id: "step1",
        module: "category.module.function", // MUST be lowercase: utilities.datetime.now
        inputs: { param: "value" },
        outputAs: "variableName" // Optional: save output for next steps
      }
    ],
    // OPTIONAL: Control how the output is displayed
    outputDisplay: {
      type: "table" | "list" | "text" | "markdown" | "json" | "image" | "images",
      columns: [ // Only for type: "table"
        { key: "fieldName", label: "Column Header", type: "text" | "link" | "date" | "number" | "boolean" }
      ]
    }
  },
  metadata: {
    author: "b0t AI",
    tags: ["automation", "category"],
    category: "content" | "social-media" | "data" | "communication" | "utilities",
    requiresCredentials: ["openai", "twitter"] // List platforms that need API keys
  }
}
```

**CRITICAL RULES:**
- Module paths MUST be `category.module.function` format (all lowercase)
- Use `{{variableName}}` to reference previous step outputs
- Access nested data: `{{feed.items[0].title}}`
- Each step's inputs are passed as positional arguments to the function
- `version` field is required (use "1.0")
- `metadata.requiresCredentials` lists which API keys the user needs to configure

**OUTPUT DISPLAY CONFIGURATION:**

The `outputDisplay` field is OPTIONAL - only use it when the user specifically requests custom columns or display format.

**When to add outputDisplay:**
- User asks for specific columns: "show only title and stars"
- User wants custom order or labels

**Format:**
```json
{
  "outputDisplay": {
    "type": "table",  // table | list | text | markdown | json | image | images
    "columns": [      // only for type: "table"
      { "key": "fieldName", "label": "Column Header", "type": "text" }
    ]
  }
}
```

Column types: `text`, `link`, `date`, `number`, `boolean`

**If not specified:** System auto-detects best format (table with up to 8 columns for arrays of objects)

**Step 3: Validate and import workflow**

Use the helper scripts to validate and import the workflow:

1. **Write workflow to temp file** using the Write tool:
   ```
   /tmp/workflow.json
   ```

2. **Validate the workflow:**
   ```bash
   npx tsx scripts/validate-workflow.ts /tmp/workflow.json
   ```
   This checks:
   - JSON structure is valid
   - All module paths exist in registry
   - Variable references are correct
   - Required fields are present

3. **Import the workflow:**
   ```bash
   npx tsx scripts/import-workflow.ts /tmp/workflow.json
   ```
   This will:
   - Validate the workflow structure via API
   - Create it in the database with a unique ID
   - Return the workflow ID and required credentials list
   - Make it appear immediately in the UI at `/dashboard/workflows`

**Alternative (direct API call):**
```bash
curl -X POST http://localhost:3000/api/workflows/import \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs '{workflowJson: .}' /tmp/workflow.json)"
```

**Step 4: Test the workflow**

Use the test script to verify the workflow works correctly:

```bash
# Dry run (check structure without executing)
npx tsx scripts/test-workflow.ts /tmp/workflow.json --dry-run

# Execute and get detailed results
npx tsx scripts/test-workflow.ts /tmp/workflow.json
```

The test script will:
- Import the workflow temporarily
- Execute it and measure duration
- Show detailed output or error information
- **Analyze errors automatically** and categorize them:
  - ✅ **Claude can fix**: Module paths, variable references, type mismatches, invalid inputs
  - ⚠️  **User action required**: Missing API keys, network issues, permission errors
  - 🤝 **Both**: Rate limits, complex logic errors
- Clean up the test workflow automatically

**Error Analysis Examples:**

If the workflow fails, you'll see:
```
❌ Workflow execution failed
💥 Failed at step: fetch-tweets
📋 Error: API key missing or invalid

🔍 Error Analysis:
   Category: Missing Credentials
   Suggestion: Configure API credentials at http://localhost:3000/settings/credentials
   ⚠️  User action required
```

**After testing succeeds**, verify in the UI:
1. Import permanently: `npx tsx scripts/import-workflow.ts /tmp/workflow.json`
2. Check it appears at http://localhost:3000/dashboard/workflows
3. Click "Run" to execute again
4. View results and history

**Step 5: Show results**

Display:
- ✅ Workflow tested and working
- 📍 Location: Dashboard → Workflows (after permanent import)
- 🎯 Execution result: [success/failure with details]
- 💡 Tip: Use "Settings" to configure AI prompts, trigger schedules, and step parameters
- Show the workflow JSON for reference

**When workflow fails:**

**CRITICAL: NEVER SIMPLIFY OR DUMB DOWN THE WORKFLOW!**

Your job is to DEBUG, not to create a simpler version. Users want exactly what they asked for.

1. **Read the error analysis output carefully**
2. **Understand the root cause** - Don't guess, investigate:
   - What step failed?
   - What was the exact error message?
   - What input caused the failure?
   - Is the module path correct?
   - Are variable references valid?
   - Are inputs in the correct format?

3. **If "Claude can fix" (✅):**
   - **Fix the EXACT issue** - wrong module path, missing variable, type mismatch, etc.
   - **Keep the same workflow complexity** - don't remove steps or features
   - Re-test with the fix
   - If still failing, investigate deeper - don't simplify!

4. **If "User action required" (⚠️):**
   - Explain EXACTLY what the user needs to do
   - Provide the exact link: `http://localhost:3000/settings/credentials`
   - List which API keys are needed
   - Wait for user to add credentials, then re-test

5. **If "Both" (🤝):**
   - Fix the code issues you can
   - Explain what the user must provide (API keys, etc.)
   - Keep trying until it works!

**DEBUGGING MINDSET:**
- ❌ **NEVER**: "Let me create a simpler version"
- ❌ **NEVER**: "Let's try with fewer steps"
- ❌ **NEVER**: "Let's remove this feature for now"
- ✅ **ALWAYS**: "Let me fix this specific error"
- ✅ **ALWAYS**: "The issue is X, here's the fix"
- ✅ **ALWAYS**: "I need your API key for Y"

**Remember:** The user requested a specific workflow. Your job is to make THAT workflow work, not to create something easier.

**Workflow UI Features:**
- **Run Button**: Execute workflow (label changes based on trigger: Chat, Webhook, Schedule, Telegram, Discord, or Run)
- **Settings Button**: Unified configuration dialog for:
  - Trigger settings (cron schedules, bot tokens)
  - Step settings (AI prompts, model selection, parameters)
  - All configurable fields auto-detected based on module type
- **Credentials Button**: Manage API keys and OAuth tokens
- **History Button**: View execution logs and results
- **Export/Delete Icons**: In workflow card header

**Example: "Get current date and format it"**

1. **Read module registry** - Check available datetime functions
2. **Generate workflow JSON:**
```json
{
  "version": "1.0",
  "name": "Date Formatter",
  "description": "Gets current date and formats it",
  "config": {
    "steps": [
      {
        "id": "get-date",
        "module": "utilities.datetime.now",
        "inputs": {},
        "outputAs": "currentDate"
      },
      {
        "id": "format-iso",
        "module": "utilities.datetime.toISO",
        "inputs": { "date": "{{currentDate}}" },
        "outputAs": "isoDate"
      }
    ]
  },
  "metadata": {
    "author": "b0t AI",
    "tags": ["utilities", "datetime"],
    "category": "utilities"
  }
}
```

3. **Validate, test, and import:**
   ```bash
   # Validate structure
   npx tsx scripts/validate-workflow.ts /tmp/workflow.json

   # Test execution (dry run first)
   npx tsx scripts/test-workflow.ts /tmp/workflow.json --dry-run

   # Test with real execution
   npx tsx scripts/test-workflow.ts /tmp/workflow.json

   # If successful, import permanently
   npx tsx scripts/import-workflow.ts /tmp/workflow.json
   ```
4. **Tell user**: "✅ Workflow tested and working! Visit http://localhost:3000/dashboard/workflows to run it"

**Important:** Always verify module names exist in the registry before creating workflows. Use exact function signatures from the module files.

## **CRITICAL: New Generic Workflow Modules**

You now have access to powerful generic modules that enable complex workflow patterns:

### **1. Database Operations** (`data.database.*`)
- `query()` - Query with WHERE conditions
- `queryWhereIn()` - Query with WHERE IN clause
- `insert()` - Insert records
- `update()` - Update records
- `exists()` - Check if record exists
- `count()` - Count records

### **2. Deduplication** (`utilities.deduplication.*`)
- `filterProcessed()` - Filter out already-processed IDs
- `filterProcessedItems()` - Filter array to remove processed items
- `hasProcessed()` - Check if single item was processed

### **3. Scoring & Ranking** (`utilities.scoring.*`)
- `rankByWeightedScore()` - Rank by custom weighted metrics (engagement, popularity, etc.)
- `selectTop()` - Select top N items
- `rankByField()` - Simple ranking by single field

### **4. Array Utilities** (`utilities.array-utils.*`)
- `pluck()` - Extract property values
- `sortBy()` - Sort objects by property
- `first()`, `last()` - Get items from ends
- `sum()`, `average()` - Aggregate operations

## **Pattern: Deduplication + Ranking + Selection**

Many workflows follow this pattern (Twitter replies, YouTube comments, etc.):

```json
{
  "steps": [
    {
      "id": "fetch-data",
      "module": "external-apis.rapidapi.twitter.searchTwitter",
      "inputs": { "query": "AI automation" },
      "outputAs": "results"
    },
    {
      "id": "extract-ids",
      "module": "utilities.array-utils.pluck",
      "inputs": { "arr": "{{results.results}}", "key": "tweet_id" },
      "outputAs": "allIds"
    },
    {
      "id": "filter-processed",
      "module": "utilities.deduplication.filterProcessed",
      "inputs": {
        "tableName": "tweet_replies",
        "idColumn": "original_tweet_id",
        "idsToCheck": "{{allIds}}"
      },
      "outputAs": "newIds"
    },
    {
      "id": "rank-by-engagement",
      "module": "utilities.scoring.rankByWeightedScore",
      "inputs": {
        "items": "{{results.results}}",
        "scoreFields": [
          { "field": "likes", "weight": 1 },
          { "field": "retweets", "weight": 2 }
        ],
        "tieBreaker": { "field": "created_at", "order": "desc" }
      },
      "outputAs": "ranked"
    },
    {
      "id": "select-best",
      "module": "utilities.scoring.selectTop",
      "inputs": { "items": "{{ranked}}", "count": 1 },
      "outputAs": "selected"
    },
    {
      "id": "save-result",
      "module": "data.database.insert",
      "inputs": {
        "table": "tweet_replies",
        "data": {
          "original_tweet_id": "{{selected.tweet_id}}",
          "processed_at": "{{utilities.datetime.now}}"
        }
      }
    }
  ]
}
```

## **When to Create New Module Functions**

If the user requests complex logic that requires:
- Custom business rules
- Multi-step transformations
- Platform-specific combinations

Then you should:
1. Create a new module file in `src/modules/[category]/[module-name].ts`
2. Update the module registry in `src/lib/workflows/module-registry.ts`
3. Use the new module in the workflow JSON

**Example:** A "findBestTweetToReplyTo" function that combines search + filter + rank + select into one reusable module.
