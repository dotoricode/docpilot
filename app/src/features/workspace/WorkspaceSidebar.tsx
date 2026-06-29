import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import {
  attachWorkspaceRoot,
  chooseWorkspaceFolder,
  copyText,
  createWorkspaceFile,
  createWorkspaceFolder,
  detachWorkspaceRoot,
  getRecentFolders,
  getWorkspaceFilePath,
  listFileStatuses,
  listWorkspaceFiles,
  openWorkspaceFolder,
  renameWorkspaceFile,
  type FileStatus,
  type WorkspaceFilesResponse,
  type WorkspaceRoot,
} from '../../shared/bridge-client';

type WorkspaceSidebarProps = {
  activeFile: string;
  refreshSignal: number;
  instructionsPanel?: ReactNode;
  onOpenFile: (file: string) => void;
};

type FileTreeNode = {
  type: 'folder' | 'file';
  id: string;
  name: string;
  path: string;
  children?: FileTreeNode[];
  workspaceRoot?: boolean;
  workspacePath?: string;
};

type TreeMenuState = {
  x: number;
  y: number;
  node: FileTreeNode | null;
} | null;

export function WorkspaceSidebar({ activeFile, refreshSignal, instructionsPanel, onOpenFile }: WorkspaceSidebarProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [roots, setRoots] = useState<WorkspaceRoot[]>([]);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, FileStatus>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'docs' | 'instructions'>('docs');
  const [treeMenu, setTreeMenu] = useState<TreeMenuState>(null);
  const [notice, setNotice] = useState('');

  const tree = useMemo(() => buildFileTree(files, folders, roots), [files, folders, roots]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTree = useMemo(() => {
    if (!normalizedQuery) return tree;
    return filterTree(tree, normalizedQuery);
  }, [tree, normalizedQuery]);
  const folderIds = useMemo(() => collectFolderIds(tree), [tree]);
  const filteredFileCount = useMemo(() => {
    if (!normalizedQuery) return files.length;
    return files.filter(file => file.toLowerCase().includes(normalizedQuery)).length;
  }, [files, normalizedQuery]);

  useEffect(() => {
    let disposed = false;
    Promise.all([listWorkspaceFiles(), listFileStatuses(), getRecentFolders()])
      .then(([data, statusData, recent]) => {
        if (disposed) return;
        applyWorkspaceData(data);
        setStatuses(statusData.statuses || {});
        setRecentFolders(Array.isArray(recent) ? recent : []);
        setError('');
      })
      .catch(err => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      disposed = true;
    };
  }, [refreshSignal]);

  useEffect(() => {
    if (!treeMenu) return undefined;
    const close = () => setTreeMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [treeMenu]);

  useEffect(() => {
    if (!files.length) {
      setExpandedFolders(new Set());
      return;
    }

    setExpandedFolders(current => {
      const next = current.size ? new Set(current) : new Set(tree.filter(node => node.type === 'folder').map(node => node.id));
      for (const parent of activeParentFolderIds(activeFile, roots)) next.add(parent);
      return next;
    });
  }, [activeFile, files.length, roots, tree]);

  function applyWorkspaceData(data: WorkspaceFilesResponse) {
    setFiles(Array.isArray(data.files) ? data.files : []);
    setFolders(Array.isArray(data.folders) ? data.folders : []);
    setRoots(Array.isArray(data.roots) ? data.roots : []);
  }

  function openTreeMenu(event: MouseEvent, node: FileTreeNode) {
    event.preventDefault();
    event.stopPropagation();
    setTreeMenu({ ...contextMenuPosition(event), node });
  }

  function openBlankTreeMenu(event: MouseEvent) {
    const target = event.target;
    if (
      target instanceof HTMLElement
      && target.closest(
        '.workspace-tree-node, .workspace-file-row, .workspace-folder-row, .tree-context-menu, .workspace-tree-toolbar, .workspace-root-list, .workspace-recent-list, button, input, textarea, select, a',
      )
    ) return;
    event.preventDefault();
    event.stopPropagation();
    setTreeMenu({ ...contextMenuPosition(event), node: null });
  }

  async function addRoot() {
    setBusy(true);
    try {
      const folder = await chooseWorkspaceFolder();
      if (!folder) return;
      const data = await attachWorkspaceRoot(folder);
      applyWorkspaceData(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRoot(id: string) {
    setBusy(true);
    try {
      const data = await detachWorkspaceRoot(id);
      applyWorkspaceData(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openRecent(folderPath: string) {
    setBusy(true);
    try {
      await openWorkspaceFolder(folderPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function toggleFolder(id: string) {
    setExpandedFolders(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedFolders(new Set(folderIds));
  }

  function collapseAll() {
    setExpandedFolders(new Set(activeParentFolderIds(activeFile, roots)));
  }

  async function createFileAt(node: FileTreeNode) {
    const name = window.prompt('새 파일 이름', 'new-document.md');
    if (!name) return;
    setBusy(true);
    try {
      const dir = node.type === 'folder' ? node.id : parentFolderIds(node.id).at(-1) || '';
      const data = await createWorkspaceFile(dir, name, `# ${name.replace(/\.(md|markdown|mdown|txt|text)$/i, '')}\n`);
      applyWorkspaceData(data);
      setExpandedFolders(current => new Set([...current, ...activeParentFolderIds(data.id, roots)]));
      setNotice(`${data.id} 파일을 만들었습니다.`);
      onOpenFile(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function createRootFile() {
    const name = window.prompt('새 파일 이름', 'new-document.md');
    if (!name) return;
    setBusy(true);
    try {
      const data = await createWorkspaceFile('workspace:primary', name, `# ${name.replace(/\.(md|markdown|mdown|txt|text)$/i, '')}\n`);
      applyWorkspaceData(data);
      setNotice(`${data.id} 파일을 만들었습니다.`);
      onOpenFile(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function createFolderAt(node: FileTreeNode | null) {
    const name = window.prompt('새 폴더 이름', 'new-folder');
    if (!name) return;
    setBusy(true);
    try {
      const dir = node?.type === 'folder' ? node.id : node?.type === 'file' ? parentFolderIds(node.id).at(-1) || 'workspace:primary' : 'workspace:primary';
      const data = await createWorkspaceFolder(dir, name);
      applyWorkspaceData(data);
      setExpandedFolders(current => new Set([...current, data.id, ...activeParentFolderIds(`${data.id}/placeholder.md`, data.roots || roots)]));
      setNotice(`${data.id} 폴더를 만들었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function renameFile(node: FileTreeNode) {
    if (node.type !== 'file') return;
    const name = window.prompt('새 파일 이름', node.name);
    if (!name || name === node.name) return;
    setBusy(true);
    try {
      const data = await renameWorkspaceFile(node.id, name);
      applyWorkspaceData(data);
      setNotice(`${data.id} 이름으로 변경했습니다.`);
      onOpenFile(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function copyNodePath(node: FileTreeNode) {
    try {
      const resolved = await getWorkspaceFilePath(node.id);
      await copyText(resolved.path || node.id);
      setNotice('경로를 복사했습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeMenu(null);
    }
  }

  function renderNode(node: FileTreeNode, depth: number) {
    const style = { '--depth': depth } as CSSProperties;
    if (node.type === 'folder') {
      const expanded = normalizedQuery ? true : expandedFolders.has(node.id);
      const childCount = countFiles(node);
      return (
        <div className="workspace-tree-node" key={`folder:${node.id}`}>
          <button
            className={`workspace-folder-row ${expanded ? 'expanded' : ''} ${node.workspaceRoot ? 'workspace-root-folder' : ''}`}
            style={style}
            type="button"
            title={node.workspacePath || node.path || node.name}
            onClick={() => toggleFolder(node.id)}
            onContextMenu={event => openTreeMenu(event, node)}
          >
            <span className="tree-twist">{expanded ? '⌄' : '›'}</span>
            <span className="tree-name">{node.name}</span>
            <small>{childCount}</small>
          </button>
          {expanded && node.children?.length ? (
            <div className="workspace-tree-children">
              {node.children.map(child => renderNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }

    const status = statuses[node.id];
    return (
      <button
        className={`file-row workspace-file-row ${node.id === activeFile ? 'active' : ''}`}
        key={`file:${node.id}`}
        style={style}
        type="button"
        title={node.id}
        onClick={() => onOpenFile(node.id)}
        onContextMenu={event => openTreeMenu(event, node)}
      >
        <span className="tree-spacer" aria-hidden="true" />
        <span className="tree-icon document-icon" aria-hidden="true">MD</span>
        <span className="tree-name">{node.name}</span>
        {status ? <small className={`file-status ${status}`}>{status === 'new' ? 'new' : 'mod'}</small> : null}
      </button>
    );
  }

  return (
    <aside className="workspace-sidebar">
      <div className="panel-title workspace-title">
        <span>Workspace</span>
        <button type="button" disabled={busy} onClick={addRoot}>+ 폴더</button>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="Workspace sections">
        <button
          className={activeTab === 'docs' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'docs'}
          onClick={() => setActiveTab('docs')}
        >
          문서
        </button>
        <button
          className={activeTab === 'instructions' ? 'active' : ''}
          type="button"
          role="tab"
          aria-selected={activeTab === 'instructions'}
          onClick={() => setActiveTab('instructions')}
        >
          지침
        </button>
      </div>
      {activeTab === 'docs' ? (
        <div className="workspace-docs-pane" onContextMenuCapture={openBlankTreeMenu}>
          <div className="workspace-summary">
            {roots.length ? `${roots.length}개 추가 폴더` : '기본 폴더만 사용 중'}
          </div>
          {roots.length ? (
            <div className="workspace-root-list">
              {roots.map(root => (
                <div className="workspace-root-row" key={root.id}>
                  <span title={root.path}>{root.name}</span>
                  <button type="button" disabled={busy} onClick={() => removeRoot(root.id)}>제거</button>
                </div>
              ))}
            </div>
          ) : null}
          {recentFolders.length ? (
            <>
              <div className="workspace-section-label">최근 폴더</div>
              <div className="workspace-recent-list">
                {recentFolders.slice(0, 5).map(folder => (
                  <button
                    className="workspace-recent-row"
                    key={folder}
                    type="button"
                    disabled={busy}
                    title={folder}
                    onClick={() => openRecent(folder)}
                  >
                    <span>{folderName(folder)}</span>
                    <small>{folder}</small>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {error ? <div className="workspace-error">Bridge error: {error}</div> : null}
          {notice ? <div className="workspace-notice">{notice}</div> : null}
          <div className="workspace-tree-toolbar">
            <input
              className="workspace-tree-search"
              type="search"
              placeholder="파일 검색"
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
            />
            <button type="button" disabled={!folderIds.length} onClick={expandAll}>펼침</button>
            <button type="button" disabled={!folderIds.length} onClick={collapseAll}>접기</button>
          </div>
          <div className="workspace-tree-meta">
            파일 {files.length}개{normalizedQuery ? ` · 검색 ${filteredFileCount}개` : ''}
          </div>
          <div
            className="file-list workspace-tree"
            role="tree"
            aria-label="Workspace files"
            onContextMenu={openBlankTreeMenu}
          >
            {visibleTree.map(node => renderNode(node, 0))}
            {!files.length && !folders.length && !error ? <div className="empty-note">No markdown files</div> : null}
            {files.length > 0 && normalizedQuery && !visibleTree.length ? <div className="empty-note">검색 결과 없음</div> : null}
          </div>
        </div>
      ) : (
        <div className="workspace-instructions-pane">
          {instructionsPanel}
        </div>
      )}
      {treeMenu ? (
        <div
          className="tree-context-menu"
          style={{ left: treeMenu.x, top: treeMenu.y } as CSSProperties}
          onClick={event => event.stopPropagation()}
        >
          {treeMenu.node ? (
            treeMenu.node.type === 'folder' ? (
              <>
                <button type="button" onClick={() => createFileAt(treeMenu.node!)}>새 파일</button>
                <button type="button" onClick={() => createFolderAt(treeMenu.node)}>새 폴더</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => createFileAt(treeMenu.node!)}>같은 폴더에 새 파일</button>
                <button type="button" onClick={() => renameFile(treeMenu.node!)}>이름 변경</button>
              </>
            )
          ) : (
            <>
              <button type="button" onClick={createRootFile}>새 파일</button>
              <button type="button" onClick={() => createFolderAt(null)}>새 폴더</button>
            </>
          )}
          {treeMenu.node ? <button type="button" onClick={() => copyNodePath(treeMenu.node!)}>절대경로 복사</button> : null}
        </div>
      ) : null}
    </aside>
  );
}

function folderName(folderPath: string) {
  const trimmed = String(folderPath || '').replace(/\/+$/, '');
  return trimmed.split('/').pop() || trimmed || '폴더';
}

function contextMenuPosition(event: MouseEvent) {
  const menuWidth = 170;
  const menuHeight = 116;
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
  };
}

function buildFileTree(files: string[], folders: string[], roots: WorkspaceRoot[]): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = [];
  const rootById = new Map(roots.map(root => [root.id, root]));
  const workspaceNodes = new Map<string, FileTreeNode>();
  const primaryChildren: FileTreeNode[] = roots.length
    ? ensureFolder(rootNodes, 'workspace:primary', '기본 폴더', '', true).children || []
    : rootNodes;

  if (roots.length) {
    const primary = rootNodes.find(node => node.id === 'workspace:primary');
    if (primary) primary.children = primaryChildren;
  }

  for (const root of roots) {
    if (!root.id) continue;
    const node: FileTreeNode = {
      type: 'folder',
      id: root.id,
      name: root.name || root.id,
      path: root.id,
      workspaceRoot: true,
      workspacePath: root.path,
      children: [],
    };
    workspaceNodes.set(root.id, node);
    rootNodes.push(node);
  }

  for (const folder of folders) {
    const parts = normalizedParts(folder);
    if (!parts.length) continue;
    const workspaceRoot = rootById.get(parts[0]);
    if (workspaceRoot) {
      const rootNode = workspaceNodes.get(parts[0]);
      if (!rootNode?.children) continue;
      insertFolder(rootNode.children, parts.slice(1), parts[0]);
      continue;
    }
    insertFolder(primaryChildren, parts, '');
  }

  for (const file of files) {
    const parts = normalizedParts(file);
    if (!parts.length) continue;
    const workspaceRoot = rootById.get(parts[0]);
    if (workspaceRoot) {
      const rootNode = workspaceNodes.get(parts[0]);
      if (!rootNode?.children) continue;
      insertFile(rootNode.children, parts.slice(1), file, parts[0]);
      continue;
    }
    insertFile(primaryChildren, parts, file, '');
  }

  sortTree(rootNodes);
  return rootNodes.filter(node => node.type === 'file' || node.workspaceRoot || countFiles(node) > 0 || (node.children || []).length > 0);
}

function insertFolder(children: FileTreeNode[], parts: string[], rootPrefix: string) {
  if (!parts.length) return;
  let cursor = children;
  const prefixParts = rootPrefix ? [rootPrefix] : [];
  for (let index = 0; index < parts.length; index += 1) {
    const folderPath = [...prefixParts, ...parts.slice(0, index + 1)].join('/');
    const folder = ensureFolder(cursor, folderPath, parts[index], folderPath);
    cursor = folder.children || [];
  }
}

function insertFile(children: FileTreeNode[], parts: string[], fileId: string, rootPrefix: string) {
  if (!parts.length) return;
  let cursor = children;
  const prefixParts = rootPrefix ? [rootPrefix] : [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    const folderPath = [...prefixParts, ...parts.slice(0, index + 1)].join('/');
    const folder = ensureFolder(cursor, folderPath, parts[index], folderPath);
    cursor = folder.children || [];
  }
  cursor.push({
    type: 'file',
    id: fileId,
    name: parts[parts.length - 1],
    path: fileId,
  });
}

function ensureFolder(children: FileTreeNode[], id: string, name: string, path: string, workspaceRoot = false) {
  const existing = children.find(node => node.type === 'folder' && node.id === id);
  if (existing) return existing;
  const folder: FileTreeNode = {
    type: 'folder',
    id,
    name,
    path,
    workspaceRoot,
    children: [],
  };
  children.push(folder);
  return folder;
}

function sortTree(nodes: FileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
    return left.name.localeCompare(right.name, 'ko');
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const filtered: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.id.toLowerCase().includes(query) || node.name.toLowerCase().includes(query)) filtered.push(node);
      continue;
    }
    const children = filterTree(node.children || [], query);
    if (children.length || node.name.toLowerCase().includes(query)) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

function collectFolderIds(nodes: FileTreeNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.type !== 'folder') continue;
    ids.push(node.id);
    ids.push(...collectFolderIds(node.children || []));
  }
  return ids;
}

function parentFolderIds(fileId: string) {
  const parts = normalizedParts(fileId);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

function activeParentFolderIds(fileId: string, roots: WorkspaceRoot[]) {
  const parents = parentFolderIds(fileId);
  if (!roots.length || !fileId) return parents;
  const firstPart = normalizedParts(fileId)[0];
  if (roots.some(root => root.id === firstPart)) return parents;
  return ['workspace:primary', ...parents];
}

function normalizedParts(fileId: string) {
  return String(fileId || '').split('/').filter(Boolean);
}

function countFiles(node: FileTreeNode): number {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((sum, child) => sum + countFiles(child), 0);
}
