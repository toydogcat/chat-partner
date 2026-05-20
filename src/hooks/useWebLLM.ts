import { useCallback, useState } from 'react'
import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm'

const selectedModel = 'gemma-2b-it-q4f32_1-MLC'

export function useWebLLM() {
  const [engine, setEngine] = useState<MLCEngineInterface | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('未初始化')
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const init = useCallback(async () => {
    if (engine || isLoading) return

    setIsLoading(true)
    setStatus('正在初始化...')

    const initProgressCallback = (report: InitProgressReport) => {
      setProgress(Math.round(report.progress * 100))
      setStatus(report.text)
    }

    try {
      const webllm = await import('@mlc-ai/web-llm')
      const newEngine = await webllm.CreateMLCEngine(selectedModel, {
        initProgressCallback,
      })
      setEngine(newEngine)
      setIsLoaded(true)
      setProgress(100)
      setStatus('準備就緒')
    } catch (err) {
      console.error('WebLLM Init Error:', err)
      setStatus(`初始化失敗: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoading(false)
    }
  }, [engine, isLoading])

  return { engine, progress, status, isLoaded, isLoading, init }
}
