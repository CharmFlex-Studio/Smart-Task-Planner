import { describe, expect, it } from 'vitest';
import { connectLive, type StreamLike } from './live.js';
import type { VaultEvent } from '@shared/types.js';

/** A stand-in for EventSource that lets a test fire the events a server would send. */
class FakeStream implements StreamLike {
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  fire(type: string, data = ''): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }
}

/** A harness with a controllable visibility state and a record of every stream opened. */
function harness(startVisible = true) {
  const opened: FakeStream[] = [];
  const events: VaultEvent[] = [];
  const connected: boolean[] = [];
  let visible = startVisible;
  let onChange: (() => void) | null = null;
  let resumes = 0;

  const stop = connectLive({
    open: () => {
      const stream = new FakeStream();
      opened.push(stream);
      return stream;
    },
    visible: () => visible,
    watchVisibility: (cb) => {
      onChange = cb;
      return () => {
        onChange = null;
      };
    },
    onEvent: (event) => events.push(event),
    onConnected: (value) => connected.push(value),
    onResume: () => {
      resumes += 1;
    },
  });

  return {
    opened,
    events,
    connected,
    stop,
    watching: () => onChange !== null,
    resumes: () => resumes,
    /** The stream currently open, i.e. the most recent one that was not closed. */
    live: () => opened.filter((s) => !s.closed).length,
    setVisible(value: boolean) {
      visible = value;
      onChange?.();
    },
  };
}

describe('connectLive', () => {
  it('opens one stream when the tab starts visible', () => {
    const h = harness(true);
    expect(h.opened).toHaveLength(1);
    expect(h.live()).toBe(1);
  });

  it('opens no stream at all when the tab starts hidden', () => {
    // The case that used to eat a connection for nothing: a tab restored on startup, behind
    // five others, holding a stream it could never show the results of.
    const h = harness(false);
    expect(h.opened).toHaveLength(0);
  });

  it('releases the connection when the tab is hidden and takes one back when shown', () => {
    const h = harness(true);
    h.setVisible(false);
    expect(h.live()).toBe(0);
    expect(h.opened[0]!.closed).toBe(true);

    h.setVisible(true);
    expect(h.opened).toHaveLength(2);
    expect(h.live()).toBe(1);
  });

  it('never holds more than one stream, however often visibility flaps', () => {
    const h = harness(true);
    for (let i = 0; i < 10; i += 1) {
      h.setVisible(false);
      h.setVisible(true);
    }
    expect(h.live()).toBe(1);
  });

  it('ignores a repeated visible signal rather than opening a second stream', () => {
    const h = harness(true);
    h.setVisible(true);
    h.setVisible(true);
    expect(h.opened).toHaveLength(1);
  });

  it('catches up once after a gap, but not on the first connection', () => {
    const h = harness(true);
    h.opened[0]!.fire('ready');
    // The provider already loads everything on mount; a refresh here would just be a second
    // copy of the same requests.
    expect(h.resumes()).toBe(0);

    h.setVisible(false);
    h.setVisible(true);
    h.opened[1]!.fire('ready');
    expect(h.resumes()).toBe(1);

    // Still one catch-up, not one per ready frame.
    h.opened[1]!.fire('ready');
    expect(h.resumes()).toBe(1);
  });

  it('catches up after the stream errors and comes back', () => {
    const h = harness(true);
    h.opened[0]!.fire('ready');
    h.opened[0]!.fire('error');
    expect(h.connected.at(-1)).toBe(false);

    h.opened[0]!.fire('ready');
    expect(h.resumes()).toBe(1);
    expect(h.connected.at(-1)).toBe(true);
  });

  it('reports connection state as it changes', () => {
    const h = harness(true);
    h.opened[0]!.fire('open');
    expect(h.connected.at(-1)).toBe(true);
    h.setVisible(false);
    expect(h.connected.at(-1)).toBe(false);
  });

  it('delivers vault events to the caller', () => {
    const h = harness(true);
    h.opened[0]!.fire('vault', JSON.stringify({ kind: 'reindexed', count: 3 }));
    expect(h.events).toEqual([{ kind: 'reindexed', count: 3 }]);
  });

  it('survives a malformed frame without dropping the stream', () => {
    const h = harness(true);
    h.opened[0]!.fire('vault', 'not json');
    expect(h.events).toHaveLength(0);
    expect(h.live()).toBe(1);

    h.opened[0]!.fire('vault', JSON.stringify({ kind: 'reindexed', count: 1 }));
    expect(h.events).toHaveLength(1);
  });

  it('closes the stream and stops watching when torn down', () => {
    const h = harness(true);
    h.stop();
    expect(h.live()).toBe(0);
    expect(h.watching()).toBe(false);
    expect(h.connected.at(-1)).toBe(false);
  });

  it('opens nothing more after teardown, even if visibility changes', () => {
    const h = harness(true);
    h.stop();
    h.setVisible(false);
    h.setVisible(true);
    expect(h.opened).toHaveLength(1);
  });
});
