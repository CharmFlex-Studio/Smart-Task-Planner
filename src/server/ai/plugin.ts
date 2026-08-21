import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  AiState,
  AiStatus,
  AvailableModel,
  ChatMessage,
  ModelsView,
  ProposedChange,
} from '@shared/types.js';
import { externalAiBaseUrl, externalAiModel, type Paths, type Settings } from '../config.js';
import type { Scope } from '../context.js';
import type { EventBus } from '../events.js';
import {
  LLAMA_BUILD,
  SUGGESTED_REPOS,
  isSafeModelFile,
  listDownloadedModels,
  runtimeAssetForThisPlatform,
  platformKey,
} from './catalog.js';
import { downloadUrl, toolCallingForSize, isValidRepoId, isValidGgufFile } from './huggingface.js';
import { downloadFile, DownloadError } from './download.js';
import { extractArchive } from './archive.js';
import { LlamaRuntime } from './runtime.js';
import { complete, listServerModels } from './client.js';
import { runChat } from './chat.js';
import { ProposalStore, type ApplyOutcome } from './proposals.js';

/**
 * The AI plugin: everything optional, in one place.
 *
 * The planner works completely without this. Nothing in the task, vault or tools layers
 * imports it, and if no model is ever set up the only visible difference is that the chat
 * panel offers to set one up.
 *
 * Two ways to get a model, and the rest of the plugin does not care which:
 *   - **external** -- an OpenAI-compatible server the user already runs (Ollama). We list
 *     what it has and let them pick. No downloads, no process to manage.
 *   - **managed** -- we fetch llama-server and a GGUF ourselves and own the lifecycle.
 */

export interface AiPluginDeps {
  paths: Paths;
  /**
   * How the plugin gets at task data: one workspace at a time, by id. It is handed this
   * rather than the vault so that a chat is structurally incapable of reading a workspace
   * other than the one it was asked about.
   */
  scope: (workspace: string) => Scope;
  bus: EventBus;
  settings: () => Settings;
}

const DEFAULT_CONTEXT = 8192;

export class AiPlugin {
  private runtime: LlamaRuntime | null = null;
  private readonly proposals: ProposalStore;
  private installing: {
    abort: AbortController;
    /** What to show the user. */
    label: string;
    /** Which state the UI should render; kept separate so the label can be descriptive. */
    phase: 'downloading' | 'verifying' | 'smoke_testing';
    fraction?: number;
  } | null = null;
  private installError: string | undefined;
  private unverified = false;

  constructor(private readonly deps: AiPluginDeps) {
    this.proposals = new ProposalStore(deps.scope, (workspace, p) => {
      const task = deps.scope(workspace).store.getByPath(p);
      if (task) deps.bus.emit({ kind: 'task-changed', path: p, task });
    });
  }

  private get externalUrl(): string | null {
    return externalAiBaseUrl();
  }

  private get runtimeDir(): string {
    return path.join(this.deps.paths.runtime, LLAMA_BUILD);
  }

  private binaryPath(): string | null {
    const asset = runtimeAssetForThisPlatform();
    return asset ? path.join(this.runtimeDir, asset.binaryName) : null;
  }

  private runtimeInstalled(): boolean {
    const binary = this.binaryPath();
    return Boolean(binary && fs.existsSync(binary));
  }

  /** The .gguf we should run: the chosen one, or the only one there. */
  private selectedModelFile(downloaded: { file: string }[]): string | undefined {
    const chosen = this.deps.settings().modelFile;
    if (chosen && downloaded.some((d) => d.file === chosen)) return chosen;
    return downloaded.length === 1 ? downloaded[0]!.file : undefined;
  }

  private modelPath(file: string | undefined): string | null {
    if (!file || !isSafeModelFile(file)) return null;
    return path.join(this.deps.paths.models, file);
  }

  /* --------------------------------------------------------------- status */

  status(): AiStatus {
    const settings = this.deps.settings();

    if (this.externalUrl) {
      return {
        state: 'running',
        mode: 'external',
        modelName: externalAiModel(settings),
        runtimeInstalled: true,
        modelInstalled: true,
        keepLoaded: true,
      };
    }

    const runtimeInstalled = this.runtimeInstalled();
    const modelFile = settings.modelFile;
    const modelInstalled = Boolean(
      modelFile &&
        isSafeModelFile(modelFile) &&
        fs.existsSync(path.join(this.deps.paths.models, modelFile)),
    );

    let state: AiState;
    if (this.installing) state = this.installing.phase;
    else if (this.installError) state = 'error';
    else if (!runtimeInstalled || !modelInstalled) state = 'not_installed';
    else {
      const rs = this.runtime?.currentState ?? 'stopped';
      state =
        rs === 'running'
          ? 'running'
          : rs === 'starting'
            ? 'starting'
            : rs === 'stopping'
              ? 'stopping'
              : rs === 'error'
                ? 'error'
                : 'ready';
    }

    return {
      state,
      mode: 'managed',
      ...(modelFile ? { modelName: modelFile } : {}),
      runtimeInstalled,
      modelInstalled,
      ...(this.installing?.fraction !== undefined ? { progress: this.installing.fraction } : {}),
      ...(this.installing ? { progressLabel: this.installing.label } : {}),
      ...(this.installError ?? this.runtime?.error
        ? { error: this.installError ?? this.runtime?.error }
        : {}),
      ...(this.runtime?.currentPort ? { port: this.runtime.currentPort } : {}),
      ...(this.runtime?.idleMsRemaining !== undefined
        ? { idleMsRemaining: this.runtime.idleMsRemaining }
        : {}),
      keepLoaded: settings.keepLoaded,
    };
  }

  /** True when a download completed with no checksum to check it against. */
  get integrityUnverified(): boolean {
    return this.unverified;
  }

  private broadcast(): void {
    this.deps.bus.emit({ kind: 'ai-status', status: this.status() });
  }

  /* -------------------------------------------------------------- listing */

  /**
   * Everything selectable right now: models the connected server already has, or GGUFs
   * already downloaded here. Both halves are read fresh on every call, so the list can
   * never offer something that is no longer there.
   */
  async listModels(): Promise<ModelsView> {
    const settings = this.deps.settings();
    const available: AvailableModel[] = [];
    let externalError: string | undefined;
    const external = this.externalUrl;

    if (external) {
      try {
        for (const id of await listServerModels(external)) {
          available.push({
            id,
            label: id,
            source: 'external',
            toolCalling: toolCallingForSize(id).level,
          });
        }
      } catch (err) {
        externalError = `Could not list models on ${external}: ${(err as Error).message}`;
      }
    } else {
      for (const model of await listDownloadedModels(this.deps.paths.models)) {
        available.push({
          id: model.file,
          label: model.file.replace(/\.gguf$/i, ''),
          source: 'downloaded',
          sizeBytes: model.sizeBytes,
          toolCalling: toolCallingForSize(model.file).level,
        });
      }
    }

    const selected = external
      ? externalAiModel(settings)
      : this.selectedModelFile(available.map((a) => ({ file: a.id })));

    return {
      available,
      suggested: SUGGESTED_REPOS,
      ...(selected ? { selected } : {}),
      external: Boolean(external),
      ...(externalError ? { externalError } : {}),
    };
  }

  /* -------------------------------------------------------------- install */

  isInstalling(): boolean {
    return this.installing !== null;
  }

  cancelInstall(): void {
    this.installing?.abort.abort();
  }

  /**
   * Fetch the runtime and one GGUF file.
   *
   * `repo` and `file` normally come from the Hugging Face listing the user was just looking
   * at, so the size shown before the download is the real one rather than a number typed
   * into this repository months ago. `repo` may be omitted only when that exact model file
   * is already on disk; this lets a user repair a missing runtime without downloading the
   * GGUF again. Each step is atomic: a cancelled or crashed install leaves either the
   * previous state or a complete component, never something that merely looks installed.
   */
  async install(repo: string | undefined, file: string): Promise<string> {
    if (this.installing) throw new Error('An install is already running.');
    if (repo !== undefined && !isValidRepoId(repo)) {
      throw new Error(`"${repo}" is not a repository id.`);
    }
    const name = file.split('/').pop() ?? '';
    if (!isValidGgufFile(name)) throw new Error(`"${file}" is not a .gguf file.`);

    const target = path.join(this.deps.paths.models, name);
    if (!repo && !fs.existsSync(target)) {
      throw new Error('The selected model is not downloaded. Pick it from a repository first.');
    }

    const asset = runtimeAssetForThisPlatform();
    if (!asset) throw new Error(`There is no prebuilt llama.cpp runtime for ${platformKey()}.`);

    const abort = new AbortController();
    this.installing = { abort, label: 'starting', phase: 'downloading' };
    this.installError = undefined;
    this.broadcast();

    try {
      if (!this.runtimeInstalled()) {
        this.installing.label = `downloading llama.cpp ${LLAMA_BUILD}`;
        const archive = path.join(this.deps.paths.runtime, `${LLAMA_BUILD}.${asset.archive}`);
        // The checksum is a real recorded digest, so a mismatch means the file is not the
        // one we tested against and nothing is installed.
        const got = await downloadFile(asset.url, archive, {
          signal: abort.signal,
          expectedSha256: asset.sha256,
          onProgress: (p) => this.onProgress(p.fraction),
        });
        if (!got.verified) this.unverified = true;

        this.installing.label = 'unpacking the runtime';
        this.installing.phase = 'verifying';
        this.installing.fraction = undefined;
        this.broadcast();
        await extractArchive(archive, this.runtimeDir, asset.archive);
        await fsp.rm(archive, { force: true });

        const binary = this.binaryPath();
        if (!binary || !fs.existsSync(binary)) {
          throw new Error(
            `The llama.cpp archive did not contain ${asset.binaryName}. The pinned build may have changed its layout.`,
          );
        }
        await fsp.chmod(binary, 0o755).catch(() => {});
      }

      if (!fs.existsSync(target)) {
        // Proven above: a missing target always has a validated source repository.
        if (!repo) throw new Error('The selected model is not downloaded.');
        this.installing.label = `downloading ${name}`;
        this.installing.phase = 'downloading';
        this.installing.fraction = 0;
        this.broadcast();
        // Hugging Face publishes no checksum we can compare against, so this completes
        // but stays unverified. Said plainly in the UI rather than quietly implied.
        const got = await downloadFile(downloadUrl(repo, file), target, {
          signal: abort.signal,
          onProgress: (p) => this.onProgress(p.fraction),
        });
        if (!got.verified) this.unverified = true;
      }

      this.installing.label = 'starting the model for the first time';
      this.installing.phase = 'smoke_testing';
      this.installing.fraction = undefined;
      this.broadcast();
      await this.smokeTest(name);
      return name;
    } catch (err) {
      this.installError =
        err instanceof DownloadError
          ? [err.message, err.hint].filter(Boolean).join(' ')
          : (err as Error).message;
      throw err;
    } finally {
      this.installing = null;
      this.broadcast();
    }
  }

  private lastBroadcast = 0;
  private onProgress(fraction: number | undefined): void {
    if (!this.installing) return;
    this.installing.fraction = fraction;
    // Multi-gigabyte downloads produce thousands of chunks; throttle the fan-out.
    const now = Date.now();
    if (now - this.lastBroadcast < 400) return;
    this.lastBroadcast = now;
    this.broadcast();
  }

  /** Prove the pair actually works before calling the install finished. */
  private async smokeTest(file: string): Promise<void> {
    const baseUrl = await this.ensureRuntime(file);
    const result = await complete(baseUrl, {
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      // Not 8. A reasoning model can burn a small budget entirely on thinking and return
      // nothing, which reads as a corrupt download when the model is in fact fine.
      maxTokens: 64,
      timeoutMs: 180_000,
      ...(this.externalUrl ? { model: externalAiModel(this.deps.settings()) } : {}),
    });
    if (!result.content.trim()) {
      throw new Error('The model started but produced no output. The download may be corrupt.');
    }
    if (!this.deps.settings().keepLoaded) await this.stop();
  }

  /* -------------------------------------------------------------- runtime */

  private async ensureRuntime(file?: string): Promise<string> {
    const external = this.externalUrl;
    if (external) return external;

    const settings = this.deps.settings();
    const downloaded = await listDownloadedModels(this.deps.paths.models);
    const chosen = file ?? this.selectedModelFile(downloaded);
    const binary = this.binaryPath();
    const model = this.modelPath(chosen);

    if (!binary || !fs.existsSync(binary)) {
      throw new Error('The local AI runtime is not installed yet.');
    }
    if (!model || !fs.existsSync(model)) {
      throw new Error('No model is selected. Pick one in Settings.');
    }

    if (!this.runtime) {
      this.runtime = new LlamaRuntime({
        binary,
        model,
        contextSize: DEFAULT_CONTEXT,
        logDir: this.deps.paths.logs,
        idleTimeoutMs: settings.idleTimeoutMs,
        keepLoaded: settings.keepLoaded,
        onStateChange: () => this.broadcast(),
      });
    } else {
      this.runtime.update({
        binary,
        model,
        idleTimeoutMs: settings.idleTimeoutMs,
        keepLoaded: settings.keepLoaded,
      });
    }
    return this.runtime.ensure();
  }

  async stop(): Promise<void> {
    await this.runtime?.stop();
    this.broadcast();
  }

  /** Switching model stops the runtime; the new one loads lazily on the next request. */
  async onSettingsChanged(previous: Settings, next: Settings): Promise<void> {
    if (previous.modelFile !== next.modelFile) await this.stop();
    this.runtime?.update({ keepLoaded: next.keepLoaded, idleTimeoutMs: next.idleTimeoutMs });
    if (!next.keepLoaded) this.runtime?.touch();
    this.broadcast();
  }

  /** Delete a downloaded model. Only ever from an explicit user action. */
  async removeModel(file: string): Promise<void> {
    if (!isSafeModelFile(file)) throw new Error(`"${file}" is not a model file.`);
    if (this.deps.settings().modelFile === file) await this.stop();
    await fsp.rm(path.join(this.deps.paths.models, file), { force: true });
    this.broadcast();
  }

  /* ----------------------------------------------------------------- chat */

  /**
   * @param workspace the only workspace this chat may see. Everything the model is given —
   *   the task index in its prompt, the tools it can call — comes from this one scope.
   */
  async chat(userText: string, history: ChatMessage[], workspace = ''): Promise<ChatMessage> {
    const baseUrl = await this.ensureRuntime();
    const scope = this.deps.scope(workspace);
    const now = new Date();
    const { message, proposals } = await runChat({
      baseUrl,
      history,
      userText,
      workspace: scope.name,
      tasks: scope.store.list(now),
      lanes: scope.store.lanes(),
      tools: scope.tools,
      attachments: scope.attachments,
      autoApply: this.deps.settings().autoApplyWrites,
      now,
      ...(this.externalUrl ? { model: externalAiModel(this.deps.settings()) } : {}),
    });

    for (const proposal of proposals) {
      if (proposal.state === 'pending') this.proposals.add(proposal, scope.id);
    }
    return message;
  }

  getProposal(id: string): ProposedChange | undefined {
    return this.proposals.get(id);
  }

  discardProposal(id: string): boolean {
    return this.proposals.discard(id);
  }

  /** Apply a proposal the user approved. See ProposalStore for the staleness rules. */
  applyProposal(id: string): Promise<ApplyOutcome> {
    return this.proposals.apply(id);
  }
}
