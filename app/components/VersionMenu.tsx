"use client";

import { useEffect, useRef, useState } from "react";
import { api, type PaperSummary } from "@/app/lib/client/api";
import { DropMenu } from "@/app/components/DropMenu";
import { Icon } from "@/app/components/Icon";
import { Jp } from "@/app/components/Jp";

type Props = {
  documentId: string;
  downloadUrl: string;
  versionNumber: number;
  canSplit: boolean;
  onDelete(): void;
  onSplit(): void;
  onMove(targetId: string): void;
};

/** 版の「…」メニュー。自動の判断が外れたときに直すための操作をまとめる */
export function VersionMenu({
  documentId,
  downloadUrl,
  versionNumber,
  canSplit,
  onDelete,
  onSplit,
  onMove,
}: Props) {
  const [picking, setPicking] = useState(false);

  return (
    <>
      <DropMenu
        className="icon-btn icon-btn--tool"
        ariaLabel="この版の操作"
        label={<Icon name="ellipsis" />}
        items={[
          { label: "このPDFを保存", href: downloadUrl },
          { label: "ほかの原稿の版にする…", onSelect: () => setPicking(true) },
          ...(canSplit
            ? [
                {
                  label: `v${versionNumber} を別の原稿にする`,
                  onSelect: onSplit,
                },
              ]
            : []),
          {
            label: `v${versionNumber} を削除`,
            danger: true,
            onSelect: onDelete,
          },
        ]}
      />
      {picking && (
        <MoveDialog
          currentId={documentId}
          versionNumber={versionNumber}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            onMove(id);
          }}
        />
      )}
    </>
  );
}

function MoveDialog({
  currentId,
  versionNumber,
  onPick,
  onClose,
}: {
  currentId: string;
  versionNumber: number;
  onPick(id: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [documents, setDocuments] = useState<PaperSummary[] | null>(null);
  useEffect(() => {
    ref.current?.showModal();
    api.documents().then(
      (ds) => setDocuments(ds.filter((d) => d.id !== currentId)),
      () => setDocuments([]),
    );
  }, [currentId]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      <h2>v{versionNumber} をどの原稿の版にしますか？</h2>
      <p>
        <Jp>
          {
            "選んだ原稿の、いちばん新しい版として移します。\nこの版のコメントも一緒に移ります。"
          }
        </Jp>
      </p>
      {documents === null ? (
        <p>読み込み中…</p>
      ) : documents.length === 0 ? (
        <p>ほかの原稿がありません。</p>
      ) : (
        <ul className="pick-list">
          {documents.map((d) => (
            <li key={d.id}>
              <button onClick={() => onPick(d.id)}>
                <span className="pick-list__title">{d.title}</span>
                <span className="pick-list__meta">
                  {d.latest_version ? `v${d.latest_version}` : "PDFなし"}
                  {d.authors[0]
                    ? ` · ${d.authors[0].name}`
                    : d.created_by && ` · ${d.created_by}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog__actions">
        <button className="btn" onClick={() => ref.current?.close()}>
          キャンセル
        </button>
      </div>
    </dialog>
  );
}
