import { logger } from '@/lib/logger';

/**
 * Workflow Import/Export
 *
 * Share workflows with others via JSON files.
 * Similar to Docker Compose or GitHub Actions - portable workflow definitions.
 */

export interface WorkflowExport {
  version: string; // Schema version for future compatibility
  name: string;
  description: string;
  config: {
    steps: Array<{
      id: string;
      module: string;
      inputs: Record<string, unknown>;
      outputAs?: string;
    }>;
    outputDisplay?: {
      type: 'table' | 'list' | 'text' | 'markdown' | 'json' | 'image' | 'images';
      columns?: Array<{
        key: string;
        label: string;
        type?: 'text' | 'link' | 'date' | 'number' | 'image';
      }>;
    };
  };
  metadata?: {
    author?: string;
    created?: string;
    tags?: string[];
    category?: string;
    requiresCredentials?: string[]; // e.g., ['openai', 'stripe']
  };
}

/**
 * Export a workflow to a shareable JSON format
 */
export function exportWorkflow(
  name: string,
  description: string,
  config: {
    steps: Array<{
      id: string;
      module: string;
      inputs: Record<string, unknown>;
      outputAs?: string;
    }>;
    outputDisplay?: {
      type: 'table' | 'list' | 'text' | 'markdown' | 'json' | 'image' | 'images';
      columns?: Array<{
        key: string;
        label: string;
        type?: 'text' | 'link' | 'date' | 'number' | 'image';
      }>;
    };
  },
  metadata?: {
    author?: string;
    tags?: string[];
    category?: string;
    requiresCredentials?: string[];
  }
): WorkflowExport {
  logger.info({ name }, 'Exporting workflow');

  const exportData: WorkflowExport = {
    version: '1.0',
    name,
    description,
    config,
    metadata: {
      ...metadata,
      created: new Date().toISOString(),
    },
  };

  return exportData;
}

/**
 * Export workflow to JSON string
 */
export function exportWorkflowToJSON(
  name: string,
  description: string,
  config: {
    steps: Array<{
      id: string;
      module: string;
      inputs: Record<string, unknown>;
      outputAs?: string;
    }>;
    outputDisplay?: {
      type: 'table' | 'list' | 'text' | 'markdown' | 'json' | 'image' | 'images';
      columns?: Array<{
        key: string;
        label: string;
        type?: 'text' | 'link' | 'date' | 'number' | 'image';
      }>;
    };
  },
  metadata?: {
    author?: string;
    tags?: string[];
    category?: string;
    requiresCredentials?: string[];
  }
): string {
  const exportData = exportWorkflow(name, description, config, metadata);
  return JSON.stringify(exportData, null, 2);
}

/**
 * Import a workflow from JSON
 */
export function importWorkflow(jsonData: string): WorkflowExport {
  logger.info('Importing workflow from JSON');

  try {
    const workflow = JSON.parse(jsonData) as WorkflowExport;

    // Validate required fields
    if (!workflow.version) {
      throw new Error('Missing version field in workflow');
    }

    if (!workflow.name) {
      throw new Error('Missing name field in workflow');
    }

    if (!workflow.description) {
      throw new Error('Missing description field in workflow');
    }

    if (!workflow.config || !workflow.config.steps) {
      throw new Error('Missing config.steps in workflow');
    }

    // Validate version compatibility
    if (workflow.version !== '1.0') {
      logger.warn(
        { version: workflow.version },
        'Workflow version may not be fully compatible'
      );
    }

    // Validate steps
    for (const step of workflow.config.steps) {
      if (!step.id) {
        throw new Error('Step missing id field');
      }
      if (!step.module) {
        throw new Error(`Step ${step.id} missing module field`);
      }
      if (!step.inputs || typeof step.inputs !== 'object') {
        throw new Error(`Step ${step.id} missing or invalid inputs field`);
      }

      // Validate module path format (category.module.function)
      const parts = step.module.split('.');
      if (parts.length !== 3) {
        throw new Error(
          `Step ${step.id} has invalid module path: ${step.module}. Expected format: category.module.function`
        );
      }
    }

    logger.info(
      { name: workflow.name, stepCount: workflow.config.steps.length },
      'Workflow imported successfully'
    );

    return workflow;
  } catch (error) {
    logger.error({ error }, 'Failed to import workflow');
    throw new Error(
      `Failed to import workflow: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Validate workflow export format
 */
export function validateWorkflowExport(workflow: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!workflow || typeof workflow !== 'object') {
    return { valid: false, errors: ['Workflow must be an object'] };
  }

  const w = workflow as Record<string, unknown>;

  if (!w.version || typeof w.version !== 'string') {
    errors.push('Missing or invalid version field');
  }

  if (!w.name || typeof w.name !== 'string') {
    errors.push('Missing or invalid name field');
  }

  if (!w.description || typeof w.description !== 'string') {
    errors.push('Missing or invalid description field');
  }

  if (!w.config || typeof w.config !== 'object') {
    errors.push('Missing or invalid config field');
  } else {
    const config = w.config as Record<string, unknown>;
    if (!Array.isArray(config.steps)) {
      errors.push('config.steps must be an array');
    } else {
      config.steps.forEach((step: unknown, index: number) => {
        if (!step || typeof step !== 'object') {
          errors.push(`Step ${index} must be an object`);
          return;
        }

        const s = step as Record<string, unknown>;
        if (!s.id) errors.push(`Step ${index} missing id field`);
        if (!s.module) errors.push(`Step ${index} missing module field`);
        if (!s.inputs || typeof s.inputs !== 'object') {
          errors.push(`Step ${index} missing or invalid inputs field`);
        }

        if (s.module && typeof s.module === 'string') {
          const parts = s.module.split('.');
          if (parts.length !== 3) {
            errors.push(
              `Step ${index} has invalid module path: ${s.module}. Expected: category.module.function`
            );
          }
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Extract required credentials from workflow
 */
export function extractRequiredCredentials(workflow: WorkflowExport): string[] {
  const credentials = new Set<string>();

  // Check metadata first
  if (workflow.metadata?.requiresCredentials) {
    workflow.metadata.requiresCredentials.forEach((cred) => credentials.add(cred));
  }

  // Scan steps for {{user.platform}} references
  for (const step of workflow.config.steps) {
    const inputsStr = JSON.stringify(step.inputs);
    const matches = inputsStr.match(/\{\{user\.(\w+)\}\}/g);
    if (matches) {
      matches.forEach((match) => {
        const platform = match.match(/\{\{user\.(\w+)\}\}/)?.[1];
        if (platform) credentials.add(platform);
      });
    }
  }

  return Array.from(credentials);
}

/**
 * Generate workflow file name (safe for file system)
 */
export function generateWorkflowFileName(workflowName: string): string {
  return (
    workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.workflow.json'
  );
}
