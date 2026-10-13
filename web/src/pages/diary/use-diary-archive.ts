import { useEffect, useState, type RefObject } from "react";
import type { WebApiClient } from "../../api/useWebApiClient";
import type { DiaryEntry, LoadState, DetailState } from "./diary-page-types";
import { getDiaryScrollStorage, readDiaryScrollPosition } from "../diary-scroll-restoration";

type DiaryListResponse = { success: true; data: { diaries: DiaryEntry[]; metadata: { count: number } } };
type DiaryEntryResponse = { success: true; data: DiaryEntry };

// Archive reads own their abortable effects; navigation and mutations remain in the page.
export function useDiaryArchive({ api, isArchived, archiveReloadKey, archivedDetailLocation, isMobileRef }: {
  api: WebApiClient; isArchived: boolean; archiveReloadKey: number;
  archivedDetailLocation: { diaryId: string | null; returnTo: string };
  isMobileRef: RefObject<boolean>;
}) {
  const [archivedState, setArchivedState] = useState<LoadState>({ status: "loading" });
  const [archivedDetailState, setArchivedDetailState] = useState<DetailState>(() =>
    archivedDetailLocation.diaryId ? "loading" : "idle");
  const [archivedDiary, setArchivedDiary] = useState<DiaryEntry | null>(null);
  useEffect(() => {
    if (!isArchived) return;
    const controller = new AbortController();
    setArchivedState({ status: "loading" });
    api.request<DiaryListResponse>("/diary/archived", {
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return;
      setArchivedState({
        status: "ready",
        diaries: response.data.diaries,
        count: response.data.metadata.count,
      });
      const position = readDiaryScrollPosition(
        getDiaryScrollStorage(window),
        window.location.pathname + window.location.search,
      );
      if (position !== null) {
        requestAnimationFrame(() => window.scrollTo({ top: position }));
      }
    }).catch(() => {
      if (!controller.signal.aborted) setArchivedState({ status: "error" });
    });
    return () => controller.abort();
  }, [api, archiveReloadKey, isArchived]);

  useEffect(() => {
    const id = archivedDetailLocation.diaryId;
    if (!id) {
      setArchivedDiary(null);
      setArchivedDetailState("idle");
      return;
    }
    const controller = new AbortController();
    setArchivedDiary(null);
    setArchivedDetailState("loading");
    api.request<DiaryEntryResponse>(
      `/diary/archived/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    ).then((response) => {
      if (controller.signal.aborted) return;
      setArchivedDiary(response.data);
      setArchivedDetailState("ready");
      if (!isMobileRef.current) window.scrollTo({ top: 0 });
    }).catch(() => {
      if (!controller.signal.aborted) setArchivedDetailState("error");
    });
    return () => controller.abort();
  }, [api, archiveReloadKey, archivedDetailLocation]);

  return { archivedState, setArchivedState, archivedDetailState, setArchivedDetailState, archivedDiary, setArchivedDiary };
}
