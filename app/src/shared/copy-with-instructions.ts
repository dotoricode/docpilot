import { copyText, listInstructions, type Instruction } from './bridge-client';

export async function copyTextWithActiveInstructions(text: string) {
  await copyText(await withActiveInstructionPrompt(text));
}

export async function withActiveInstructionPrompt(text: string) {
  try {
    const data = await listInstructions();
    const active = (data.instructions || []).filter(item => item.active && item.body?.trim());
    if (!active.length) return text;
    return [
      '아래 내용을 사용할 때는 먼저 DocPilot 활성 지침을 확인하고, 해당 지침을 우선 반영해 답변하거나 파일 내용을 수정하세요.',
      '',
      '활성 지침:',
      ...active.map(formatInstructionRef),
      '',
      text,
    ].join('\n');
  } catch {
    return text;
  }
}

function formatInstructionRef(item: Instruction) {
  const title = item.title?.trim() || '제목 없는 지침';
  const ref = item.sourceRef?.trim();
  return ref ? `- ${title} (${ref})` : `- ${title}`;
}
