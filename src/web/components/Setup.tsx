import React from 'react';
import { usePlanner } from '../state.js';
import { api } from '../api.js';
import { Section } from './Bits.js';
import { ModelPicker } from './ModelPicker.js';

/**
 * Settings.
 *
 * The two defaults worth defending are both here and both off: writes are never applied
 * without approval, and the model is not kept resident. Each says *why* rather than just
 * offering a switch, because both are the kind of setting people turn on without realising
 * what they traded away.
 */
export function Setup() {
  const { ai, settings, saveSettings, vaultPath, refresh } = usePlanner();

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <span className="sub">everything stays on this machine</span>
      </div>

      <Section title="Vault">
        <div className="setting">
          <div className="label">
            Your tasks live here
            <small className="vault-path">{vaultPath}</small>
            <small>
              Plain markdown, one file per task. Open the folder in any editor — the planner
              picks up outside edits as they happen.
            </small>
          </div>
          <button className="btn ghost small" onClick={() => void api.reload().then(refresh)}>
            Rescan
          </button>
        </div>
        <div className="setting">
          <div className="label">
            Keep a git history
            <small>
              When the vault is a git repository, every change becomes a commit you can revert
              from the History tab.
            </small>
          </div>
          <input
            type="checkbox"
            checked={settings?.gitUndo ?? false}
            onChange={(e) => void saveSettings({ gitUndo: e.target.checked })}
          />
        </div>
      </Section>

      <Section title="Local AI">
        {ai?.error && <div className="banner error">{ai.error}</div>}
        <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 0 }}>
          Optional. The planner is fully usable without it — a model adds a chat that can read
          your tasks and draft changes for you to approve. Browsing and downloading models is
          the only time this app touches the network, and no task data goes with it.
        </p>
        <ModelPicker />
      </Section>

      <Section title="How the AI behaves">
        <div className="setting">
          <div className="label">
            Apply the chat's changes without asking
            <small>
              Off is strongly recommended. With it off, every change the model wants to make is
              shown as a diff you approve — which is what makes a small local model safe to use
              here, since a wrong guess costs you a click rather than your notes.
            </small>
          </div>
          <input
            type="checkbox"
            checked={settings?.autoApplyWrites ?? false}
            onChange={(e) => void saveSettings({ autoApplyWrites: e.target.checked })}
          />
        </div>
        <div className="setting">
          <div className="label">
            Keep the model loaded
            <small>
              Off by default: the model is unloaded after{' '}
              {Math.round((settings?.idleTimeoutMs ?? 300_000) / 60_000)} minutes idle, so it is
              not holding gigabytes of memory all day. Turn it on to trade that memory for a
              faster first reply.
            </small>
          </div>
          <input
            type="checkbox"
            checked={settings?.keepLoaded ?? false}
            onChange={(e) => void saveSettings({ keepLoaded: e.target.checked })}
          />
        </div>
        {ai?.mode === 'managed' && ai.state === 'running' && (
          <div className="setting">
            <div className="label">
              Currently loaded in memory
              <small>{ai.modelName}</small>
            </div>
            <button className="btn ghost small" onClick={() => void api.aiStop()}>
              Unload now
            </button>
          </div>
        )}
      </Section>
    </>
  );
}
