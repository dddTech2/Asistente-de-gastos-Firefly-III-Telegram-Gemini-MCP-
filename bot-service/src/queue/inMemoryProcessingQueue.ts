export type QueueProcessor<T> = (item: T) => Promise<void>;
export type QueueErrorHandler<T> = (error: unknown, item: T) => void;

/**
 * Cola en memoria, secuencial, sin persistencia — mecanismo provisional de la
 * historia 2.3 para desacoplar el ack HTTP del webhook del procesamiento real
 * del update. Deliberadamente NO es la cola persistente (BullMQ + Redis) de la
 * historia 6.2 (AC #5): si el proceso se reinicia con items pendientes, esos
 * items se pierden. Es una limitación conocida y aceptada a este volumen
 * (decenas de mensajes/día), documentada en la historia.
 */
export class InMemoryProcessingQueue<T> {
  private readonly items: T[] = [];
  private draining = false;

  constructor(
    private readonly processor: QueueProcessor<T>,
    private readonly onError: QueueErrorHandler<T>,
  ) {}

  enqueue(item: T): void {
    this.items.push(item);
    void this.drain();
  }

  get size(): number {
    return this.items.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      let next = this.items.shift();
      while (next !== undefined) {
        try {
          await this.processor(next);
        } catch (error) {
          this.onError(error, next);
        }
        next = this.items.shift();
      }
    } finally {
      this.draining = false;
    }
  }
}
