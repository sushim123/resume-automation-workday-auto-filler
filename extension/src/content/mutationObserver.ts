export class WorkdayMutationObserver {
  private observer: MutationObserver | null = null;
  private callback: (() => void) | null = null;

  constructor() {
    this.init();
  }

  public init(): void {
    if (typeof window === 'undefined' || !document.body) return;

    this.observer = new MutationObserver((_mutations) => {
      if (this.callback) {
        this.callback();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  public start(callback?: () => void): void {
    if (callback) this.callback = callback;
    if (!this.observer) this.init();
  }

  public disconnect(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
