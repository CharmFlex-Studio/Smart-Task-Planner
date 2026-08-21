import React, { useEffect, useState } from 'react';
import type { ModelsView, RepoFile, RepoSearchResult } from '@shared/types.js';
import { usePlanner } from '../state.js';
import { api, ApiError } from '../api.js';

/**
 * Choosing a model.
 *
 * Two panels, because there are two honest answers to "which model":
 *
 *   1. **One you already have.** If an OpenAI-compatible server is connected, we list what
 *      it is serving and you pick. `ollama pull <anything>` and it shows up here — which is
 *      why there is no built-in list of model names to go stale.
 *   2. **One to download.** Search Hugging Face live. Repositories, quantizations and byte
 *      sizes all come from the API as you browse, so the size shown before you commit to a
 *      multi-gigabyte download is the real one.
 *
 * The tool-calling label is a rule of thumb from the parameter count in the name. It is
 * shown because summarizing and tool calling are very different asks and people should not
 * discover the difference after a 5 GB download — but it is a guess about a size class,
 * not a measurement of that model, and it says so.
 */

export function ModelPicker() {
  const { ai, settings, saveSettings, refresh } = usePlanner();
  const [view, setView] = useState<ModelsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setView(await api.aiModels());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, ai?.state]);

  const select = async (id: string, source: 'external' | 'downloaded') => {
    await saveSettings(source === 'external' ? { externalModel: id } : { modelFile: id });
    await load();
    await refresh();
  };

  const finishSetup = async () => {
    if (!ai?.modelName) return;
    setError(null);
    try {
      // The server verifies this is the exact selected file already on disk. Only the
      // pinned llama.cpp runtime is downloaded; the multi-gigabyte GGUF is reused.
      await api.aiInstall(undefined, ai.modelName);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const installing =
    ai?.state === 'downloading' || ai?.state === 'verifying' || ai?.state === 'smoke_testing';

  if (!view) return <p className="empty-state">{error ?? 'Loading models…'}</p>;

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {view.externalError && <div className="banner warn">{view.externalError}</div>}

      {!view.external && ai?.modelInstalled && !ai.runtimeInstalled && (
        <div className="banner warn">
          <span>
            The model is downloaded, but the llama.cpp runtime needed to run it is missing.{' '}
            <button disabled={installing} onClick={() => void finishSetup()}>
              {installing ? 'Finishing setup…' : 'Finish setup'}
            </button>
          </span>
        </div>
      )}

      <h3 className="sub-head">
        {view.external ? 'Models on your local server' : 'Downloaded models'}
      </h3>

      {view.available.length === 0 ? (
        <p className="empty-state">
          {view.external
            ? 'That server is not serving any models yet. Pull one (e.g. `ollama pull qwen3.5:4b`) and it will appear here.'
            : 'Nothing downloaded yet. Find one below.'}
        </p>
      ) : (
        view.available.map((model) => (
          <button
            key={model.id}
            className={`model-option ${view.selected === model.id ? 'on' : ''}`}
            onClick={() => void select(model.id, model.source)}
          >
            <div className="name">
              {model.label}
              {model.sizeBytes ? <span className="pill">{formatBytes(model.sizeBytes)}</span> : null}
              <ToolCallingPill level={model.toolCalling} />
              {view.selected === model.id && <span className="pill green">in use</span>}
            </div>
            {model.source === 'downloaded' && (
              <div className="note">
                <span
                  role="button"
                  tabIndex={0}
                  className="link-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete ${model.id}? It can be downloaded again.`)) {
                      void api.aiRemoveModel(model.id).then(load);
                    }
                  }}
                  onKeyDown={() => {}}
                >
                  Delete
                </span>
              </div>
            )}
          </button>
        ))
      )}

      {!view.external && <Downloader suggested={view.suggested} onInstalled={load} />}

      {view.external && (
        <p className="empty-state">
          The planner is talking to a server you started, so it does not download or manage
          models itself. To use its own runtime instead, unset <code>WATSMYTASK_AI_BASE_URL</code>{' '}
          and restart.
        </p>
      )}

      {settings && !view.external && view.available.length > 0 && (
        <p className="empty-state">
          Models are stored outside your vault, so they never end up in your notes folder or
          a git history.
        </p>
      )}
    </>
  );
}

/** Search Hugging Face, open a repo, pick a quantization, download it. */
function Downloader({
  suggested,
  onInstalled,
}: {
  suggested: ModelsView['suggested'];
  onInstalled(): void | Promise<void>;
}) {
  const { ai } = usePlanner();
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<RepoSearchResult[] | null>(null);
  const [openRepo, setOpenRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<RepoFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const installing = ai?.state === 'downloading' || ai?.state === 'verifying';

  const search = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setOpenRepo(null);
    setFiles(null);
    try {
      setRepos((await api.aiSearchRepos(query)).repos);
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, err.detail].filter(Boolean).join(' ') : String(err));
    } finally {
      setBusy(false);
    }
  };

  const open = async (repo: string) => {
    setOpenRepo(repo);
    setFiles(null);
    setError(null);
    setBusy(true);
    try {
      setFiles((await api.aiRepoFiles(repo)).files);
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, err.detail].filter(Boolean).join(' ') : String(err));
      setOpenRepo(null);
    } finally {
      setBusy(false);
    }
  };

  const install = async (repo: string, file: string) => {
    setError(null);
    try {
      await api.aiInstall(repo, file);
      await onInstalled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <>
      <h3 className="sub-head">Download a model</h3>

      {installing && (
        <div className="banner info" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>
            {ai?.progressLabel ?? 'Working'}
            {ai?.progress !== undefined ? ` — ${Math.round(ai.progress * 100)}%` : ''}
          </span>
          <div className="progress-bar">
            <i style={{ width: `${Math.round((ai?.progress ?? 0) * 100)}%` }} />
          </div>
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost small" onClick={() => void api.aiCancelInstall()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <form className="quick-add" onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Hugging Face for GGUF models — qwen3.5, gemma 4, llama…"
          aria-label="Search models"
        />
        <button className="btn" type="submit" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>

      {error && <div className="banner error">{error}</div>}

      {repos === null && (
        <>
          <p className="empty-state" style={{ paddingBottom: 4 }}>
            Or start from one of these:
          </p>
          {suggested.map((s) => (
            <button key={s.repo} className="model-option" onClick={() => void open(s.repo)}>
              <div className="name">
                {s.label}
                <span className="pill">{s.repo.split('/')[0]}</span>
              </div>
              <div className="note">{s.note}</div>
            </button>
          ))}
        </>
      )}

      {repos?.length === 0 && <p className="empty-state">Nothing matched that.</p>}

      {repos?.map((repo) => (
        <button key={repo.repo} className="model-option" onClick={() => void open(repo.repo)}>
          <div className="name">
            {repo.repo}
            <ToolCallingPill level={repo.toolCalling} />
          </div>
          <div className="note">{repo.downloads.toLocaleString()} downloads</div>
        </button>
      ))}

      {openRepo && (
        <div className="quant-list">
          <div className="quant-head">
            {openRepo}
            <button className="btn ghost small" onClick={() => setOpenRepo(null)}>
              Close
            </button>
          </div>
          {files === null ? (
            <p className="empty-state" style={{ padding: '10px 14px' }}>
              Reading available quantizations…
            </p>
          ) : files.length === 0 ? (
            <p className="empty-state" style={{ padding: '10px 14px' }}>
              No usable .gguf files in that repository.
            </p>
          ) : (
            files.map((file) => (
              <div className="quant-row" key={file.file}>
                <span className="quant-name">{file.quant}</span>
                <span className="quant-size">{formatBytes(file.sizeBytes)}</span>
                {file.recommended && <span className="pill green">recommended</span>}
                {file.split && <span className="pill">multi-part</span>}
                <span className="spacer" />
                <button
                  className="btn small"
                  disabled={installing}
                  onClick={() => void install(openRepo, file.file)}
                >
                  Download
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}

function ToolCallingPill({ level }: { level: string }) {
  if (level === 'unknown') return null;
  const tone = level === 'reliable' ? 'green' : level === 'workable' ? 'amber' : 'red';
  return (
    <span
      className={`pill ${tone}`}
      title="Rule of thumb from the parameter count in the name — a guess about the size class, not a measurement of this model."
    >
      tool calling: {level}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}
