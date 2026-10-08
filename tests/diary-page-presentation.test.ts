import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as React from "../web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/node_modules/react-dom/server.js";

// Baselines were captured from the unmodified page at main@76a9d74e.
// Compare real rendered HTML, including hierarchy, attributes, copy and order.
const list = await import("../web/src/pages/diary/DiaryListPresentation.js");
const detail = await import("../web/src/pages/diary/DiaryDetailPresentation.js");
const archive = await import("../web/src/pages/diary/DiaryArchivePresentation.js");
Object.assign(globalThis, { React });
const noop = () => {};
const diary = {
  id: "entry-1", title: "Morning", content: "A quiet day.", date: "2026-08-08",
  tags: ["work", "MCP"], mood: "calm", author: "C" as const,
  created_at: "2026-08-08T01:00:00.000Z", updated_at: "2026-08-08T02:00:00.000Z",
  comments: [], comments_metadata: { count: 0, returned: 0, truncated: false },
};
const props = {
  api: { request: async () => { throw new Error("Presentation must not request"); } },
  state: "ready" as const, diary, triggerRef: { current: null }, errorMessage: null,
  editing: false, updating: false, archiving: false, author: "C" as const,
  onAuthorChange: noop, values: { title: "Morning", content: "A quiet day.", date: diary.date, tags: "work, MCP", mood: "calm" },
  setValues: { title: noop, content: noop, date: noop, tags: noop, mood: noop },
  invalid: false, onEdit: noop, onCancel: noop, onSave: noop, onArchive: noop,
  onRetry: noop, onRequestClose: () => true, onCommentsChange: noop,
  restoring: false, confirmingDelete: false, deleting: false, onRestore: noop,
  onRequestDelete: noop, onConfirmDelete: noop, onCancelDelete: noop, onBack: noop,
};
const cases = {
  loading: () => list.MobileDiaryLoading({ label: "Diary 加载中" }),
  rows: () => list.MobileDiaryRows({ diaries: [diary, { ...diary, id: "entry-2", date: "2026-07-31" }], busy: false, label: "Diary 列表", onOpen: noop }),
  busyRows: () => list.MobileDiaryRows({ diaries: [diary], busy: true, label: "Diary 列表", onOpen: noop }),
  detail: () => detail.MobileDiaryDetail(props),
  editing: () => detail.MobileDiaryDetail({ ...props, editing: true }),
  saving: () => detail.MobileDiaryDetail({ ...props, editing: true, updating: true, invalid: true }),
  detailLoading: () => detail.MobileDiaryDetail({ ...props, state: "loading" }),
  detailError: () => detail.MobileDiaryDetail({ ...props, state: "error", diary: null }),
  archiveList: () => archive.MobileArchivedDiaryList({ state: { status: "ready", diaries: [diary], count: 1 }, onBack: noop, onOpen: noop, onRetry: noop }),
  archiveEmpty: () => archive.MobileArchivedDiaryList({ state: { status: "ready", diaries: [], count: 0 }, onBack: noop, onOpen: noop, onRetry: noop }),
  archiveLoading: () => archive.MobileArchivedDiaryList({ state: { status: "loading" }, onBack: noop, onOpen: noop, onRetry: noop }),
  archiveError: () => archive.MobileArchivedDiaryList({ state: { status: "error" }, onBack: noop, onOpen: noop, onRetry: noop }),
  archiveDetail: () => archive.MobileArchivedDiaryDetail(props),
  deleteConfirm: () => archive.MobileArchivedDiaryDetail({ ...props, confirmingDelete: true }),
  deleting: () => archive.MobileArchivedDiaryDetail({ ...props, confirmingDelete: true, deleting: true }),
  archiveDetailLoading: () => archive.MobileArchivedDiaryDetail({ ...props, state: "loading" }),
  archiveDetailError: () => archive.MobileArchivedDiaryDetail({ ...props, state: "error", diary: null }),
};
const expected: Record<string, string> = {
  "loading": "70cb9951cc8545647feb3f3f4f140e5a2834938f431284448f7e200115b76770",
  "rows": "13991c1e875aa315df688f7768a8874753318dd02a8a18bd36ee04496c7f8467",
  "busyRows": "d104ec6c6cd5a84f5638eae7a8603f57a19a3b5d4e6b3b63b76e788634711c50",
  "detail": "c1c7c39e690085a911519a1855444062a30a75988f92c9c71f2c5d3580b42b06",
  "editing": "22e04a5e75ada2eeb6a1ce1b4f12f7c532a398f5fc42e2d6821070990115b2f2",
  "saving": "691927f1ef7d0cb7463bb01633dc7603eb99f338d8f79b536d9ad5b3d10f511c",
  "detailLoading": "dad1343ec64cff8d3184b28bc181b7fcb5be554576ccba24994b572a74de20c7",
  "detailError": "91e3c1b21a9fb24d11566b182ec4503f5ed6af097b1ff32b50464dc8691aa826",
  "archiveList": "7a7d189adef124fe728e47dedd8c3b775dcecad6dababde78231b92b9120105e",
  "archiveEmpty": "e9af6c8aee5f4ee29c2e603068cc8d552f739d05fec19f485506e90f9a8940e6",
  "archiveLoading": "f9c76e73e46fdc00b326bc6336661a9567e02d0f761e1055e83bafdafc9355f7",
  "archiveError": "2adfcd827ff72d117a853327ce81e21df44d02623b87a63bb18693f9794ac67e",
  "archiveDetail": "026826c6d8347ce857e100eb2777ebb390130658b6e385059380f86cb1e33418",
  "deleteConfirm": "f0cb5139c2cdf4a90367e47163df069b396f2cef98595b17327058bc41b483b0",
  "deleting": "596a58820b87232c0f2daa617e3d87f233986766a077274e07e6ff28e37f9e1a",
  "archiveDetailLoading": "ac80f6fa72670cd9a4f159b3a7fb80301fc4e6b43f9fd48d8ee5300d879dffc9",
  "archiveDetailError": "8e537a0f2cd1f7c2c226e2cf759e5d8ba63be07681998f22d297096df9fadcb2"
};
for (const [name, render] of Object.entries(cases)) {
  test(`Diary presentation preserves baseline HTML: ${name}`, () => {
    const html = renderToStaticMarkup(render());
    const hash = createHash("sha256").update(html).digest("hex");
    assert.equal(hash, expected[name]);
  });
}

// Walk the actual returned React elements without replacing child components.
function elements(node: React.ReactNode): React.ReactElement<any>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement(child)
    ? [child, ...elements((child.props as any).children)] : []);
}
function button(node: React.ReactNode, text: string) {
  const found = elements(node).find((child) => child.type === "button" && child.props.children === text);
  assert.ok(found, `Missing button: ${text}`);
  return found.props;
}

test("Diary rows preserve source order and forward exact id and trigger", () => {
  const calls: unknown[][] = [];
  const tree = list.MobileDiaryRows({ diaries: [diary, { ...diary, id: "other" }], busy: false, label: "Diary", onOpen: (...args) => calls.push(args) });
  const rows = elements(tree).filter((child) => child.type === "button");
  assert.deepEqual(rows.map((row) => row.props["data-diary-id"]), ["entry-1", "other"]);
  const trigger = {};
  rows[1].props.onClick({ currentTarget: trigger });
  assert.deepEqual(calls, [["other", trigger]]);
});

test("Diary detail forwards edit/save/cancel and preserves archive confirmation", () => {
  const calls: unknown[] = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  let confirmed = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => confirmed } });
  try {
    const tree = detail.MobileDiaryDetail({ ...props, onEdit: (value) => calls.push(value), onArchive: (id) => calls.push(id) });
    button(tree.props.topRight, "编辑").onClick();
    button(tree.props.topRight, "归档").onClick();
    assert.deepEqual(calls, [diary]);
    confirmed = true;
    button(tree.props.topRight, "归档").onClick();
    const editor = detail.MobileDiaryDetail({ ...props, editing: true, onCancel: () => calls.push("cancel"), onSave: () => calls.push("save") });
    button(editor.props.topRight, "取消").onClick();
    button(editor.props.topRight, "保存").onClick();
    assert.deepEqual(calls, [diary, diary.id, "cancel", "save"]);
  } finally {
    if (prior) Object.defineProperty(globalThis, "window", prior);
    else delete (globalThis as any).window;
  }
});

test("Archived detail forwards restore/delete/confirm and blocks close while busy", () => {
  const calls: unknown[] = [];
  const callbacks = { onRestore: (id: string) => calls.push(["restore", id]), onRequestDelete: (id: string) => calls.push(["delete", id]), onConfirmDelete: (id: string) => calls.push(["confirm", id]), onCancelDelete: () => calls.push("cancel"), onBack: () => calls.push("back") };
  const normal = archive.MobileArchivedDiaryDetail({ ...props, ...callbacks });
  button(normal.props.topRight, "恢复").onClick();
  button(normal.props.topRight, "删除").onClick();
  const confirm = archive.MobileArchivedDiaryDetail({ ...props, ...callbacks, confirmingDelete: true });
  button(confirm.props.topRight, "确认永久删除").onClick();
  button(confirm.props.topRight, "取消").onClick();
  for (const busy of [{ restoring: true }, { deleting: true }]) {
    assert.equal(archive.MobileArchivedDiaryDetail({ ...props, ...callbacks, ...busy }).props.onRequestClose(), false);
  }
  assert.equal(normal.props.onRequestClose(), true);
  assert.deepEqual(calls, [["restore", diary.id], ["delete", diary.id], ["confirm", diary.id], "cancel", "back"]);
});

test("Active/archived detail retain DiaryComments public props and callback identity", () => {
  const callback = noop;
  for (const [render, readOnly] of [[detail.MobileDiaryDetail, false], [archive.MobileArchivedDiaryDetail, true]] as const) {
    const tree = render({ ...props, onCommentsChange: callback });
    const comments = elements(tree.props.children).find((child) => typeof child.type === "function" && child.type.name === "DiaryCommentsSection");
    assert.ok(comments);
    assert.equal(comments.props.diaryId, diary.id);
    assert.equal(comments.props.comments, diary.comments);
    assert.equal(comments.props.metadata, diary.comments_metadata);
    assert.equal(comments.props.readOnly, readOnly);
    assert.equal(comments.props.onChange, callback);
  }
});
