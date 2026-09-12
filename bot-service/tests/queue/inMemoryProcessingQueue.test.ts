import { describe, expect, it, vi } from "vitest";
import { InMemoryProcessingQueue } from "../../src/queue/inMemoryProcessingQueue.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("InMemoryProcessingQueue", () => {
  it("procesa un item encolado con el processor dado", async () => {
    const processor = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const queue = new InMemoryProcessingQueue<string>(processor, onError);

    queue.enqueue("item-1");
    await delay(0);

    expect(processor).toHaveBeenCalledWith("item-1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("procesa varios items encolados en orden, sin perder ninguno", async () => {
    const processed: string[] = [];
    const processor = vi.fn().mockImplementation(async (item: string) => {
      processed.push(item);
    });
    const queue = new InMemoryProcessingQueue<string>(processor, vi.fn());

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await delay(10);

    expect(processed).toEqual(["a", "b", "c"]);
  });

  it("una excepción del processor no interrumpe la cola ni se propaga a enqueue (AC #4)", async () => {
    const onError = vi.fn();
    const boom = new Error("boom");
    const processor = vi
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValue(undefined);
    const queue = new InMemoryProcessingQueue<string>(processor, onError);

    expect(() => queue.enqueue("fallido")).not.toThrow();
    queue.enqueue("siguiente");
    await delay(10);

    expect(onError).toHaveBeenCalledWith(boom, "fallido");
    expect(processor).toHaveBeenCalledWith("siguiente");
  });

  it("no dispara dos drenados concurrentes (evita procesar el mismo item dos veces)", async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const processor = vi.fn().mockImplementation(async () => {
      concurrentCalls += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await delay(5);
      concurrentCalls -= 1;
    });
    const queue = new InMemoryProcessingQueue<number>(processor, vi.fn());

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    await delay(30);

    expect(maxConcurrent).toBe(1);
    expect(processor).toHaveBeenCalledTimes(3);
  });
});
