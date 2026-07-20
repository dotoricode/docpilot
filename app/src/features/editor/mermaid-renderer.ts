let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;
let renderQueue: Promise<void> = Promise.resolve();
let diagramSequence = 0;

function loadMermaid() {
  mermaidModulePromise ||= import('mermaid');
  return mermaidModulePromise;
}

export function createMermaidDiagramElement(source: string, className = '') {
  const figure = document.createElement('figure');
  figure.className = `mermaid-diagram ${className}`.trim();
  figure.contentEditable = 'false';
  figure.dataset.mermaidSource = source;

  const target = document.createElement('div');
  target.className = 'mermaid-render-target';
  target.setAttribute('role', 'img');
  target.setAttribute('aria-label', 'Mermaid diagram');
  target.textContent = '다이어그램 렌더링 중…';
  figure.appendChild(target);
  void renderMermaidInto(target, source);
  return figure;
}

export function hydrateMermaidDiagrams(root: HTMLElement) {
  for (const figure of root.querySelectorAll<HTMLElement>('.mermaid-diagram[data-mermaid-pending="true"]')) {
    const source = figure.querySelector<HTMLElement>('.mermaid-source')?.textContent || '';
    const target = figure.querySelector<HTMLElement>('.mermaid-render-target');
    if (!source || !target) continue;
    figure.dataset.mermaidPending = 'false';
    void renderMermaidInto(target, source);
  }
}

function renderMermaidInto(target: HTMLElement, source: string) {
  const requestedTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral';
  const task = async () => {
    try {
      const module = await loadMermaid();
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: requestedTheme,
        flowchart: { htmlLabels: true, useMaxWidth: true },
      });
      const id = `docpilot-mermaid-${Date.now()}-${diagramSequence += 1}`;
      const { svg, bindFunctions } = await mermaid.render(id, source);
      target.innerHTML = svg;
      bindFunctions?.(target);
      target.closest('.mermaid-diagram')?.classList.add('is-rendered');
    } catch (error) {
      target.textContent = `Mermaid 다이어그램을 렌더링할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`;
      target.closest('.mermaid-diagram')?.classList.add('has-error');
    }
  };
  renderQueue = renderQueue.then(task, task);
  return renderQueue;
}
