interface Window {
  steve: {
    send(channel: string, ...args: unknown[]): void
    invoke<T = any>(channel: string, ...args: unknown[]): Promise<T>
    on(channel: string, cb: (...args: any[]) => void): void
  }
}
