import { decodeFingerprint, similarity, type PdfAnalysis } from "./analyze";
import type { Candidate, VersionRow } from "./repo";

type Match = {
  document: Candidate;
  version: VersionRow;
  jaccard: number;
  containment: number;
};

type Source = {
  versions(documentIds: string[]): Promise<VersionRow[]>;
  analysis(
    version: VersionRow,
  ): Promise<{ layout: string | null; fingerprint: string | null }>;
};

/** キャッシュはアップロード1回だけ。同じ候補を追加検索しても再取得・再比較しない。 */
export function createPdfMatcher(analysis: PdfAnalysis, source: Source) {
  const byDocument = new Map<string, VersionRow[]>();
  const scores = new Map<string, ReturnType<typeof similarity> | null>();

  return async (candidates: Candidate[]): Promise<Match | undefined> => {
    if (!analysis.fingerprint) return undefined;
    const missing = [...new Set(candidates.map((d) => d.id))].filter(
      (id) => !byDocument.has(id),
    );
    if (missing.length) {
      const versions = await source.versions(missing);
      for (const id of missing) byDocument.set(id, []);
      for (const version of versions)
        byDocument.get(version.document_id)!.push(version);
    }
    let best: Match | undefined;
    for (const document of candidates) {
      for (const version of byDocument.get(document.id)!) {
        if (!scores.has(version.id)) {
          const previous = await source.analysis(version);
          scores.set(
            version.id,
            previous.layout === analysis.layout && previous.fingerprint
              ? similarity(
                  analysis.fingerprint,
                  decodeFingerprint(previous.fingerprint),
                )
              : null,
          );
        }
        const sim = scores.get(version.id);
        if (!sim) continue;
        if (
          !best ||
          sim.jaccard > best.jaccard ||
          (sim.jaccard === best.jaccard &&
            document.in_thread &&
            !best.document.in_thread)
        ) {
          best = { document, version, ...sim };
        }
      }
    }
    return best;
  };
}
