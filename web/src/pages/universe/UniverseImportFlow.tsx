import { useRef, useState } from "react";
import {
  parseStandaloneUniverseJson,
  UniverseImportValidationError,
  verifyUniverseImportReadback,
  type UniverseImportPreview,
} from "./universe-import";
import {
  UniverseInitializationError,
  type UniverseService,
} from "./universe-service";
import type { UniverseReadResult } from "./universe-types";

export function UniverseImportFlow({
  service,
  onReady,
  onRecheck,
}: {
  service: Pick<UniverseService, "initializeUniverse">;
  onReady: (state: UniverseReadResult, notice: string) => void;
  onRecheck: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const [preview, setPreview] = useState<UniverseImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  const selectFile = () => {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };
  const onFileChange = async (file: File | undefined) => {
    const generation = ++readGeneration.current;
    setPreview(null);
    setError(null);
    setUncertain(false);
    if (!file) {
      setFileName(null);
      return;
    }
    setFileName(file.name);
    try {
      const parsed = parseStandaloneUniverseJson(await file.text());
      if (generation !== readGeneration.current) return;
      setPreview(parsed);
    } catch (parseError) {
      if (generation !== readGeneration.current) return;
      setPreview(null);
      setError(parseError instanceof UniverseImportValidationError
        ? "文件无法用于迁移"
        : "文件无法用于迁移");
    }
  };

  const confirm = async () => {
    if (!preview || committing || uncertain) return;
    setCommitting(true);
    setError(null);
    try {
      const outcome = await service.initializeUniverse(preview.snapshot);
      try {
        verifyUniverseImportReadback(preview.snapshot, outcome.state.snapshot);
        onReady(outcome.state, "Universe 迁移完成。");
      } catch {
        onReady(outcome.state, "Universe 已存在或状态已变化，未覆盖现有内容。");
      }
    } catch (errorValue) {
      const code = errorValue instanceof UniverseInitializationError
        ? errorValue.code
        : (errorValue as { code?: unknown } | null)?.code;
      if (code === "UNIVERSE_IMPORT_NOT_WRITTEN") {
        setError("迁移未写入，可以重新确认。");
      } else if (code === "UNIVERSE_IMPORT_UNCERTAIN") {
        setUncertain(true);
        setError("迁移状态暂时无法确认，请先重新读取；不要再次提交。");
      } else if (code === "UNIVERSE_IMPORT_ALREADY_INITIALIZED") {
        setUncertain(true);
        setError("服务器已有内容，未覆盖现有内容，请重新读取。");
      } else {
        setError("迁移未完成，请重新确认。");
      }
    } finally {
      setCommitting(false);
    }
  };

  return (
    <section className="universe-import-flow" aria-live="polite">
      <p className="universe-import-copy">Universe 还没有内容</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => { void onFileChange(event.currentTarget.files?.[0]); }}
      />
      {fileName ? <p className="universe-import-preview">{fileName}</p> : null}
      {preview ? <p className="universe-import-preview">
        {preview.counts.galaxies} 星系 · {preview.counts.nodes} 星球 · {preview.counts.relations} 连接 · {preview.counts.revisions} 历史版本
        <br />{preview.conversions.join(" · ")}
      </p> : null}
      {error ? <p className="universe-import-error">{error}</p> : null}
      {committing ? <p className="universe-import-preview">正在迁移…</p> : null}
      <div className="universe-import-actions">
        {!uncertain ? <>
          {!fileName ? <button className="universe-import-action" type="button" disabled={committing} onClick={selectFile}>选择旧 Universe JSON</button> : null}
          {preview ? <button className="universe-import-action" data-action="confirm-import" type="button" disabled={committing} onClick={() => { void confirm(); }}>确认迁移</button> : null}
          {fileName ? <button className="universe-import-action" type="button" disabled={committing} onClick={selectFile}>重新选择</button> : null}
        </> : <button className="universe-import-action" data-action="recheck-import" type="button" onClick={onRecheck}>重新读取</button>}
      </div>
    </section>
  );
}
