import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import * as db from '../lib/db.js';
import {
  sceneFromRow, sanitizeScene, sceneChanged, sceneHasContent, sceneTooBig, MAX_SCENE_BYTES,
} from '../lib/boards.js';

// The drawing surface — Excalidraw, loaded only when the Notes tab is opened.
//
// LAZY ON PURPOSE. Excalidraw is over a megabyte and the app's bundle is already
// 1.58 MB; a top-level import would make every tab pay for a canvas most of them
// never show. `lazy` puts it in its own chunk fetched on first use.
//
// The named export is `Excalidraw`, and React.lazy wants a module whose default
// IS the component — hence the re-wrap rather than a bare import().
const Excalidraw = lazy(async () => {
  // The stylesheet is imported HERE, inside the lazy loader, not at the top of
  // the file. Notes.jsx is statically imported by App, so a top-level CSS import
  // would be hoisted into the main stylesheet and every tab would download
  // Excalidraw's several hundred kilobytes of CSS to render a to-do list.
  // Imported inside the async function, it lands in this chunk instead.
  await import('@excalidraw/excalidraw/index.css');
  const mod = await import('@excalidraw/excalidraw');
  return { default: mod.Excalidraw };
});

// Saving is debounced rather than immediate. Excalidraw fires onChange on
// pointer moves and selection, not just edits, so an eager save writes several
// times a second while a pencil is down. Two seconds after the last change is
// slow enough to batch a stroke and fast enough that nothing is lost to a tab
// switch — which is what the old board lost EVERYTHING to.
const SAVE_AFTER_MS = 2000;

export default function Board({ boardId, initialScene, onSaved, onDirty }) {
  const [api, setApi] = useState(null);
  const [state, setState] = useState('saved');   // saved | dirty | saving | error
  const [err, setErr] = useState('');
  const saved = useRef(sanitizeScene(initialScene));
  const timer = useRef(null);
  const idRef = useRef(boardId);
  idRef.current = boardId;

  const save = useCallback(async (scene) => {
    if (!idRef.current) return;
    if (sceneTooBig(scene)) {
      // Refused here rather than at Postgres. A row that will not write is a
      // drawing that is silently not being kept, which is the exact failure this
      // component exists to end.
      setState('error');
      setErr(`This board is past ${Math.round(MAX_SCENE_BYTES / 1e6)} MB. Split it across two boards — it will stop saving otherwise.`);
      return;
    }
    setState('saving'); setErr('');
    try {
      const clean = sanitizeScene(scene);
      await db.update('boards', idRef.current, { scene: clean, updated_at: new Date().toISOString() });
      saved.current = clean;
      setState('saved');
      onSaved?.();
    } catch (e) {
      setState('error');
      setErr(String(e.message || e));
    }
  }, [onSaved]);

  const onChange = useCallback((elements, appState) => {
    const scene = { elements, appState };
    if (!sceneChanged(saved.current, scene)) return;
    onDirty?.();
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(scene), SAVE_AFTER_MS);
  }, [save, onDirty]);

  // A pending save must not die with the component. Switching boards or leaving
  // the tab within the debounce window would otherwise drop the last stroke —
  // the same class of loss as before, just two seconds wide instead of forever.
  useEffect(() => () => {
    clearTimeout(timer.current);
    const live = api?.getSceneElements?.();
    if (live && sceneChanged(saved.current, { elements: live, appState: api.getAppState?.() || {} })) {
      save({ elements: live, appState: api.getAppState?.() || {} });
    }
  }, [api, save]);

  // The browser's own "are you sure" — the only thing that can interrupt a
  // close, and only while there is genuinely unsaved work.
  useEffect(() => {
    const warn = e => { if (state === 'dirty' || state === 'saving') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  return (
    <div className="board-wrap">
      <div className="board-bar small">
        <span className={`board-state board-${state}`}>
          {state === 'saved' ? 'saved' : state === 'dirty' ? 'unsaved…' : state === 'saving' ? 'saving…' : 'NOT SAVED'}
        </span>
        {err && <span className="board-err">{err}</span>}
      </div>
      <div className="board-canvas">
        <Suspense fallback={<div className="board-loading small muted">loading the canvas…</div>}>
          <Excalidraw
            key={boardId}
            excalidrawAPI={setApi}
            initialData={sceneFromRow({ scene: initialScene })}
            onChange={onChange}
            theme="dark"
            UIOptions={{
              canvasActions: {
                // Excalidraw's own load/save open FILES. This board lives in the
                // database, and offering a second, divergent place to keep it is
                // how someone ends up with two versions and no idea which is real.
                loadScene: false,
                saveToActiveFile: false,
                export: { saveFileToDisk: true },
                toggleTheme: false,
              },
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}

/** Whether a scene is worth creating a row for. Re-exported so Notes can ask
 *  without importing the whole persistence library. */
export { sceneHasContent };
