import { useEffect, useRef, useState, type RefObject } from "react";
import type { WebApiClient } from "../../api/useWebApiClient";
import type { DiaryEntry, LoadState } from "./diary-page-types";
import type { DiaryFilters } from "../diary-location";
import { buildDiaryListRequest, createLatestDiaryRequestTracker, settleLatestDiaryRequest } from "../diary-list-request";

type DiaryListResponse = { success: true; data: { diaries: DiaryEntry[]; metadata: { count: number } } };

// Read cancellation stays together; navigation, mutations, cache and scroll policy remain in the page.
export function useDiaryList({
  api, filters, isArchived, isArchivedDetail, isDetail, reloadKey,
  isMobileRef, listAvailableRef, loadedListUrlRef, pendingScrollRestore,
}: {
  api: WebApiClient;
  filters: DiaryFilters;
  isArchived: boolean;
  isArchivedDetail: boolean;
  isDetail: boolean;
  reloadKey: number;
  isMobileRef: RefObject<boolean>;
  listAvailableRef: RefObject<boolean>;
  loadedListUrlRef: RefObject<string>;
  pendingScrollRestore: RefObject<number | null>;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const tracker = useRef(createLatestDiaryRequestTracker());
  const listController = useRef<AbortController | null>(null);
  function invalidateList(): void {
    tracker.current.invalidate();
    listController.current?.abort();
    listController.current = null;
  }

  useEffect(() => {
    const listUrl = buildDiaryListRequest(filters).url;

    if (isDetail) {
      if (
        !isMobileRef.current ||
        !listAvailableRef.current ||
        loadedListUrlRef.current !== listUrl
      ) {
        invalidateList();
      }
      return;
    }

    if (isArchived || isArchivedDetail) {
      invalidateList();
      return;
    }

    if (
      isMobileRef.current &&
      listAvailableRef.current &&
      loadedListUrlRef.current === listUrl
    ) {
      const position = pendingScrollRestore.current;
      pendingScrollRestore.current = null;
      if (position !== null) {
        requestAnimationFrame(() => window.scrollTo({ top: position }));
      }
      return;
    }

    const controller = new AbortController();
    listController.current = controller;
    const ticket = tracker.current.begin();
    setState({ status: "loading" });
    void settleLatestDiaryRequest({
      request: api.request<DiaryListResponse>(
        listUrl,
        { signal: controller.signal },
      ),
      ticket,
      signal: controller.signal,
      onSuccess: (response) => {
        listAvailableRef.current = true;
        loadedListUrlRef.current = listUrl;
        setState({
          status: "ready",
          diaries: response.data.diaries,
          count: response.data.metadata.count,
        });
        const position = pendingScrollRestore.current;
        pendingScrollRestore.current = null;
        if (position !== null) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: position });
          });
        }
      },
      onError: () => setState({ status: "error" }),
    }).finally(() => {
      if (listController.current === controller) listController.current = null;
    });
    return () => {
      tracker.current.invalidate();
      controller.abort();
      if (listController.current === controller) listController.current = null;
    };
  }, [api, filters, isArchived, isArchivedDetail, isDetail, reloadKey]);

  return { state, setState, invalidateList };
}
