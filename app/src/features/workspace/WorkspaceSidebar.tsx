import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  attachWorkspaceRoot,
  chooseWorkspaceFolder,
  copyText,
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceNode,
  detachWorkspaceRoot,
  getRecentFolders,
  getWorkspaceFilePath,
  listFileStatuses,
  listWorkspaceFiles,
  openLocalPath,
  renameWorkspaceFile,
  type FileStatus,
  type WorkspaceFilesResponse,
  type WorkspaceRoot,
} from '../../shared/bridge-client';

type WorkspaceSidebarProps = {
  activeFile: string;
  dirtyFileIds?: string[];
  refreshSignal: number;
  instructionsPanel?: ReactNode;
  onOpenFile: (file: string) => void;
  onOpenFileInSplit?: (file: string) => void;
  onCollapse?: () => void;
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

type EditingNodeState = {
  id: string;
  value: string;
  type: 'folder' | 'file';
  openAfterRename: boolean;
  isNew: boolean;
} | null;

export function WorkspaceSidebar({ activeFile, dirtyFileIds = [], refreshSignal, instructionsPanel, onOpenFile, onOpenFileInSplit, onCollapse }: WorkspaceSidebarProps) {
  const editFinalizingRef = useRef(false);
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
  const [editingNode, setEditingNode] = useState<EditingNodeState>(null);
  const [notice, setNotice] = useState('');
  const [focusedNodeId, setFocusedNodeId] = useState('');

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
  const dirtyFileSet = useMemo(() => new Set(dirtyFileIds.filter(Boolean)), [dirtyFileIds]);
  const dirtyFolderSet = useMemo(() => {
    const foldersWithChanges = new Set<string>();
    dirtyFileIds.filter(Boolean).forEach(fileId => {
      parentFolderIds(fileId).forEach(folderId => foldersWithChanges.add(folderId));
    });
    Object.entries(statuses).forEach(([fileId, status]) => {
      if (!status) return;
      parentFolderIds(fileId).forEach(folderId => foldersWithChanges.add(folderId));
    });
    return foldersWithChanges;
  }, [dirtyFileIds, statuses]);

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
    setTreeMenu({ ...contextMenuPosition(event, treeMenuItemCount(node, Boolean(onOpenFileInSplit))), node });
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
    setTreeMenu({ ...contextMenuPosition(event, 4), node: null });
  }

  function startEditingNode(node: Pick<FileTreeNode, 'id' | 'name' | 'type'>, openAfterRename = node.type === 'file', isNew = false) {
    editFinalizingRef.current = false;
    setTreeMenu(null);
    setFocusedNodeId(node.id);
    setEditingNode({
      id: node.id,
      value: node.name,
      type: node.type,
      openAfterRename,
      isNew,
    });
  }

  async function commitEditingNode(valueOverride?: string) {
    if (editFinalizingRef.current) return;
    const editing = editingNode;
    if (!editing) return;
    editFinalizingRef.current = true;
    const nextName = (valueOverride ?? editing.value).trim();
    setEditingNode(null);
    try {
      if (!nextName || nextName === pathFileName(editing.id)) {
        if (editing.isNew) await discardCreatedNode(editing);
        return;
      }
      await renameNodeById(editing.id, nextName, editing.openAfterRename);
    } finally {
      editFinalizingRef.current = false;
    }
  }

  function cancelEditingNode() {
    if (editFinalizingRef.current) return;
    const editing = editingNode;
    editFinalizingRef.current = true;
    setEditingNode(null);
    if (editing?.isNew) {
      void discardCreatedNode(editing).finally(() => {
        editFinalizingRef.current = false;
      });
    } else {
      editFinalizingRef.current = false;
    }
  }

  async function discardCreatedNode(editing: NonNullable<EditingNodeState>) {
    setBusy(true);
    try {
      const data = await deleteWorkspaceNode(editing.id, { permanent: true });
      applyWorkspaceData(data);
      setNotice(`${pathFileName(editing.id)} 생성을 취소했습니다.`);
      if (activeFile === editing.id || activeFile.startsWith(`${editing.id}/`)) {
        const nextFile = data.files.find(file => file !== editing.id) || '';
        if (nextFile) onOpenFile(nextFile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
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
      const primary = await getWorkspaceFilePath('workspace:primary').catch(() => null);
      if (primary?.path === folderPath) {
        setNotice(`${folderName(folderPath)} 폴더는 이미 현재 작업공간입니다.`);
        setError('');
        return;
      }
      if (roots.some(root => root.path === folderPath)) {
        setNotice(`${folderName(folderPath)} 폴더는 이미 추가되어 있습니다.`);
        setError('');
        return;
      }
      const data = await attachWorkspaceRoot(folderPath);
      applyWorkspaceData(data);
      setExpandedFolders(current => new Set([...current, data.root.id]));
      setNotice(`${folderName(folderPath)} 폴더를 현재 작업공간에 추가했습니다.`);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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
    const dir = node.type === 'folder' ? node.id : parentFolderIds(node.id).at(-1) || '';
    const name = uniqueTempFileName(dir, files);
    setBusy(true);
    try {
      setQuery('');
      const data = await createWorkspaceFile(dir, name, defaultFileContent(name));
      applyWorkspaceData(data);
      setExpandedFolders(current => new Set([...current, ...activeParentFolderIds(data.id, data.roots || roots)]));
      setNotice(`${data.id} 파일을 만들었습니다.`);
      onOpenFile(data.id);
      setFocusedNodeId(data.id);
      startEditingNode({ id: data.id, name: pathFileName(data.id), type: 'file' }, true, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function createRootFile() {
    const name = uniqueTempFileName('workspace:primary', files);
    setBusy(true);
    try {
      setQuery('');
      const data = await createWorkspaceFile('workspace:primary', name, defaultFileContent(name));
      applyWorkspaceData(data);
      setNotice(`${data.id} 파일을 만들었습니다.`);
      onOpenFile(data.id);
      setFocusedNodeId(data.id);
      startEditingNode({ id: data.id, name: pathFileName(data.id), type: 'file' }, true, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function createFolderAt(node: FileTreeNode | null) {
    const dir = node?.type === 'folder' ? node.id : node?.type === 'file' ? parentFolderIds(node.id).at(-1) || 'workspace:primary' : 'workspace:primary';
    const name = uniqueTempFolderName(dir, folders);
    setBusy(true);
    try {
      setQuery('');
      const data = await createWorkspaceFolder(dir, name);
      applyWorkspaceData(data);
      setExpandedFolders(current => new Set([...current, data.id, ...activeParentFolderIds(`${data.id}/placeholder.md`, data.roots || roots)]));
      setNotice(`${data.id} 폴더를 만들었습니다.`);
      setFocusedNodeId(data.id);
      startEditingNode({ id: data.id, name: pathFileName(data.id), type: 'folder' }, false, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function renameNode(node: FileTreeNode) {
    if (node.workspaceRoot) return;
    startEditingNode(node, node.type === 'file');
  }

  async function renameNodeById(id: string, name: string, openAfterRename: boolean) {
    setBusy(true);
    try {
      const data = await renameWorkspaceFile(id, name);
      applyWorkspaceData(data);
      setNotice(`${data.id} 이름으로 변경했습니다.`);
      if (openAfterRename) onOpenFile(data.id);
      setFocusedNodeId(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  async function deleteNode(node: FileTreeNode) {
    if (node.workspaceRoot) return;
    setBusy(true);
    try {
      const data = await deleteWorkspaceNode(node.id);
      applyWorkspaceData(data);
      setNotice(`${node.name} 항목을 복구 가능한 삭제 위치로 이동했습니다.`);
      if (activeFile === node.id || activeFile.startsWith(`${node.id}/`)) {
        const nextFile = data.files.find(file => file !== node.id) || '';
        if (nextFile) onOpenFile(nextFile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setTreeMenu(null);
    }
  }

  function handleNodeKeyDown(event: KeyboardEvent<HTMLButtonElement>, node: FileTreeNode) {
    if (event.key === 'Enter') {
      event.preventDefault();
      renameNode(node);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteNode(node);
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

  async function openNodeFolder(node: FileTreeNode) {
    try {
      const target = node.type === 'folder' ? node.id : parentFolderIds(node.id).at(-1) || 'workspace:primary';
      const resolved = await getWorkspaceFilePath(target);
      const opened = await openLocalPath(resolved.path);
      if (!opened) throw new Error('폴더를 열 수 없습니다.');
      setNotice('시스템 파일 탐색기에서 폴더를 열었습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeMenu(null);
    }
  }

  async function openCurrentWorkspaceFolder() {
    try {
      const resolved = await getWorkspaceFilePath('workspace:primary');
      const opened = await openLocalPath(resolved.path);
      if (!opened) throw new Error('워크스페이스 폴더를 열 수 없습니다.');
      setNotice('워크스페이스 폴더를 열었습니다.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreeMenu(null);
    }
  }

  function renderNode(node: FileTreeNode, depth: number) {
    const style = { '--depth': depth } as CSSProperties;
    const editing = editingNode?.id === node.id ? editingNode : null;
    const inlineEditor = editing ? (
      <input
        className="tree-inline-input"
        value={editing.value}
        autoFocus
        onFocus={event => event.currentTarget.select()}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onChange={event => {
          const nextValue = event.currentTarget.value;
          setEditingNode(current => current?.id === node.id ? { ...current, value: nextValue } : current);
        }}
        onBlur={event => {
          void commitEditingNode(event.currentTarget.value);
        }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            void commitEditingNode(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditingNode();
          }
        }}
      />
    ) : null;
    if (node.type === 'folder') {
      const expanded = normalizedQuery ? true : expandedFolders.has(node.id);
      const hasChildren = Boolean(node.children?.length);
      const dirty = dirtyFolderSet.has(node.id);
      const folderChildren = (
        <>
          <span className={`tree-twist ${hasChildren ? 'has-children' : ''} ${expanded ? 'expanded' : ''}`} aria-hidden="true" />
          <span className="tree-icon tree-icon-folder" aria-hidden="true" />
          {inlineEditor || <span className="tree-name">{node.name}</span>}
          {dirty && !expanded ? <small className="file-status modified folder-status" aria-label="수정 사항 포함" title="수정 사항 포함" /> : null}
        </>
      );
      return (
        <div className={`workspace-tree-node ${node.workspaceRoot ? 'workspace-root-tree-node' : ''}`} key={`folder:${node.id}`}>
          {editing ? (
            <div
              className={`workspace-folder-row ${expanded ? 'expanded' : ''} ${hasChildren ? 'has-children' : 'empty-folder'} ${node.workspaceRoot ? 'workspace-root-folder' : ''}`}
              style={style}
              title={node.workspacePath || node.path || node.name}
              data-focused={focusedNodeId === node.id ? 'true' : 'false'}
              data-editing="true"
            >
              {folderChildren}
            </div>
          ) : (
            <button
              className={`workspace-folder-row ${expanded ? 'expanded' : ''} ${hasChildren ? 'has-children' : 'empty-folder'} ${node.workspaceRoot ? 'workspace-root-folder' : ''}`}
              style={style}
              type="button"
              title={node.workspacePath || node.path || node.name}
              onClick={() => toggleFolder(node.id)}
              onContextMenu={event => openTreeMenu(event, node)}
              onFocus={() => setFocusedNodeId(node.id)}
              onKeyDown={event => handleNodeKeyDown(event, node)}
              data-focused={focusedNodeId === node.id ? 'true' : 'false'}
              data-editing="false"
            >
              {folderChildren}
            </button>
          )}
          {expanded && node.children?.length ? (
            <div className="workspace-tree-children">
              {node.children.map(child => renderNode(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }

    const dirty = dirtyFileSet.has(node.id);
    const status = dirty ? 'modified' : statuses[node.id];
    const statusLabel = dirty ? '저장 안 됨' : status === 'new' ? '새 파일' : status === 'modified' ? '수정됨' : '';
    const fileChildren = (
      <>
        <span className={`tree-icon tree-icon-file tree-icon-${fileIconType(node.name)}`} aria-hidden="true" />
        {inlineEditor || <span className="tree-name">{node.name}</span>}
        {status ? <small className={`file-status ${status}`} aria-label={statusLabel} title={statusLabel} /> : null}
      </>
    );
    if (editing) {
      return (
        <div
          className={`file-row workspace-file-row ${node.id === activeFile ? 'active' : ''} ${dirty ? 'unsaved' : ''}`}
          key={`file:${node.id}`}
          style={style}
          title={node.id}
          data-focused={focusedNodeId === node.id ? 'true' : 'false'}
          data-editing="true"
        >
          {fileChildren}
        </div>
      );
    }
    return (
      <button
        className={`file-row workspace-file-row ${node.id === activeFile ? 'active' : ''} ${dirty ? 'unsaved' : ''}`}
        key={`file:${node.id}`}
        style={style}
        type="button"
        title={node.id}
        onClick={() => onOpenFile(node.id)}
        onContextMenu={event => openTreeMenu(event, node)}
        onFocus={() => setFocusedNodeId(node.id)}
        onKeyDown={event => handleNodeKeyDown(event, node)}
        data-focused={focusedNodeId === node.id ? 'true' : 'false'}
        data-editing="false"
      >
        {fileChildren}
      </button>
    );
  }

  return (
    <aside className="workspace-sidebar">
      <div className="panel-title workspace-title">
        <span>Workspace</span>
        <div className="panel-title-actions">
          <button type="button" disabled={busy} onClick={addRoot}>+ 폴더</button>
          {onCollapse ? <button type="button" onClick={onCollapse}>접기</button> : null}
        </div>
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
            {!files.length && !folders.length && !error ? <div className="empty-note">No document files</div> : null}
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
                <button type="button" onClick={() => createFileAt(treeMenu.node!)}>파일 만들기</button>
                <button type="button" onClick={() => createFolderAt(treeMenu.node)}>폴더 만들기</button>
                {!treeMenu.node.workspaceRoot ? <button type="button" onClick={() => renameNode(treeMenu.node!)}>이름 바꾸기</button> : null}
                {!treeMenu.node.workspaceRoot ? <button type="button" onClick={() => deleteNode(treeMenu.node!)}>폴더 삭제</button> : null}
                <button type="button" onClick={() => openNodeFolder(treeMenu.node!)}>Finder에서 열기</button>
              </>
            ) : (
              <>
                {onOpenFileInSplit ? <button type="button" onClick={() => {
                  onOpenFileInSplit(treeMenu.node!.id);
                  setTreeMenu(null);
                }}>분할로 열기</button> : null}
                <button type="button" onClick={() => createFileAt(treeMenu.node!)}>파일 만들기</button>
                <button type="button" onClick={() => renameNode(treeMenu.node!)}>이름 바꾸기</button>
                <button type="button" onClick={() => deleteNode(treeMenu.node!)}>파일 삭제</button>
                <button type="button" onClick={() => openNodeFolder(treeMenu.node!)}>Finder에서 위치 열기</button>
              </>
            )
          ) : (
            <>
              <button type="button" onClick={createRootFile}>파일 만들기</button>
              <button type="button" onClick={() => createFolderAt(null)}>폴더 만들기</button>
              <button type="button" disabled={busy} onClick={addRoot}>워크스페이스 추가</button>
              <button type="button" onClick={openCurrentWorkspaceFolder}>Finder에서 열기</button>
            </>
          )}
          {treeMenu.node ? <button type="button" onClick={() => copyNodePath(treeMenu.node!)}>경로 복사</button> : null}
        </div>
      ) : null}
    </aside>
  );
}

function folderName(folderPath: string) {
  const trimmed = String(folderPath || '').replace(/\/+$/, '');
  return trimmed.split('/').pop() || trimmed || '폴더';
}

function uniqueTempFileName(dirId: string, files: string[]) {
  const dir = String(dirId || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const prefix = !dir || dir === 'workspace:primary' ? '' : `${dir}/`;
  const names = new Set(files
    .filter(file => {
      const parts = normalizedParts(file);
      const parent = parts.slice(0, -1).join('/');
      return parent === (prefix ? prefix.slice(0, -1) : '');
    })
    .map(pathFileName));
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? 'untitled.md' : `untitled-${index}.md`;
    if (!names.has(name)) return name;
  }
  return `untitled-${Date.now()}.md`;
}

function uniqueTempFolderName(dirId: string, folders: string[]) {
  const dir = String(dirId || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const prefix = !dir || dir === 'workspace:primary' ? '' : `${dir}/`;
  const names = new Set(folders
    .filter(folder => {
      const parts = normalizedParts(folder);
      const parent = parts.slice(0, -1).join('/');
      return parent === (prefix ? prefix.slice(0, -1) : '');
    })
    .map(pathFileName));
  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? 'new-folder' : `new-folder-${index}`;
    if (!names.has(name)) return name;
  }
  return `new-folder-${Date.now()}`;
}

function defaultFileContent(fileName: string) {
  const lower = String(fileName || '').toLowerCase();
  if (/\.(json)$/i.test(lower)) return '{\n  \n}\n';
  if (/\.(js|mjs|cjs)$/i.test(lower)) return '';
  return `# ${fileName.replace(/\.(md|markdown|mdown|txt|text|yaml|yml|json|js|mjs|cjs)$/i, '')}\n`;
}

function pathFileName(fileId: string) {
  const parts = normalizedParts(fileId);
  return parts[parts.length - 1] || fileId || 'untitled.md';
}

function treeMenuItemCount(node: FileTreeNode, hasSplitAction: boolean) {
  if (node.type === 'folder') {
    return node.workspaceRoot ? 4 : 6;
  }

  return hasSplitAction ? 6 : 5;
}

function contextMenuPosition(event: MouseEvent, itemCount: number) {
  const menuWidth = 170;
  const menuHeight = itemCount * 28 + Math.max(0, itemCount - 1) * 3 + 10;
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
  return rootNodes;
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

function fileIconType(fileName: string) {
  const lower = String(fileName || '').toLowerCase();
  if (/\.(md|markdown|mdown)$/i.test(lower)) return 'markdown';
  if (/\.(ya?ml)$/i.test(lower)) return 'yaml';
  if (/\.(json)$/i.test(lower)) return 'json';
  if (/\.(js|mjs|cjs)$/i.test(lower)) return 'javascript';
  if (/\.(ts|tsx|jsx)$/i.test(lower)) return 'code';
  if (/\.(kt|java|swift|m|mm|c|cc|cpp|h|hpp)$/i.test(lower)) return 'code';
  if (/\.(txt|text)$/i.test(lower)) return 'text';
  return 'default';
}
