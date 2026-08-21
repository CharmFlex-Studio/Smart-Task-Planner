import type { VaultEvent } from '@shared/types.js';

/**
 * The live connection, held only while the tab is actually on screen.
 *
 * The visibility rule is not an optimisation, it is the whole point. An event stream keeps
 * one TCP connection open for as long as it exists, and a browser will only open six per
 * origin over HTTP/1.1 — a limit shared by every tab pointed at the same planner. When each
 * open tab held a stream forever, six tabs (a week of "I'll keep this one open") spent the
 * entire budget on streams alone, and every fetch queued behind them for good: the board
 * stayed empty, the model list said "Loading models…", the status line said "reconnecting…",
 * and the server answered `curl` in three milliseconds the whole time. Nothing recovered,
 * because nothing was broken enough to fail.
 *
 * A hidden tab cannot show an update anyway, so it gives its connection back and catches up
 * with one refresh when it returns. The tab you are looking at keeps its stream, so the
 * vault still feels live.
 */

/** The part of `EventSource` this needs, so a test can drive one without a network. */
export interface StreamLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export interface LiveOptions {
  /** Open a stream. Called on every (re)connect, never reused after `close()`. */
  open: () => StreamLike;
  /** Whether the tab is on screen right now. */
  visible: () => boolean;
  /** Subscribe to visibility changes. Returns its own unsubscribe. */
  watchVisibility: (onChange: () => void) => () => void;
  onEvent: (event: VaultEvent) => void;
  onConnected: (connected: boolean) => void;
  /**
   * Catch up after a gap. Events that happened while this tab held no stream were not
   * queued for it anywhere, so the only honest way back is to re-read everything.
   */
  onResume: () => void;
}

/** Start the connection. Returns a function that closes it and stops watching. */
export function connectLive(opts: LiveOptions): () => void {
  let stream: StreamLike | null = null;
  /** True once we have been disconnected, so the next healthy stream triggers a catch-up. */
  let missed = false;

  const drop = () => {
    if (!stream) return;
    stream.close();
    stream = null;
    missed = true;
    opts.onConnected(false);
  };

  const start = () => {
    if (stream) return;
    const source = opts.open();
    stream = source;

    source.addEventListener('open', () => opts.onConnected(true));
    source.addEventListener('ready', () => {
      opts.onConnected(true);
      // Only after the server has confirmed the stream is live is a catch-up worth doing.
      if (missed) {
        missed = false;
        opts.onResume();
      }
    });
    source.addEventListener('vault', (event) => {
      let payload: VaultEvent;
      try {
        payload = JSON.parse(event.data) as VaultEvent;
      } catch {
        // A malformed frame is not worth tearing the connection down for; the next real
        // event, or the next refresh, puts the tab right again.
        return;
      }
      opts.onEvent(payload);
    });
    // EventSource reconnects by itself, so an error is a gap rather than an ending — but a
    // gap all the same, and whatever changed during it has to be picked up on the way back.
    source.addEventListener('error', () => {
      missed = true;
      opts.onConnected(false);
    });
  };

  const sync = () => (opts.visible() ? start() : drop());
  sync();
  const stopWatching = opts.watchVisibility(sync);

  return () => {
    stopWatching();
    stream?.close();
    stream = null;
    opts.onConnected(false);
  };
}
