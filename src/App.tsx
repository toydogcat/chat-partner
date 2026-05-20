import { useMemo, useRef, useState } from 'react'
import {
  Bot,
  Brain,
  FileText,
  Globe2,
  GraduationCap,
  Mic,
  MicOff,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  User,
} from 'lucide-react'
import { useWebLLM } from './hooks/useWebLLM'

type Role = 'user' | 'assistant'
type TeachingMode = 'companion' | 'balanced' | 'coach'
type SearchState = 'idle' | 'searching' | 'done' | 'error'

type Message = {
  id: string
  role: Role
  text: string
  sources?: SearchResult[]
}

type SearchResult = {
  title: string
  snippet: string
  url: string
}

type SpeechRecognitionEventResult = {
  results: {
    [index: number]: {
      [index: number]: { transcript: string }
      isFinal: boolean
    }
    length: number
  }
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventResult) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const languageOptions = [
  { label: 'English', code: 'en-US', reply: 'English' },
  { label: '日本語', code: 'ja-JP', reply: 'Japanese' },
  { label: '한국어', code: 'ko-KR', reply: 'Korean' },
  { label: 'Deutsch', code: 'de-DE', reply: 'German' },
  { label: 'Français', code: 'fr-FR', reply: 'French' },
  { label: 'Español', code: 'es-ES', reply: 'Spanish' },
]

const modeCopy: Record<TeachingMode, string> = {
  companion: 'Keep the conversation warm and flowing. Offer one natural alternative phrase.',
  balanced: 'Answer naturally, then correct the most important grammar or word choice.',
  coach: 'Give direct corrections, a better version, and a short practice prompt.',
}

const starterMessages: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text:
      'Hi, I am your language partner. Pick a topic, speak or type freely, and I will keep the conversation moving with useful corrections.',
  },
]

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function cleanSnippet(snippet: string) {
  const element = document.createElement('span')
  element.innerHTML = snippet
  return element.textContent ?? snippet
}

async function searchWikipedia(query: string, languageCode: string): Promise<SearchResult[]> {
  const wikiLang = languageCode.split('-')[0] || 'en'
  const endpoint = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=3&srsearch=${encodeURIComponent(
    query,
  )}`

  const response = await fetch(endpoint)
  if (!response.ok) {
    throw new Error(`Search failed with ${response.status}`)
  }

  const data = (await response.json()) as {
    query?: { search?: Array<{ title: string; snippet: string }> }
  }

  return (data.query?.search ?? []).map((item) => ({
    title: item.title,
    snippet: cleanSnippet(item.snippet),
    url: `https://${wikiLang}.wikipedia.org/wiki/${encodeURIComponent(item.title.replaceAll(' ', '_'))}`,
  }))
}

async function readPdf(file: File) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pageLimit = Math.min(pdf.numPages, 8)
  const chunks: string[] = []

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (text) {
      chunks.push(text)
    }
  }

  return chunks.join('\n\n').slice(0, 7000)
}

function makePartnerReply(
  prompt: string,
  languageName: string,
  mode: TeachingMode,
  pdfContext: string,
  results: SearchResult[],
) {
  const sourceLine =
    results.length > 0
      ? `I found a useful angle from ${results[0].title}: ${results[0].snippet}`
      : 'I can keep chatting from your message directly.'
  const pdfLine = pdfContext
    ? `From your PDF, one relevant detail is: ${pdfContext.slice(0, 220)}${pdfContext.length > 220 ? '...' : ''}`
    : ''
  const correction =
    mode === 'companion'
      ? 'Natural phrase: "That reminds me of..."'
      : mode === 'balanced'
        ? 'Correction focus: try making your main verb and tense match the situation.'
        : 'Coach note: answer once more using one specific example and one follow-up question.'

  return [
    `Let us talk about this in ${languageName}. You said: "${prompt}"`,
    sourceLine,
    pdfLine,
    correction,
    modeCopy[mode],
    'My question: what part of this topic feels most interesting or difficult to explain?',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function App() {
  const [language, setLanguage] = useState(languageOptions[0])
  const [mode, setMode] = useState<TeachingMode>('balanced')
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>(starterMessages)
  const [pdfName, setPdfName] = useState('')
  const [pdfContext, setPdfContext] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [searchState, setSearchState] = useState<SearchState>('idle')
  const webLLM = useWebLLM()
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const supportsSpeech = useMemo(() => getSpeechRecognition() !== null, [])

  async function generateAiReply(text: string, results: SearchResult[]) {
    if (!webLLM.engine) {
      return makePartnerReply(text, language.reply, mode, pdfContext, results)
    }

    const sourceContext = results
      .map((result, index) => `${index + 1}. ${result.title}: ${result.snippet}`)
      .join('\n')
    const recentMessages = messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.text,
    }))

    const completion = await webLLM.engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: [
            `You are a ${language.reply} language-learning chat partner.`,
            `Teaching mode: ${modeCopy[mode]}`,
            'Keep the reply conversational, then include one correction or better phrase.',
            pdfContext ? `PDF context:\n${pdfContext.slice(0, 2500)}` : '',
            sourceContext ? `Web search context:\n${sourceContext}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...recentMessages,
        { role: 'user', content: text },
      ],
      max_tokens: 520,
      temperature: 0.7,
    })

    return completion.choices[0]?.message.content?.trim() || makePartnerReply(text, language.reply, mode, pdfContext, results)
  }

  async function handleSend() {
    const text = query.trim()
    if (!text || searchState === 'searching') {
      return
    }

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text }
    setMessages((current) => [...current, userMessage])
    setQuery('')
    setSearchState('searching')

    try {
      const results = await searchWikipedia(text, language.code)
      const reply = await generateAiReply(text, results)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: reply, sources: results },
      ])
      setSearchState('done')
    } catch {
      const reply = await generateAiReply(text, [])
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `${reply}\n\nI could not reach web search this time, so I stayed with the conversation context.`,
        },
      ])
      setSearchState('error')
    }
  }

  async function handlePdfUpload(file: File | undefined) {
    if (!file) {
      return
    }

    setPdfBusy(true)
    setPdfName(file.name)

    try {
      setPdfContext(await readPdf(file))
    } catch {
      setPdfContext('')
      setPdfName(`${file.name} (could not read text)`)
    } finally {
      setPdfBusy(false)
    }
  }

  function toggleSpeech() {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = language.code
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => {
        return event.results[index][0]?.transcript ?? ''
      }).join('')
      setQuery(transcript)
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  return (
    <main className="app-shell">
      <section className="conversation-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Language Learning</p>
            <h1>Chat Partner</h1>
          </div>
          <div className={`status-pill ${searchState}`}>
            <Globe2 size={16} />
            {searchState === 'searching' ? 'Searching' : searchState === 'error' ? 'Offline' : 'Ready'}
          </div>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="avatar">{message.role === 'assistant' ? <Bot size={18} /> : <User size={18} />}</div>
              <div className="bubble">
                <p>{message.text}</p>
                {message.sources && message.sources.length > 0 ? (
                  <div className="sources">
                    {message.sources.map((source) => (
                      <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <div className="composer">
          <button
            className={`icon-button ${listening ? 'active' : ''}`}
            type="button"
            onClick={toggleSpeech}
            disabled={!supportsSpeech}
            title={supportsSpeech ? 'Voice input' : 'Voice input is unavailable'}
            aria-label="Voice input"
          >
            {listening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Say anything..."
            rows={2}
          />
          <button
            className="send-button"
            type="button"
            onClick={() => void handleSend()}
            disabled={!query.trim() || searchState === 'searching'}
            aria-label="Send"
            title="Send"
          >
            <Send size={20} />
          </button>
        </div>
      </section>

      <aside className="control-panel">
        <section className="panel-block">
          <div className="block-title">
            <Settings2 size={18} />
            <h2>Partner</h2>
          </div>
          <label>
            Language
            <select
              value={language.code}
              onChange={(event) => {
                const next = languageOptions.find((option) => option.code === event.target.value)
                if (next) setLanguage(next)
              }}
            >
              {languageOptions.map((option) => (
                <option value={option.code} key={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="segmented" role="group" aria-label="Teaching mode">
            <button className={mode === 'companion' ? 'selected' : ''} onClick={() => setMode('companion')}>
              <Sparkles size={16} />
              Chat
            </button>
            <button className={mode === 'balanced' ? 'selected' : ''} onClick={() => setMode('balanced')}>
              <Brain size={16} />
              Balanced
            </button>
            <button className={mode === 'coach' ? 'selected' : ''} onClick={() => setMode('coach')}>
              <GraduationCap size={16} />
              Coach
            </button>
          </div>
        </section>

        <section className="panel-block">
          <div className="block-title">
            <Brain size={18} />
            <h2>Local AI</h2>
          </div>
          <button
            className="ai-button"
            type="button"
            onClick={() => void webLLM.init()}
            disabled={webLLM.isLoading || webLLM.isLoaded}
          >
            <Sparkles size={17} />
            {webLLM.isLoaded ? 'Gemma Ready' : webLLM.isLoading ? `${webLLM.progress}%` : 'Load Gemma'}
          </button>
          <p className="ai-progress">{webLLM.selectedModel}</p>
          {webLLM.status ? <p className="ai-progress">{webLLM.status}</p> : null}
        </section>

        <section className="panel-block">
          <div className="block-title">
            <FileText size={18} />
            <h2>PDF Context</h2>
          </div>
          <label className="upload-zone">
            <Upload size={22} />
            <span>{pdfBusy ? 'Reading PDF...' : pdfName || 'Upload PDF'}</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => void handlePdfUpload(event.target.files?.[0])}
            />
          </label>
          {pdfContext ? <p className="context-preview">{pdfContext.slice(0, 360)}</p> : null}
        </section>

        <button
          className="reset-button"
          type="button"
          onClick={() => {
            setMessages(starterMessages)
            setPdfContext('')
            setPdfName('')
            setSearchState('idle')
          }}
        >
          <Trash2 size={17} />
          Reset Session
        </button>
      </aside>
    </main>
  )
}

export default App
