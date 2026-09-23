// Only the newest requested state can publish a result. One request in flight.
export class LatestJob<T, R> {
  private revision = 0;
  private next?: { value: T; revision: number };
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private work: (value: T) => Promise<R>,
    private publish: (result: R) => void,
    private failure: (error: unknown) => void,
    private pending: (value: boolean) => void,
  ) {}
  submit(value: T) {
    this.next = { value, revision: ++this.revision };
    this.pending(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.drain(), 70);
  }
  invalidate() {
    ++this.revision;
    this.next = undefined;
    clearTimeout(this.timer);
    this.pending(false);
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.next) {
      const job = this.next;
      this.next = undefined;
      try {
        const result = await this.work(job.value);
        if (job.revision === this.revision) this.publish(result);
      } catch (error) {
        if (job.revision === this.revision) this.failure(error);
      }
    }
    this.running = false;
    this.pending(false);
  }
}
