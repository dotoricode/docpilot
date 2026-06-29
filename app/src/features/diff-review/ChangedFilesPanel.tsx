import { useState } from 'react';
import { markdownBlockDiffRows } from '../../../../shared/core/markdown-block-diff';
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

type DiffRow = {
  type: 'same' | 'add' | 'del' | 'change';
  oldBlock?: string;
  newBlock?: string;
};

export function ChangedFilesPanel({ reviews, onOpen, onMerge, onSaveMerge, onAccept, onReject }: ChangedFilesPanelProps) {
  const [focusedFileId, setFocusedFileId] = useState('');
  const focusedReview = reviews.find(review => review.fileId === focusedFileId) || null;
  return (
    <section className="changed-files-panel">
      <div className="panel-title changed-title">
        <span>Changed Files</span>
        <strong>{reviews.length}</strong>
      </div>
      {focusedReview ? (
        <FocusedMergeView
          review={focusedReview}
          onBack={() => setFocusedFileId('')}
          onOpen={onOpen}
          onSaveMerge={onSaveMerge}
          onAccept={onAccept}
          onReject={onReject}
        />
      ) : (
        <>
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
            onFocus={setFocusedFileId}
          />
        ))}
      </div>
        </>
      )}
    </section>
  );
}

function FileReviewCard({ review, onOpen, onMerge, onSaveMerge, onAccept, onReject, onFocus }: {
  review: PendingFileReview;
  onOpen: (review: PendingFileReview) => void;
  onMerge: (review: PendingFileReview) => void;
  onSaveMerge: (review: PendingFileReview, content: string) => void;
  onAccept: (review: PendingFileReview) => void;
  onReject: (review: PendingFileReview) => void;
  onFocus: (fileId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mergedContent, setMergedContent] = useState(review.after);
  const rows = markdownBlockDiffRows(review.before, review.after) as DiffRow[];
  return (
    <article className="file-review-card">
      <header>
        <span>{review.fileId}</span>
        <small>{review.source === 'agent' ? 'Agent 변경' : '디스크 변경'}</small>
      </header>
      {review.promptPackageSummary ? <PromptPackageSummaryLine summary={review.promptPackageSummary} /> : null}
      <div className="diff-preview">
        {rows.slice(0, 8).map((row, index) => (
          <div className={`diff-row ${row.type}`} key={`${row.type}-${index}`}>
            <pre className="diff-old">{row.oldBlock || ''}</pre>
            <pre className="diff-new">{row.newBlock || ''}</pre>
          </div>
        ))}
        {rows.length > 8 ? <div className="diff-more">+ {rows.length - 8}개 블록 더 있음</div> : null}
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
        <button type="button" onClick={() => onOpen(review)}>열기</button>
        <button type="button" onClick={() => onFocus(review.fileId)}>크게 보기</button>
        <button type="button" onClick={() => { onMerge(review); setEditing(true); }}>빠른 수정</button>
        {editing ? <button type="button" onClick={() => onSaveMerge(review, mergedContent)}>병합 저장</button> : null}
        <button type="button" onClick={() => onReject(review)}>거부</button>
        <button type="button" className="accept-button" onClick={() => onAccept(review)}>수락</button>
      </footer>
    </article>
  );
}

function FocusedMergeView({ review, onBack, onOpen, onSaveMerge, onAccept, onReject }: {
  review: PendingFileReview;
  onBack: () => void;
  onOpen: (review: PendingFileReview) => void;
  onSaveMerge: (review: PendingFileReview, content: string) => void;
  onAccept: (review: PendingFileReview) => void;
  onReject: (review: PendingFileReview) => void;
}) {
  const [mergedContent, setMergedContent] = useState(review.after);
  const rows = markdownBlockDiffRows(review.before, review.after) as DiffRow[];
  return (
    <div className="focused-merge-view">
      <header>
        <button type="button" onClick={onBack}>목록</button>
        <span>{review.fileId}</span>
        <small>{review.source === 'agent' ? 'Agent 변경' : '디스크 변경'}</small>
      </header>
      {review.promptPackageSummary ? <PromptPackageSummaryLine summary={review.promptPackageSummary} /> : null}
      <div className="focused-diff">
        <section>
          <strong>이전</strong>
          <pre>{review.before || '(새 파일)'}</pre>
        </section>
        <section>
          <strong>변경 후</strong>
          <pre>{review.after}</pre>
        </section>
      </div>
      <div className="focused-blocks">
        {rows.map((row, index) => (
          <div className={`diff-row ${row.type}`} key={`${row.type}-${index}`}>
            <pre className="diff-old">{row.oldBlock || ''}</pre>
            <pre className="diff-new">{row.newBlock || ''}</pre>
          </div>
        ))}
      </div>
      <div className="focused-merge-editor">
        <label>병합본</label>
        <textarea value={mergedContent} onChange={event => setMergedContent(event.target.value)} spellCheck={false} />
      </div>
      <footer>
        <button type="button" onClick={() => onOpen(review)}>열기</button>
        <button type="button" onClick={() => onSaveMerge(review, mergedContent)}>병합 저장</button>
        <button type="button" onClick={() => onReject(review)}>거부</button>
        <button type="button" className="accept-button" onClick={() => onAccept(review)}>수락</button>
      </footer>
    </div>
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
