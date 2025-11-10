---
name: workflow-generator
description: "YOU MUST USE THIS SKILL when the user wants to create, build, or generate a workflow automation. Activate for requests like: 'create a workflow', 'build a workflow', 'generate a workflow', 'make a workflow', 'I want to automate', 'automate X to Y', 'schedule a task', 'monitor X and send to Y'. This skill searches for relevant modules, builds JSON config, validates, tests, and imports workflows to database. DO NOT use generic file reading/writing - use this skill instead for workflow generation tasks."
---

# Workflow Generator

## Process

### 1. Parse Request
Identify: **What data** → **Transform** → **When to run**

### 2. Search Modules
```bash
npx tsx scripts/search-modules.ts "keyword"
```
**Only use modules from search results.** Verify exact names.

**CRITICAL: Verify file exists before using:**
```bash
# If search shows: devtools.github.getTrendingRepositories
# Check: ls src/modules/devtools/ | grep github
# If file is "github.ts", module path is correct
```

### 3. Build JSON

**Pre-flight:**
- Check what API returns (Grep source if needed)
- Keep simple (no unnecessary steps)
- Verify every module exists

**Complete Structure:**
```json
{
  "version": "1.0",
  "name": "Workflow Name",
  "description": "What it does",

  "trigger": {
    "type": "manual|chat|cron|webhook|chat-input",
    "config": {
      // Placement: trigger configuration
    }
  },

  "config": {
    "steps": [
      {
        "id": "stepId",
        "module": "category.module.function",
        "inputs": {
          // Placement: step parameters
        },
        "outputAs": "varName"
      }
    ],
    "returnValue": "{{varName}}",   // Placement: config level
    "outputDisplay": {               // Placement: config level
      "type": "table|list|text|markdown|json",
      "columns": []
    }
  },

  "metadata": {
    "requiresCredentials": ["service"]
  }
}
```

### 4. Validate & Import
```bash
npx tsx scripts/auto-fix-workflow.ts workflow/{name}.json --write
npx tsx scripts/validate-workflow.ts workflow/{name}.json
npx tsx scripts/validate-output-display.ts workflow/{name}.json
npx tsx scripts/test-workflow.ts workflow/{name}.json
npx tsx scripts/import-workflow.ts workflow/{name}.json
```

## Placement Examples

### Trigger Configurations

**Manual (no config):**
```json
"trigger": {
  "type": "manual",
  "config": {}
}
```

**Chat (input variable):**
```json
"trigger": {
  "type": "chat",
  "config": {
    "inputVariable": "userMessage"
  }
}
```

**Cron (scheduled):**
```json
"trigger": {
  "type": "cron",
  "config": {
    "schedule": "0 9 * * *",
    "timezone": "America/New_York"
  }
}
```

**Webhook (no config):**
```json
"trigger": {
  "type": "webhook",
  "config": {}
}
```

**Chat Input (form with fields - REQUIRED):**
```json
"trigger": {
  "type": "chat-input",
  "config": {
    "fields": [
      {
        "id": "1",
        "label": "Field Label",
        "key": "fieldName",
        "type": "text",
        "required": true,
        "placeholder": "Enter value..."
      }
    ]
  }
}
```
**IMPORTANT:** `chat-input` requires a `fields` array with at least one field. Each field must have: `id`, `label`, `key`, `type`, `required`. Valid types: `text`, `textarea`, `number`, `date`, `select`, `checkbox`. Access field values using `{{trigger.fieldName}}` where `fieldName` is the field's `key`.

### Step Input Formats

**Direct parameters:**
```json
"inputs": {
  "param1": "value",
  "param2": 123
}
```

**Params wrapper:**
```json
"inputs": {
  "params": {
    "param1": "value",
    "param2": 123
  }
}
```

**Options wrapper (AI SDK always uses this):**
```json
"inputs": {
  "options": {
    "param1": "value",
    "param2": 123
  }
}
```

**JavaScript execute (code + context):**
```json
"inputs": {
  "options": {
    "code": "return data.filter(x => x.id > 5);",
    "context": {
      "data": "{{varName}}"
    }
  }
}
```

### Variable References

**Step output:**
```json
"text": "{{varName}}"           // From outputAs
```

**Trigger input:**
```json
"text": "{{trigger.userMessage}}"   // From trigger config
```

**Nested property:**
```json
"text": "{{aiOutput.content}}"      // AI SDK responses
```

**Special variables:**
```json
"timestamp": "{{$now}}"             // Current time
```

### Credentials

**In step inputs:**
```json
"inputs": {
  "params": {
    "apiKey": "{{credential.service_api_key}}"
  }
}
```

**In metadata:**
```json
"metadata": {
  "requiresCredentials": ["service1", "service2"]
}
```

### Output Display

**Table (at config level):**
```json
"config": {
  "steps": [...],
  "returnValue": "{{tableData}}",
  "outputDisplay": {
    "type": "table",
    "columns": [
      { "key": "fieldName", "label": "Display Name", "type": "text" },
      { "key": "url", "label": "Link", "type": "link" }
    ]
  }
}
```

**Text (at config level):**
```json
"config": {
  "steps": [...],
  "returnValue": "{{textOutput}}",
  "outputDisplay": {
    "type": "text"
  }
}
```

**List (at config level):**
```json
"config": {
  "steps": [...],
  "returnValue": "{{arrayOutput}}",
  "outputDisplay": {
    "type": "list"
  }
}
```

**No display (return raw):**
```json
"config": {
  "steps": [...],
  "returnValue": "{{data}}"
  // No outputDisplay
}
```

### AI SDK

**generateText:**
```json
{
  "module": "ai.ai-sdk.generateText",
  "inputs": {
    "options": {
      "prompt": "Your prompt here",
      "model": "gpt-4o-mini",
      "provider": "openai"
    }
  },
  "outputAs": "aiResult"
}
// Access text: "{{aiResult.content}}"
```

**chat:**
```json
{
  "module": "ai.ai-sdk.chat",
  "inputs": {
    "options": {
      "messages": [
        { "role": "system", "content": "System prompt" },
        { "role": "user", "content": "{{trigger.userMessage}}" }
      ],
      "model": "gpt-4o-mini",
      "provider": "openai"
    }
  }
}
```

## Key Rules

**Variables:**
- Use: `{{outputAs}}` not `{{stepId.outputAs}}`
- Trigger: `{{trigger.inputVariable}}`
- Nested: `{{var.property}}`

**Parameters:**
- Check search results for signature
- `(params: ...)` → wrap with `"params"`
- `(options: ...)` → wrap with `"options"`
- Direct destructuring → no wrapper

**AI SDK:**
- Always: `"inputs": { "options": { ... } }`
- Text access: `"{{aiOutput.content}}"`

**Credentials:**
- Format: `"{{credential.service_api_key}}"`
- Check existing workflows for exact names
- List in: `"metadata": { "requiresCredentials": [...] }`

**Output:**
- `returnValue` at `config` level
- `outputDisplay` at `config` level
- Table requires `columns` array

## Errors

- **Module/Function Not Found:** Not in search results. Search again.
- **Parameter Mismatch:** Wrong wrapper. Check signature.
- **Credential Error:** Check existing workflows for name format.

See `examples.md` for complete working workflows.
