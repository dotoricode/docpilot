const {
  DEFAULT_CONTEXT_BUDGETS: DEFAULT_BUDGETS,
  normalizeContextMode,
  budgetsForContextMode,
} = require('./shared/core/context-policy');

function compactText(text, max = 6000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  const edge = Math.floor(max / 2);
  return `${value.slice(0, edge)}\n\n...[middle omitted: ${value.length - max} chars]...\n\n${value.slice(-edge)}`;
}

function section(name, label, content, budget = null) {
  const text = String(content || '');
  return {
    name,
    label,
    content: text,
    chars: text.length,
    budget,
    included: !!text.trim(),
    truncated: typeof budget === 'number' && text.length >= budget && String(content || '').length > budget,
  };
}

function formatSessionAttachments(attachments, budgets = DEFAULT_BUDGETS) {
  if (!budgets.attachments || !budgets.attachmentChars) return { text: '', included: 0, omitted: Array.isArray(attachments) ? attachments.length : 0 };
  const list = Array.isArray(attachments) ? attachments.slice(0, budgets.attachments) : [];
  if (!list.length) return { text: '', included: 0, omitted: 0 };
  const text = list.map((item, idx) => {
    const kind = item.kind || 'text';
    const file = item.fileId ? `\nFile: ${item.fileId}` : '';
    const range = item.range ? `\nRange: ${item.range.startLine || '?'}-${item.range.endLine || '?'}` : '';
    const raw = item.text || (Array.isArray(item.selections) ? item.selections.map(s => s.text).join('\n\n---\n\n') : '');
    return `[Attachment ${idx + 1}: ${item.label || kind}]${file}${range}\nSource: ${item.source || 'unknown'}\n\`\`\`\n${compactText(raw, budgets.attachmentChars)}\n\`\`\``;
  }).join('\n\n');
  return {
    text,
    included: list.length,
    omitted: Math.max(0, (Array.isArray(attachments) ? attachments.length : 0) - list.length),
  };
}

function formatRecentSessionMessages(messages, budgets = DEFAULT_BUDGETS) {
  if (!budgets.recentTranscriptTurns || !budgets.recentTranscriptChars) return { text: '', included: 0, omitted: Array.isArray(messages) ? messages.length : 0 };
  const all = Array.isArray(messages) ? messages : [];
  const recent = all.slice(-budgets.recentTranscriptTurns);
  if (!recent.length) return { text: '', included: 0, omitted: 0 };
  const text = compactText(recent.map(msg => {
    const role = msg.role === 'assistant' ? 'Assistant' : 'User';
    return `${role}: ${compactText(msg.text || '', budgets.messageChars)}`;
  }).join('\n\n'), budgets.recentTranscriptChars);
  return {
    text,
    included: recent.length,
    omitted: Math.max(0, all.length - recent.length),
  };
}

function buildEditContract({ targetFile, targetContent, editMode }) {
  if (!editMode) return '';
  return `
DocPilot edit contract:
- This is an editing turn. Produce an immediately applicable file revision, not advice.
- Use the selected attachments as the main edit target and the current file content as the boundary.
- Preserve the document's existing language, tone, terminology, Markdown structure, and unrelated content.
- Change only what is needed to satisfy the user's instruction.
- If the instruction is vague, make the smallest high-quality edit that clearly improves the selected text.
- Before final output, self-check: instruction followed, selected context addressed, no unrelated rewrite, Markdown valid, no source content accidentally dropped.
- Return the complete updated file content inside exactly one artifact:
<docpilot-artifact kind="patch" file="${targetFile || 'relative/path.md'}">
...complete updated file content...
</docpilot-artifact>
- You may add at most one short sentence outside the artifact. Do not include markdown fences around the artifact.

Current target file content:
\`\`\`
${targetContent || '(not provided)'}
\`\`\`
`;
}

function buildProjectContract({ scope }) {
  const type = scope?.type || 'project';
  const id = scope?.id || scope?.currentFileId || '.';
  return `
DocPilot project-work contract:
- This is a project-scoped turn. Use the provided scope as the default boundary.
- Scope type: ${type}
- Scope id: ${id}
- Inspect only directly relevant files. Avoid broad repository scans unless the user explicitly asks for project-wide work.
- If you propose file deletions or cleanup, do not claim changes were applied. Return reviewable operations only.
- Use project-relative paths only. Never use absolute paths.
- For deletion cleanup, return only delete operations in exactly one artifact:
<docpilot-artifact kind="file-ops">
{
  "summary": "short summary of why these operations are proposed",
  "operations": [
    { "op": "delete", "path": "relative/path/from/project-root.md", "reason": "why this should be removed" }
  ]
}
</docpilot-artifact>
- Include now-empty directories when the user asks to remove the directory as well.
- If no file operations are needed, answer normally in prose and cite paths you inspected.
`;
}

function buildPromptModeContract(mode) {
  if (mode === 'clarify') {
    return `
Prompt refinement mode:
- Do not execute the user's task yet.
- Ask 2-3 concrete clarification questions that would materially change the final result.
- Focus on scope, priority, acceptable changes, approval criteria, and what should be left untouched.
- If the request is already specific, restate the execution plan in 3 bullets and ask for confirmation.
- Do not inspect broadly, do not produce artifacts, and do not claim work was completed.
`;
  }
  if (mode === 'grill') {
    return `
Prompt refinement mode:
- Before executing broad, destructive, or ambiguous work, ask up to 3 concrete missing-criteria questions.
- If the request is already specific enough, execute directly and mention no questions were needed.
- Do not ask open-ended preference questions when the project context already determines the answer.
`;
  }
  if (mode === 'refine') {
    return `
Prompt refinement mode:
- Internally rewrite the user's instruction into specific acceptance criteria before acting.
- Resolve small ambiguities using the attached context and active instructions.
- Do not show a long rewritten prompt unless it helps the user review the result.
`;
  }
  return `
Prompt refinement mode:
- Fast mode. Execute the user's instruction directly with the provided context.
`;
}

function buildSessionPromptPackage({
  root,
  session,
  previousMessages,
  message,
  attachments,
  outputHints = {},
  requiredInstructions = '',
  budgets = DEFAULT_BUDGETS,
}) {
  const contextMode = normalizeContextMode(outputHints.contextMode || outputHints.context || outputHints.scopeMode);
  budgets = budgetsForContextMode(contextMode, budgets);
  const targetFile = outputHints.targetFileId || attachments?.find(a => a.fileId)?.fileId || '';
  const editMode = outputHints.editMode === true;
  const turnType = outputHints.turnType || outputHints.type || (editMode ? 'edit' : 'chat');
  const promptMode = outputHints.promptMode || outputHints.mode || 'fast';
  const targetContent = outputHints.targetContent
    ? compactText(outputHints.targetContent, budgets.targetContentChars)
    : '';
  const recent = formatRecentSessionMessages(previousMessages, budgets);
  const attachmentText = formatSessionAttachments(attachments, budgets);
  const editContract = buildEditContract({ targetFile, targetContent, editMode });
  const projectContract = turnType === 'project' ? buildProjectContract({ scope: session.scope || outputHints.scope }) : '';
  const modeContract = buildPromptModeContract(promptMode);
  const sessionSummary = compactText(outputHints.sessionSummary || session.summary || '', budgets.summaryChars);

  const intro = `You are running inside a persistent DocPilot ${session.agent} session.

Project root: ${root}
Session title: ${session.title}
Prompt mode: ${promptMode}
Context mode: ${contextMode}

Performance rules:
- Answer using the session transcript and attached context first.
- Do not scan the repository broadly unless the user explicitly asks for project-wide work.
- If attached context is enough, do not inspect files.
- Keep responses concise unless the user asks for detail.

File edit output:
- If you propose a complete replacement for a file, wrap only that complete file content in:
<docpilot-artifact kind="patch" file="${targetFile || 'relative/path.md'}">
...complete file content...
</docpilot-artifact>
- Otherwise answer normally in prose.
${modeContract}${editContract}${projectContract}`;

  const sections = [
    section('activeInstructions', 'Active instructions', requiredInstructions, null),
    section('sessionIntro', 'Session instructions', intro, null),
    section('outputContract', 'Output contract', `${modeContract}${editContract}${projectContract}`.trim(), null),
    section('sessionSummary', 'Session summary', sessionSummary, budgets.summaryChars),
    section('recentTranscript', 'Recent session transcript', recent.text || '(none)', budgets.recentTranscriptChars),
    section('selectedContext', 'Current turn attachments', attachmentText.text || '(none)', budgets.attachments * budgets.attachmentChars),
    section('userTurn', 'User message', message, null),
  ];

  const prompt = `${requiredInstructions}${intro}

Session summary:
${sessionSummary || '(none)'}

Recent session transcript:
${recent.text || '(none)'}

Current turn attachments:
${attachmentText.text || '(none)'}

User message:
${message}`;

  const metadata = {
    version: 1,
    mode: promptMode,
    contextMode,
    turnType,
    agent: session.agent,
    sessionId: session.id,
    scope: session.scope || { root },
    targetFileId: targetFile,
    editMode,
    budgets,
    sections: sections.map(({ content, ...item }) => item),
    omitted: {
      transcriptMessages: recent.omitted,
      attachments: attachmentText.omitted,
    },
    included: {
      transcriptMessages: recent.included,
      attachments: attachmentText.included,
      summaryChars: sessionSummary.length,
    },
    inputChars: message.length,
    summaryChars: sessionSummary.length,
    totalPromptChars: prompt.length,
  };

  return { prompt, metadata };
}

module.exports = {
  DEFAULT_BUDGETS,
  compactText,
  buildSessionPromptPackage,
};
