import { useState } from 'react';
import type { PromptPackageSummary } from '../../shared/bridge-client';

export type PendingFileReview = {
  fileId: string;
  before: string;
  after: string;
  source: 'agent' | 'external';
  detectedAt: string;
  promptPackageSummary?: PromptPackageSummary;
};

type ChangedFilesPanelProps = {
  reviews: PendingFileReview[];
  onOpen: (review: PendingFileReview) => void;
  onMerge: (review: PendingFileReview) => void;
  onSaveMerge: (review: PendingFileReview, content: string) => void;
  onAccept: (review: PendingFileReview) => void;
  onReject: (review: PendingFileReview) => void;
};

export function ChangedFilesPanel({ reviews, onOpen, onMerge, onSaveMerge, onAccept, onReject }: ChangedFilesPanelProps) {
  return (
    <section className="changed-files-panel">
      <div className="panel-title changed-title">
        <span>변경 결과</span>
        <strong>{reviews.length}</strong>
      </div>
      {!reviews.length ? <div className="empty-note">검토할 파일 변경이 없습니다</div> : null}
      <div className="changed-list">
        {reviews.map(review => (
          <FileReviewCard
            key={review.fileId}
            review={review}
            onOpen={onOpen}
            onMerge={onMerge}
            onSaveMerge={onSaveMerge}
            onAccept={onAccept}
            onReject={onReject}
          />
        ))}
      </div>
    </section>
  );
}

function FileReviewCard({ review, onOpen, onMerge, onSaveMerge, onAccept, onReject }: {
  review: PendingFileReview;
  onOpen: (review: PendingFileReview) => void;
  onMerge: (review: PendingFileReview) => void;
  onSaveMerge: (review: PendingFileReview, content: string) => void;
  onAccept: (review: PendingFileReview) => void;
  onReject: (review: PendingFileReview) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mergedContent, setMergedContent] = useState(review.after);
  const beforeLines = review.before.split(/\r?\n/).length;
  const afterLines = review.after.split(/\r?\n/).length;
  const delta = afterLines - beforeLines;
  return (
    <article className="file-review-card">
      <header>
        <span>{review.fileId}</span>
        <small>{review.source === 'agent' ? 'Agent 변경' : '디스크 변경'}</small>
      </header>
      {review.promptPackageSummary ? <PromptPackageSummaryLine summary={review.promptPackageSummary} /> : null}
      <div className="file-review-summary">
        <span>{beforeLines.toLocaleString()}줄 → {afterLines.toLocaleString()}줄</span>
        <strong>{delta >= 0 ? '+' : ''}{delta.toLocaleString()}줄</strong>
      </div>
      {editing ? (
        <div className="merge-editor">
          <textarea
            value={mergedContent}
            onChange={event => setMergedContent(event.target.value)}
            spellCheck={false}
          />
        </div>
      ) : null}
      <footer>
        <button type="button" onClick={() => onOpen(review)}>diff 뷰로 확인</button>
        <button type="button" onClick={() => { onMerge(review); setEditing(true); }}>직접 병합</button>
        {editing ? <button type="button" onClick={() => onSaveMerge(review, mergedContent)}>병합 저장</button> : null}
        <button type="button" onClick={() => onReject(review)}>거부</button>
        <button type="button" className="accept-button" onClick={() => onAccept(review)}>수락</button>
      </footer>
    </article>
  );
}

function PromptPackageSummaryLine({ summary }: { summary: PromptPackageSummary }) {
  const total = Number(summary.totalPromptChars || 0);
  const attachments = Number(summary.included?.attachments || 0);
  const transcript = Number(summary.included?.transcriptMessages || 0);
  return (
    <div className="review-prompt-summary">
      <span>프롬프트 {total.toLocaleString()}자</span>
      <span>{summary.contextMode || 'minimal'}</span>
      <span>첨부 {attachments}개</span>
      <span>대화 {transcript}개</span>
    </div>
  );
}
