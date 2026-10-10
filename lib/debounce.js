/**
 * Merge the messages a person sends one after another into a single turn.
 *
 * Typing on a phone produces bursts: "проверь", "что нам ответили", "на авито"
 * arrive as three updates inside a second. Sent straight through, that is three
 * turns, three replies and three contexts the agent has to reconcile — the
 * first one usually answers a sentence the person was still writing.
 *
 * This buffers a conversation for a short window and hands the merged content
 * over as one message. Bursts are the common case; ordering inside the burst is
 * preserved because blocks are appended in arrival order and texts are joined
 * with newlines.
 *
 * Deliberately *not* buffered (the caller decides): slash commands and answers
 * to a pending question — the first must act immediately, the second only makes
 * sense on its own.
 *
 * Modelled on CoPaw's channel debounce
 * (`qwenpaw/app/channels/base.py`: `_debounce_seconds`, `get_debounce_key`,
 * `merge_native_items`), which merges native payloads per conversation key.
 */
export class MessageDebouncer {
  /**
   * @param {{ windowMs?: number, onFlush: (key: string, payload: { blocks: any[], meta?: any }) => void, logger?: any }} options
   */
  constructor(options) {
    this.windowMs = Math.max(0, options.windowMs ?? 0);
    this.onFlush = options.onFlush;
    this.logger = options.logger ?? console;
    /** conversation key -> { blocks, meta, timer } */
    this.pending = new Map();
  }

  /** Buffer one message's model blocks for its conversation. */
  push(key, blocks, meta) {
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    if (this.windowMs <= 0) {
      this.onFlush(key, { blocks, meta });
      return;
    }

    const entry = this.pending.get(key) ?? { blocks: [], meta: undefined, timer: undefined };
    entry.blocks.push(...blocks);
    if (meta !== undefined) entry.meta = meta;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.flush(key), this.windowMs);
    entry.timer.unref?.();
    this.pending.set(key, entry);
  }

  /** Deliver whatever is buffered for a conversation right now. */
  flush(key) {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    if (entry.timer) clearTimeout(entry.timer);
    const blocks = mergeBlocks(entry.blocks);
    try {
      this.onFlush(key, { blocks, meta: entry.meta });
    } catch (error) {
      this.logger.error?.('[dsh-telegram] buffered message could not be delivered', String(error));
    }
  }

  /** Deliver everything buffered — used on channel unload so nothing is lost. */
  flushAll() {
    for (const key of [...this.pending.keys()]) this.flush(key);
  }

  /** How many conversations are buffered right now (diagnostics and tests). */
  get size() {
    return this.pending.size;
  }
}

/**
 * Merge buffered blocks into one model-facing message.
 *
 * Texts become a single text block (joined with newlines, arrival order kept);
 * attachments follow in their own order, so an image sent mid-burst is not
 * swallowed by the text merge.
 *
 * @param {any[]} blocks
 * @returns {any[]}
 */
export function mergeBlocks(blocks) {
  const texts = [];
  const media = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.type === 'text') texts.push(String(block.text ?? ''));
    else media.push(block);
  }
  const merged = [];
  const text = texts.filter((part) => part.length > 0).join('\n');
  if (text) merged.push({ type: 'text', text });
  merged.push(...media);
  return merged;
}
