export function useToast() {
  const m = () => (typeof window !== 'undefined' ? (window as any).$message : null)
  return {
    success: (msg: string) => m()?.success?.(msg),
    error: (msg: string) => m()?.error?.(msg),
    warning: (msg: string) => m()?.warning?.(msg),
    info: (msg: string) => m()?.info?.(msg),
  }
}
