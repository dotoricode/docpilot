import { useMemo, useState } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';

type JsonTreeViewProps = {
  source: string;
};

export function JsonTreeView({ source }: JsonTreeViewProps) {
  const result = useMemo(() => parseJson(source), [source]);
  if (!result.ok) {
    return (
      <div className="json-tree-error" role="alert">
        <strong>Invalid JSON</strong>
        <span>{result.error}</span>
      </div>
    );
  }
  return (
    <div className="json-tree" role="tree" aria-label="JSON tree">
      <JsonNode name="root" value={result.value} depth={0} defaultOpen />
    </div>
  );
}

function JsonNode({ name, value, depth, defaultOpen = false }: { name: string; value: unknown; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || depth < 2);
  const expandable = value !== null && typeof value === 'object';
  const entries = expandable ? Object.entries(value as Record<string, unknown>) : [];
  return (
    <div className="json-tree-node" role="treeitem" aria-expanded={expandable ? open : undefined}>
      <button
        className="json-tree-row"
        type="button"
        style={{ paddingLeft: `${10 + depth * 18}px` }}
        disabled={!expandable}
        onClick={() => expandable && setOpen(current => !current)}
      >
        <span className="json-tree-caret" aria-hidden="true">
          {expandable ? (open ? <CaretDown size={13} /> : <CaretRight size={13} />) : null}
        </span>
        <span className="json-tree-key">{name}</span>
        {expandable ? <span className="json-tree-summary">{Array.isArray(value) ? `${entries.length} items` : `${entries.length} keys`}</span> : <JsonPrimitive value={value} />}
      </button>
      {expandable && open ? (
        <div role="group">
          {entries.map(([key, child]) => <JsonNode key={key} name={key} value={child} depth={depth + 1} />)}
        </div>
      ) : null}
    </div>
  );
}

function JsonPrimitive({ value }: { value: unknown }) {
  const type = value === null ? 'null' : typeof value;
  return <span className={`json-tree-value ${type}`}>{value === null ? 'null' : JSON.stringify(value)}</span>;
}

function parseJson(source: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
