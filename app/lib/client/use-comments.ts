"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Comment, type Status } from "./api";

type NewComment = Parameters<typeof api.createComment>[1];

/** 版ごとの読み込みと保存。同じ画面内でも、古い版の通信結果は捨てる。 */
export function useComments(
  versionId: string | undefined,
  onError: (message: string) => void,
) {
  const [state, setState] = useState<{
    versionId?: string;
    comments: Comment[];
  }>({ comments: [] });
  const current = useRef<{
    versionId?: string;
    reads: number;
    writes: number;
    loaded: boolean;
  }>({ reads: 0, writes: 0, loaded: false });

  const reload = useCallback(async () => {
    const scope = current.current;
    if (!versionId || scope.versionId !== versionId || scope.writes) return;
    const request = ++scope.reads;
    const comments = await api.comments(versionId);
    if (current.current === scope && scope.reads === request && !scope.writes) {
      scope.loaded = true;
      setState({ versionId, comments });
    }
  }, [versionId]);

  useEffect(() => {
    const scope = { versionId, reads: 0, writes: 0, loaded: false };
    current.current = scope;
    reload().catch((e: Error) => {
      if (current.current === scope) onError(e.message);
    });
    const refresh = () => {
      if (document.visibilityState === "visible") reload().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current.current = { reads: 0, writes: 0, loaded: false };
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [versionId, reload, onError]);

  async function write<T>(
    action: () => Promise<T>,
    update: (comments: Comment[], value: T) => Comment[],
  ) {
    const scope = current.current;
    if (!versionId || scope.versionId !== versionId) return;
    scope.reads++;
    scope.writes++;
    try {
      const value = await action();
      if (current.current !== scope) return;
      setState((previous) => ({
        versionId,
        comments: update(
          previous.versionId === versionId ? previous.comments : [],
          value,
        ),
      }));
      return value;
    } catch (e) {
      if (current.current === scope) onError((e as Error).message);
      throw e;
    } finally {
      scope.writes--;
      // 初回取得より先に保存した場合、破棄した取得の代わりに一覧を取り直す。
      if (current.current === scope && !scope.writes && !scope.loaded) {
        void reload().catch((e: Error) => {
          if (current.current === scope) onError(e.message);
        });
      }
    }
  }

  function create(input: NewComment) {
    return write(
      () => api.createComment(versionId!, input),
      (comments, created) =>
        input.parentId
          ? comments.map((c) =>
              c.id === input.parentId
                ? { ...c, replies: [...c.replies, created] }
                : c,
            )
          : [...comments, created],
    );
  }

  function update(comment: Comment, patch: { body?: string; status?: Status }) {
    return write(
      () => api.updateComment(comment.id, patch),
      (comments, updated) =>
        comments.map((c) =>
          c.id === updated.id ? { ...updated, replies: c.replies } : c,
        ),
    );
  }

  function remove(comment: Comment) {
    return write(
      () => api.deleteComment(comment.id),
      (comments) => comments.filter((c) => c.id !== comment.id),
    );
  }

  return {
    comments: state.versionId === versionId ? state.comments : [],
    reload,
    create,
    update,
    remove,
  };
}
