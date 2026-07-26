import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createDiaryFilterDebouncer,
  pushDiaryFilterHistory,
  subscribeToDiaryFilterHistory,
} from "../web/src/pages/diary-filter-history.js";
import {
  buildDiaryListRequest,
  createLatestDiaryRequestTracker,
  settleLatestDiaryRequest,
} from "../web/src/pages/diary-list-request.js";
import {
  EMPTY_DIARY_FILTERS,
  createDiaryDetailLocation,
  getDiaryDetailLocation,
  getSafeDiaryReturnTo,
  readDiaryFilters,
} from "../web/src/pages/diary-location.js";

function createWindow(path = "/diary") {
  return new JSDOM("", { url: `https://leilei-os.test${path}` }).window;
}
async function historyMove(window: Window, move: () => void) {
  await new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
    move();
  });
}

test("diary request URL has fixed independent normalized parameters", () => {
  assert.equal(buildDiaryListRequest({
    q: "  trip ",
    tag: " 日本 ",
    mood: " happy ",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-07",
  }).url, "/diary?q=trip&tag=%E6%97%A5%E6%9C%AC&mood=happy&date_from=2026-07-01&date_to=2026-07-07");
});

test("mood and date changes push once and browser back/forward restores all filters", async () => {
  const window = createWindow("/diary?q=trip&tag=Japan");
  let restored = readDiaryFilters(window.location.search);
  const unsubscribe = subscribeToDiaryFilterHistory(window, (value) => { restored = value; });
  pushDiaryFilterHistory(window, { ...restored, mood: "happy" });
  pushDiaryFilterHistory(window, {
    ...readDiaryFilters(window.location.search),
    dateFrom: "2026-07-01",
    dateTo: "2026-07-07",
  });
  await historyMove(window, () => window.history.back());
  assert.equal(restored.mood, "happy");
  assert.equal(restored.dateFrom, "");
  await historyMove(window, () => window.history.forward());
  assert.equal(restored.dateTo, "2026-07-07");
  unsubscribe();
});

test("clear all is reversible and equal normalized URLs are not duplicated", async () => {
  const window = createWindow("/diary?q=trip&tag=Japan&mood=happy");
  const initial = window.history.length;
  assert.equal(pushDiaryFilterHistory(window, EMPTY_DIARY_FILTERS), true);
  assert.equal(pushDiaryFilterHistory(window, EMPTY_DIARY_FILTERS), false);
  assert.equal(window.history.length, initial + 1);
  await historyMove(window, () => window.history.back());
  assert.equal(readDiaryFilters(window.location.search).tag, "Japan");
});

test("search and tag debounce commit only final stable values", async () => {
  const window = createWindow();
  const committed: string[] = [];
  const debouncer = createDiaryFilterDebouncer({
    delayMs: 10,
    commit(value) {
      committed.push(value);
      pushDiaryFilterHistory(window, { ...EMPTY_DIARY_FILTERS, q: value });
    },
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  });
  debouncer.schedule("旅");
  debouncer.schedule("旅行");
  debouncer.schedule("旅行日记");
  await new Promise((resolve) => window.setTimeout(resolve, 25));
  assert.deepEqual(committed, ["旅行日记"]);
  assert.equal(readDiaryFilters(window.location.search).q, "旅行日记");
});

test("tag and free-text mood each debounce to one reversible push", async () => {
  const window = createWindow();
  const commitField = (
    field: "tag" | "mood",
    values: string[],
  ) => {
    const debouncer = createDiaryFilterDebouncer({
      delayMs: 10,
      commit(value) {
        pushDiaryFilterHistory(window, {
          ...readDiaryFilters(window.location.search),
          [field]: value,
        });
      },
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
    values.forEach((value) => debouncer.schedule(value));
  };

  const initialLength = window.history.length;
  commitField("tag", ["Ja", "Japan"]);
  await new Promise((resolve) => window.setTimeout(resolve, 25));
  commitField("mood", ["ha", "happy"]);
  await new Promise((resolve) => window.setTimeout(resolve, 25));

  assert.equal(window.history.length, initialLength + 2);
  assert.deepEqual(readDiaryFilters(window.location.search), {
    ...EMPTY_DIARY_FILTERS,
    tag: "Japan",
    mood: "happy",
  });
});

test("older and aborted diary requests cannot replace current state", async () => {
  const tracker = createLatestDiaryRequestTracker();
  const old = tracker.begin();
  const oldController = new AbortController();
  let visible = "loading-new";
  tracker.invalidate();
  const latest = tracker.begin();
  await settleLatestDiaryRequest({
    request: Promise.resolve(["old"]),
    ticket: old,
    signal: oldController.signal,
    onSuccess: () => { visible = "old"; },
    onError: () => { visible = "error"; },
  });
  assert.equal(visible, "loading-new");
  assert.equal(latest.isCurrent(), true);
  oldController.abort();
  await settleLatestDiaryRequest({
    request: Promise.reject(new DOMException("aborted", "AbortError")),
    ticket: latest,
    signal: oldController.signal,
    onSuccess: () => {},
    onError: () => { visible = "abort-error"; },
  });
  assert.equal(visible, "loading-new");
});

test("diary detail returnTo is refresh-safe and restricted to the diary list", () => {
  const list = "/diary?q=trip&tag=Japan&date_from=2026-07-01";
  const detailUrl = createDiaryDetailLocation("diary-1", list);
  const parsed = new URL(detailUrl, "https://leilei-os.invalid");
  assert.deepEqual(getDiaryDetailLocation(parsed.search), {
    diaryId: "diary-1",
    returnTo: list,
  });
  assert.equal(getSafeDiaryReturnTo("https://example.com/"), "/diary");
  assert.equal(getSafeDiaryReturnTo("//example.com/diary"), "/diary");
  assert.equal(getSafeDiaryReturnTo("/task"), "/diary");
  assert.equal(getSafeDiaryReturnTo("/diary?diary=nested"), "/diary");
  assert.equal(getSafeDiaryReturnTo("/diary?returnTo=%2Fdiary"), "/diary");
  assert.equal(
    getSafeDiaryReturnTo("/diary?q=x&diary=bad&returnTo=%2Ftask"),
    "/diary",
  );
});
