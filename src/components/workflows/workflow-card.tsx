'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Download, Trash2, Workflow as WorkflowIcon, Play, Key, MessageSquare, Webhook, Clock, Send, Sliders, BarChart3, Table2, Image as ImageIcon, FileText, Braces, List } from 'lucide-react';
import { WorkflowListItem } from '@/types/workflows';
import { WorkflowExecutionDialog } from './workflow-execution-dialog';
import { CredentialsConfigDialog } from './credentials-config-dialog';
import { WorkflowSettingsDialog } from './workflow-settings-dialog';
import { WorkflowOutputsDialog } from './workflow-outputs-dialog';
import { detectOutputDisplay, getOutputTypeLabel, getOutputTypeIcon } from '@/lib/workflows/analyze-output-display';
import { toast } from 'sonner';

interface WorkflowCardProps {
  workflow: WorkflowListItem;
  onDeleted: () => void;
  onExport: (id: string) => void;
  onViewHistory: (id: string) => void;
  onUpdated?: () => void;
}

export function WorkflowCard({ workflow, onDeleted, onExport, onViewHistory, onUpdated }: WorkflowCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
  const [credentialsConfigOpen, setCredentialsConfigOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [outputsDialogOpen, setOutputsDialogOpen] = useState(false);

  const handleDelete = async () => {
    toast(`Delete "${workflow.name}"?`, {
      description: 'This cannot be undone.',
      action: {
        label: 'Delete',
        onClick: () => performDelete(),
      },
      cancel: {
        label: 'Cancel',
        onClick: () => {},
      },
    });
  };

  const performDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete workflow');
      }

      toast.success('Workflow deleted', {
        description: `"${workflow.name}" has been removed.`,
      });
      onDeleted();
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      toast.error('Failed to delete workflow', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleRunClick = () => {
    setExecutionDialogOpen(true);
  };

  const handleExecuted = () => {
    // Just refresh the workflows list, don't execute again
    // The dialog already handled the execution
    onUpdated?.();
  };

  const handleToggleStatus = async (checked: boolean) => {
    const newStatus = checked ? 'active' : 'draft';

    // Optimistic update - update UI immediately
    setOptimisticStatus(newStatus);
    setToggling(true);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update workflow status');
      }

      toast.success(`Workflow ${checked ? 'activated' : 'deactivated'}`, {
        description: `"${workflow.name}" is now ${newStatus}.`,
      });
      onUpdated?.();
    } catch (error) {
      // Revert optimistic update on error
      setOptimisticStatus(null);
      console.error('Failed to toggle workflow status:', error);
      toast.error('Failed to update workflow', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setToggling(false);
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'draft':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
      case 'paused':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'error':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const getRunStatusColor = (status: string | null) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'error':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'running':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  const getRunButtonConfig = () => {
    switch (workflow.trigger.type) {
      case 'chat':
        return { icon: MessageSquare, label: 'Chat' };
      case 'webhook':
        return { icon: Webhook, label: 'Webhook' };
      case 'cron':
        return { icon: Clock, label: 'Schedule' };
      case 'telegram':
        return { icon: Send, label: 'Telegram' };
      case 'discord':
        return { icon: Send, label: 'Discord' };
      case 'manual':
      default:
        return { icon: Play, label: 'Run' };
    }
  };

  const runButtonConfig = getRunButtonConfig();
  const RunIcon = runButtonConfig.icon;

  // Detect output type for badge
  const outputDisplay = workflow.lastRunOutput
    ? detectOutputDisplay('', workflow.lastRunOutput)
    : null;
  const outputTypeLabel = outputDisplay ? getOutputTypeLabel(outputDisplay.type) : null;
  const outputIconName = outputDisplay ? getOutputTypeIcon(outputDisplay.type) : 'BarChart3';

  // Map icon name to component
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    Table2,
    Image: ImageIcon,
    FileText,
    BarChart3,
    List,
    Braces,
  };
  const OutputIcon = iconMap[outputIconName] || BarChart3;

  return (
    <Card className="group relative overflow-hidden rounded-lg border border-border/50 bg-surface/80 backdrop-blur-sm shadow-sm hover:shadow-lg hover:border-primary/30 transition-all duration-300 hover:scale-[1.02]">
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Switch
            checked={(optimisticStatus || workflow.status) === 'active'}
            onCheckedChange={handleToggleStatus}
            disabled={toggling}
            className="data-[state=checked]:!bg-green-500 dark:data-[state=checked]:!bg-green-600 data-[state=unchecked]:!bg-gray-300 dark:data-[state=unchecked]:!bg-gray-600"
          />
          <span className={`text-xs font-medium ${(optimisticStatus || workflow.status) === 'active' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
            {(optimisticStatus || workflow.status) === 'active' ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <WorkflowIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <CardTitle className="card-title truncate">{workflow.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onExport(workflow.id)}
              title="Export workflow"
              className="transition-all duration-200 hover:scale-110 active:scale-95"
            >
              <Download className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete workflow"
              className="transition-all duration-200 hover:scale-110 active:scale-95 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 transition-transform duration-200 group-hover:rotate-12" />
            </Button>
          </div>
        </div>
        {workflow.description && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {workflow.description}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className={getStatusColor(workflow.status)}>
            {workflow.status}
          </Badge>
          {workflow.lastRunStatus && (
            <Badge variant="secondary" className={getRunStatusColor(workflow.lastRunStatus)}>
              {workflow.lastRunStatus}
            </Badge>
          )}
          {outputTypeLabel && (
            <Badge variant="outline" className="gap-1">
              <OutputIcon className="h-3 w-3" />
              {outputTypeLabel}
            </Badge>
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Created:</span>
            <span>{formatDate(workflow.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Last run:</span>
            <span>{formatDate(workflow.lastRun)}</span>
          </div>
          <div className="flex justify-between">
            <span>Runs:</span>
            <span className="font-medium">{workflow.runCount}</span>
          </div>
        </div>

        <div className="flex gap-1 flex-wrap pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRunClick}
            className="h-7 px-2 transition-all duration-200 hover:scale-105 active:scale-95 group"
            title={`Execute workflow via ${runButtonConfig.label.toLowerCase()}`}
          >
            <RunIcon className="h-3.5 w-3.5 mr-1 transition-transform duration-200 group-hover:scale-110" />
            <span className="text-xs">{runButtonConfig.label}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsDialogOpen(true)}
            className="h-7 px-2 transition-all duration-200 hover:scale-105 active:scale-95 group"
            title="Configure workflow settings"
          >
            <Sliders className="h-3.5 w-3.5 mr-1 transition-transform duration-200 group-hover:rotate-90" />
            <span className="text-xs">Settings</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCredentialsConfigOpen(true)}
            className="h-7 px-2 transition-all duration-200 hover:scale-105 active:scale-95 group"
            title="Configure credentials"
          >
            <Key className="h-3.5 w-3.5 mr-1 transition-transform duration-200 group-hover:-rotate-12" />
            <span className="text-xs">Credentials</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOutputsDialogOpen(true)}
            disabled={!workflow.lastRun || workflow.lastRunStatus !== 'success'}
            className="h-7 px-2 transition-all duration-200 hover:scale-105 active:scale-95 group disabled:opacity-50"
            title={
              !workflow.lastRun
                ? 'No outputs yet'
                : workflow.lastRunStatus !== 'success'
                  ? 'Last run failed'
                  : 'View workflow outputs'
            }
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1 transition-transform duration-200 group-hover:scale-110" />
            <span className="text-xs">Outputs</span>
          </Button>
        </div>
      </CardContent>

      <WorkflowExecutionDialog
        workflowId={workflow.id}
        workflowName={workflow.name}
        workflowConfig={workflow.config}
        triggerType={workflow.trigger.type}
        triggerConfig={workflow.trigger.config}
        open={executionDialogOpen}
        onOpenChange={setExecutionDialogOpen}
        onExecuted={handleExecuted}
      />

      <CredentialsConfigDialog
        workflowId={workflow.id}
        workflowName={workflow.name}
        open={credentialsConfigOpen}
        onOpenChange={setCredentialsConfigOpen}
      />

      <WorkflowSettingsDialog
        workflowId={workflow.id}
        workflowName={workflow.name}
        workflowConfig={workflow.config}
        workflowTrigger={workflow.trigger}
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        onUpdated={onUpdated}
      />

      <WorkflowOutputsDialog
        workflowId={workflow.id}
        workflowName={workflow.name}
        workflowConfig={workflow.config}
        open={outputsDialogOpen}
        onOpenChange={setOutputsDialogOpen}
      />
    </Card>
  );
}
