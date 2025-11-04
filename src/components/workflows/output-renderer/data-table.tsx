'use client';

import { Button } from '@/components/ui/button';
import { Copy, Download, Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface Column {
  key: string;
  label: string;
  type?: 'text' | 'link' | 'date' | 'number' | 'boolean';
}

interface DataTableProps {
  data: unknown;
  config?: {
    columns?: Column[];
  };
}

export function DataTable({ data, config }: DataTableProps) {
  // Hook must be at the top before any returns
  const [copied, setCopied] = useState(false);

  // Handle single object with nested array
  if (!Array.isArray(data) && typeof data === 'object' && data !== null) {
    const dataObj = data as Record<string, unknown>;

    // Check for common nested array patterns
    const arrayKeys = ['items', 'data', 'results', 'entries', 'records', 'rows'];
    for (const key of arrayKeys) {
      const value = dataObj[key];
      if (Array.isArray(value) && value.length > 0) {
        // Found nested array - use it directly
        data = value;
        break;
      }
    }

    // If still not an array after checking, show as key-value pairs
    // Note: Custom columns are ignored for single objects as they only apply to arrays
    if (!Array.isArray(data)) {
      const entries = Object.entries(dataObj);
      return (
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-sm">
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="p-3 font-medium text-muted-foreground bg-muted/30 w-1/3">
                    {formatLabel(key)}
                  </td>
                  <td className="p-3">
                    <CellRenderer value={value} type={inferType(value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }

  // Handle array of objects
  if (!Array.isArray(data)) {
    return (
      <div className="rounded-lg border border-border/50 bg-surface/50 p-4">
        <p className="text-sm text-muted-foreground">
          Table display requires array data. Use <code className="text-xs bg-muted px-1 py-0.5 rounded">type: &quot;text&quot;</code> or <code className="text-xs bg-muted px-1 py-0.5 rounded">type: &quot;json&quot;</code> for single values.
        </p>
      </div>
    );
  }

  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground">No data to display</div>;
  }

  // Infer columns if not provided
  const columns = config?.columns || inferColumnsFromData(data);

  // Export functions
  const convertToCSV = () => {
    const headers = columns.map((col) => col.label).join(',');
    const rows = data
      .map((row) =>
        columns
          .map((col) => {
            const value = getNestedValue(row, col.key);
            const stringValue = value === null || value === undefined ? '' : String(value);
            // Escape quotes and wrap in quotes if contains comma/quote/newline
            return /[",\n]/.test(stringValue)
              ? `"${stringValue.replace(/"/g, '""')}"`
              : stringValue;
          })
          .join(',')
      )
      .join('\n');
    return `${headers}\n${rows}`;
  };

  const handleCopy = async () => {
    try {
      const csv = convertToCSV();
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    const csv = convertToCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table-data.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Downloaded as table-data.csv');
  };

  return (
    <div className="w-full -mx-6 space-y-3">
      <div className="flex justify-end px-6">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            className="h-8 gap-2"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy CSV'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            className="h-8 gap-2"
          >
            <Download className="h-3.5 w-3.5" />
            Download CSV
          </Button>
        </div>
      </div>
      <div className="block max-w-full overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm align-top">
                    <div className="max-w-xs">
                      <CellRenderer value={getNestedValue(row, col.key)} type={col.type} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellRenderer({
  value,
  type,
}: {
  value: unknown;
  type?: 'text' | 'link' | 'date' | 'number' | 'boolean';
}) {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  switch (type) {
    case 'link':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all line-clamp-2"
          title={String(value)}
        >
          {String(value)}
        </a>
      );

    case 'date':
      try {
        const date = new Date(String(value));
        return <span className="whitespace-nowrap">{date.toLocaleDateString()}</span>;
      } catch {
        return <span>{String(value)}</span>;
      }

    case 'number':
      return <span className="tabular-nums">{Number(value).toLocaleString()}</span>;

    case 'boolean':
      return (
        <span className={value ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
          {value ? '✓' : '✗'}
        </span>
      );

    default:
      // Handle objects and arrays
      if (typeof value === 'object') {
        return (
          <span className="text-muted-foreground text-xs font-mono break-all line-clamp-3">
            {JSON.stringify(value)}
          </span>
        );
      }
      // Handle long text with line clamping
      const textValue = String(value);
      if (textValue.length > 100) {
        return (
          <span className="line-clamp-3" title={textValue}>
            {textValue}
          </span>
        );
      }
      return <span>{textValue}</span>;
  }
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((current: unknown, key: string) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function inferColumnsFromData(data: unknown[]): Column[] {
  if (data.length === 0) return [];

  const firstItem = data[0];
  if (typeof firstItem !== 'object' || firstItem === null) return [];

  return Object.keys(firstItem)
    .slice(0, 8)
    .map((key) => ({
      key,
      label: formatLabel(key),
      type: inferType((firstItem as Record<string, unknown>)[key]),
    }));
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function inferType(value: unknown): 'text' | 'link' | 'date' | 'number' | 'boolean' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) return 'link';
    const date = new Date(value);
    if (!isNaN(date.getTime()) && value.length > 8) return 'date';
  }
  return 'text';
}
