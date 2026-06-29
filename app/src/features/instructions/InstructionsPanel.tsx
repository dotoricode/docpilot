import { useEffect, useMemo, useState } from 'react';
import {
  applyInstructionSet,
  deleteInstruction,
  deleteInstructionSet,
  listInstructions,
  saveInstruction,
  saveInstructionSet,
  type Instruction,
  type InstructionSet,
} from '../../shared/bridge-client';

type InstructionState = {
  instructions: Instruction[];
  projectSets: InstructionSet[];
  globalSets: InstructionSet[];
  activeSetId: string;
  globalActiveSetId: string;
};

const emptyState: InstructionState = {
  instructions: [],
  projectSets: [],
  globalSets: [],
  activeSetId: '',
  globalActiveSetId: '',
};

export function InstructionsPanel() {
  const [state, setState] = useState<InstructionState>(emptyState);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [setName, setSetName] = useState('');
  const [setScope, setSetScope] = useState<'project' | 'global'>('project');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const activeCount = useMemo(() => state.instructions.filter(item => item.active).length, [state.instructions]);
  const allSets = useMemo(() => [
    ...state.projectSets.map(item => ({ ...item, scope: 'project' as const })),
    ...state.globalSets.map(item => ({ ...item, scope: 'global' as const })),
  ], [state.projectSets, state.globalSets]);

  useEffect(() => {
    refresh();
  }, []);

  function applyData(data: Partial<InstructionState>) {
    setState({
      instructions: Array.isArray(data.instructions) ? data.instructions : [],
      projectSets: Array.isArray(data.projectSets) ? data.projectSets : [],
      globalSets: Array.isArray(data.globalSets) ? data.globalSets : [],
      activeSetId: data.activeSetId || '',
      globalActiveSetId: data.globalActiveSetId || '',
    });
  }

  async function refresh() {
    try {
      applyData(await listInstructions());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function mutate(action: () => Promise<Partial<InstructionState>>) {
    setBusy(true);
    try {
      applyData(await action());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addInstruction() {
    const nextBody = body.trim();
    if (!nextBody || busy) return;
    await mutate(() => saveInstruction({ title: title.trim() || nextBody.split(/\r?\n/)[0]?.slice(0, 80) || '지침', body: nextBody, active: true }));
    setTitle('');
    setBody('');
  }

  async function toggleInstruction(item: Instruction) {
    await mutate(() => saveInstruction({ ...item, active: !item.active }));
  }

  async function removeInstruction(id: string) {
    await mutate(() => deleteInstruction(id));
  }

  async function savePreset() {
    const name = setName.trim();
    if (!name || activeCount === 0 || busy) return;
    await mutate(() => saveInstructionSet(name, setScope, state.instructions.filter(item => item.active).map(item => item.id)));
    setSetName('');
  }

  async function applyPreset(item: InstructionSet) {
    await mutate(() => applyInstructionSet(item.id, item.scope));
  }

  async function removePreset(item: InstructionSet) {
    await mutate(() => deleteInstructionSet(item.id, item.scope));
  }

  return (
    <section className="instructions-panel">
      <div className="panel-title instructions-title">
        <span>Instructions</span>
        <strong>{activeCount} active</strong>
        <button type="button" disabled={busy} onClick={refresh}>새로고침</button>
      </div>
      {error ? <div className="editor-error">{error}</div> : null}
      <div className="instruction-list">
        {state.instructions.map(item => (
          <article className={`instruction-row ${item.active ? 'active' : ''}`} key={item.id}>
            <button type="button" disabled={busy} onClick={() => toggleInstruction(item)}>{item.active ? 'ON' : 'OFF'}</button>
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => removeInstruction(item.id)}>삭제</button>
          </article>
        ))}
        {!state.instructions.length ? <div className="empty-note">활성 지침 없음</div> : null}
      </div>
      <div className="instruction-form">
        <input value={title} placeholder="지침 이름" onChange={event => setTitle(event.target.value)} />
        <textarea value={body} placeholder="새 지침을 입력하세요." onChange={event => setBody(event.target.value)} />
        <button type="button" disabled={busy || !body.trim()} onClick={addInstruction}>지침 저장</button>
      </div>
      <div className="instruction-preset-form">
        <input value={setName} placeholder="프리셋 이름" onChange={event => setSetName(event.target.value)} />
        <select value={setScope} onChange={event => setSetScope(event.target.value === 'global' ? 'global' : 'project')}>
          <option value="project">프로젝트</option>
          <option value="global">전역</option>
        </select>
        <button type="button" disabled={busy || !setName.trim() || activeCount === 0} onClick={savePreset}>프리셋 저장</button>
      </div>
      <div className="instruction-set-list">
        {allSets.map(item => (
          <article className={`instruction-set-row ${state.activeSetId === item.id || state.activeSetId === `global:${item.id}` ? 'active' : ''}`} key={`${item.scope}:${item.id}`}>
            <span>{item.scope === 'global' ? '전역' : '프로젝트'}</span>
            <strong>{item.name}</strong>
            <button type="button" disabled={busy} onClick={() => applyPreset(item)}>적용</button>
            <button type="button" disabled={busy} onClick={() => removePreset(item)}>삭제</button>
          </article>
        ))}
      </div>
    </section>
  );
}
