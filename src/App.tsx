import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Brain,
  FileText,
  Globe2,
  GraduationCap,
  Headphones,
  Mic,
  MicOff,
  NotebookTabs,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  User,
  Volume2,
} from 'lucide-react'
import { useWebLLM } from './hooks/useWebLLM'
import {
  formatToolContext,
  loadTopicManifest,
  lookupDictionary,
  runJsCalculation,
  searchTopicBank,
  searchWeb,
  type SearchResult,
  type TopicDifficulty,
  type TopicBankItem,
} from './lib/tools'
import {
  compareSpeech,
  detectErrorNote,
  loadErrorBook,
  loadMemory,
  saveErrorBook,
  saveMemory,
  updateMemoryFromTurn,
  type ErrorNote,
  type MemoryProfile,
} from './lib/learning'

type Role = 'user' | 'assistant'
type UiLanguage = 'zh' | 'en'
type TeachingMode = 'companion' | 'balanced' | 'coach'
type VoiceGender = 'female' | 'male'
type SearchState = 'idle' | 'searching' | 'done' | 'error'
type ShadowingState = 'idle' | 'listening' | 'done'

type Message = {
  id: string
  role: Role
  text: string
  sources?: SearchResult[]
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

const uiCopy = {
  zh: {
    eyebrow: '語言學習',
    title: '聊天夥伴',
    ready: '待命',
    searching: '搜尋中',
    offline: '離線',
    partner: '夥伴設定',
    interfaceLanguage: '介面語言',
    partnerLanguage: '夥伴語言',
    teachingMode: '教學模式',
    chat: '陪聊',
    balanced: '平衡',
    coach: '教練',
    voice: '語音',
    femaleVoice: '女聲',
    maleVoice: '男聲',
    localAi: '本機 AI',
    gemmaReady: 'Gemma 已就緒',
    loadingModel: '載入中',
    preparingAi: '背景準備中',
    aiFallback: '輕量模式',
    topicBank: '聊天素材庫',
    topicCount: '篇素材',
    useTopic: '拿來聊天',
    allDifficulty: '全部難度',
    easy: '簡單',
    medium: '中等',
    hard: '困難',
    learningMemory: '學習記憶',
    errorBook: '錯誤本',
    shadowing: '跟讀練習',
    startShadowing: '開始跟讀',
    shadowingScore: '相似度',
    views: '觀看',
    siteViews: '全站',
    visitors: '訪客',
    pdfContext: 'PDF 內容',
    readingPdf: '讀取 PDF...',
    uploadPdf: '上傳 PDF',
    reset: '重設對話',
    placeholder: '輸入或用英文語音說點什麼...',
    voiceInput: '語音輸入',
    voiceUnavailable: '此瀏覽器不支援語音輸入',
    send: '送出',
  },
  en: {
    eyebrow: 'Language Learning',
    title: 'Chat Partner',
    ready: 'Ready',
    searching: 'Searching',
    offline: 'Offline',
    partner: 'Partner',
    interfaceLanguage: 'Interface language',
    partnerLanguage: 'Partner language',
    teachingMode: 'Teaching mode',
    chat: 'Chat',
    balanced: 'Balanced',
    coach: 'Coach',
    voice: 'Voice',
    femaleVoice: 'Female',
    maleVoice: 'Male',
    localAi: 'Local AI',
    gemmaReady: 'Gemma Ready',
    loadingModel: 'Loading',
    preparingAi: 'Preparing',
    aiFallback: 'Light mode',
    topicBank: 'Topic Bank',
    topicCount: 'topics',
    useTopic: 'Use topic',
    allDifficulty: 'All levels',
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    learningMemory: 'Learning Memory',
    errorBook: 'Error Book',
    shadowing: 'Shadowing',
    startShadowing: 'Start shadowing',
    shadowingScore: 'Match',
    views: 'Views',
    siteViews: 'Site',
    visitors: 'Visitors',
    pdfContext: 'PDF Context',
    readingPdf: 'Reading PDF...',
    uploadPdf: 'Upload PDF',
    reset: 'Reset Session',
    placeholder: 'Say anything...',
    voiceInput: 'Voice input',
    voiceUnavailable: 'Voice input is unavailable',
    send: 'Send',
  },
} satisfies Record<UiLanguage, Record<string, string>>

const modeCopy: Record<TeachingMode, string> = {
  companion:
    'Be a relaxed conversation partner. Do not pressure the learner, do not correct every mistake, and avoid drills unless the learner asks. Keep feedback optional and brief.',
  balanced: 'Answer naturally, then correct the most important grammar or word choice.',
  coach: 'Give direct corrections, a better version, and a short practice prompt.',
}

const voicePreferenceNames: Record<VoiceGender, string[]> = {
  female: ['female', 'woman', 'girl', 'samantha', 'victoria', 'karen', 'zira', 'susan', 'moira', 'tessa', 'sandy'],
  male: ['male', 'man', 'boy', 'daniel', 'alex', 'david', 'mark', 'fred', 'tom', 'aaron', 'guy'],
}

const starterMessages: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text:
      'Hi, I am your language partner. Pick a topic, speak or type freely, and I can either just chat with you or help with corrections when you want them.',
  },
]

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function pickVoice(voices: SpeechSynthesisVoice[], languageCode: string, gender: VoiceGender) {
  const languagePrefix = languageCode.toLowerCase().split('-')[0]
  const languageVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith(languagePrefix))
  const candidates = languageVoices.length > 0 ? languageVoices : voices
  const preferredNames = voicePreferenceNames[gender]

  return (
    candidates.find((voice) => preferredNames.some((name) => voice.name.toLowerCase().includes(name))) ??
    candidates.find((voice) => voice.default) ??
    candidates[0]
  )
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
  toolContext: string,
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
      ? 'Optional phrase you could use if it fits: "That reminds me of..."'
      : mode === 'balanced'
        ? 'Correction focus: try making your main verb and tense match the situation.'
        : 'Coach note: answer once more using one specific example and one follow-up question.'
  const closing =
    mode === 'companion'
      ? 'What do you think about it?'
      : 'My question: what part of this topic feels most interesting or difficult to explain?'

  return [
    `Let us talk about this in ${languageName}. You said: "${prompt}"`,
    sourceLine,
    pdfLine,
    toolContext ? `Useful context:\n${toolContext.slice(0, 900)}` : '',
    correction,
    modeCopy[mode],
    closing,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function App() {
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>('zh')
  const [language, setLanguage] = useState(languageOptions[0])
  const [mode, setMode] = useState<TeachingMode>('balanced')
  const [voiceGender, setVoiceGender] = useState<VoiceGender>('female')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [topicItems, setTopicItems] = useState<TopicBankItem[]>([])
  const [difficulty, setDifficulty] = useState<TopicDifficulty | 'all'>('all')
  const [memory, setMemory] = useState<MemoryProfile>(() => loadMemory())
  const [errorBook, setErrorBook] = useState<ErrorNote[]>(() => loadErrorBook())
  const [shadowingState, setShadowingState] = useState<ShadowingState>('idle')
  const [shadowingText, setShadowingText] = useState('')
  const [shadowingSpoken, setShadowingSpoken] = useState('')
  const [shadowingScore, setShadowingScore] = useState<number | null>(null)
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
  const copy = uiCopy[uiLanguage]
  const visibleTopics = topicItems.filter((item) => difficulty === 'all' || item.difficulty === difficulty)
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')

  useEffect(() => {
    saveMemory(memory)
  }, [memory])

  useEffect(() => {
    saveErrorBook(errorBook)
  }, [errorBook])

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices())
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
      window.speechSynthesis.cancel()
    }
  }, [])

  useEffect(() => {
    void loadTopicManifest()
      .then((items) => setTopicItems(items))
      .catch(() => setTopicItems([]))
  }, [])

  useEffect(() => {
    void webLLM.init()
  }, [webLLM.init])

  function speak(text: string) {
    if (!('speechSynthesis' in window)) {
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language.code
    utterance.voice = pickVoice(voices, language.code, voiceGender) ?? null
    utterance.rate = 0.95
    window.speechSynthesis.speak(utterance)
  }

  function beginShadowing(text: string) {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) return

    const target = text.split(/[.!?。！？]\s+/).find((sentence) => sentence.split(/\s+/).length >= 4) ?? text.slice(0, 160)
    setShadowingText(target)
    setShadowingSpoken('')
    setShadowingScore(null)
    speak(target)

    const recognition = new SpeechRecognition()
    recognition.lang = language.code
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const spoken = Array.from({ length: event.results.length }, (_, index) => event.results[index][0]?.transcript ?? '').join('')
      setShadowingSpoken(spoken)
      setShadowingScore(compareSpeech(target, spoken))
      setShadowingState('done')
    }
    recognition.onend = () => {
      setShadowingState((state) => (state === 'listening' ? 'done' : state))
    }
    setShadowingState('listening')
    recognition.start()
  }

  async function generateAiReply(text: string, results: SearchResult[], toolContext: string) {
    if (!webLLM.engine) {
      return makePartnerReply(text, language.reply, mode, pdfContext, results, toolContext)
    }

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
            mode === 'companion'
              ? 'In chat mode, prioritize a natural friendly reply. Keep correction optional, gentle, and at most one short phrase. Do not push exercises, drills, or repeated follow-up tasks.'
              : 'Keep the reply conversational, then include one correction or better phrase.',
            'You can use the provided tool outputs: web search, JS calculation, dictionary lookup, and topic bank matches.',
            `Learner memory: level=${memory.level}; favorite topics=${memory.favoriteTopics.join(', ') || 'unknown'}; common mistakes=${memory.commonMistakes.join(', ') || 'none yet'}.`,
            pdfContext ? `PDF context:\n${pdfContext.slice(0, 2500)}` : '',
            toolContext ? `Tool outputs:\n${toolContext.slice(0, 3500)}` : '',
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

    return (
      completion.choices[0]?.message.content?.trim() ||
      makePartnerReply(text, language.reply, mode, pdfContext, results, toolContext)
    )
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

    const [webOutcome, topicOutcome, dictionaryOutcome] = await Promise.allSettled([
      searchWeb(text, language.code),
      searchTopicBank(text),
      lookupDictionary(text),
    ])
    const webResults = webOutcome.status === 'fulfilled' ? webOutcome.value : []
    const topicResults = topicOutcome.status === 'fulfilled' ? topicOutcome.value : []
    const dictionary = dictionaryOutcome.status === 'fulfilled' ? dictionaryOutcome.value : null
    const calculation = runJsCalculation(text)
    const toolContext = formatToolContext(webResults, topicResults, calculation, dictionary)
    const dictionarySource = dictionary
      ? [
          {
            title: `${dictionary.word} (${dictionary.cefr})`,
            snippet: dictionary.definition,
            url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(dictionary.word)}`,
            source: 'dictionary' as const,
          },
        ]
      : []
    const sources = [...webResults, ...topicResults, ...dictionarySource]
    const note = detectErrorNote(text)
    if (note) {
      setErrorBook((current) => [note, ...current].slice(0, 20))
      setMemory((current) => ({
        ...current,
        commonMistakes: [note.note, ...current.commonMistakes.filter((mistake) => mistake !== note.note)].slice(0, 6),
      }))
    }

    try {
      const reply = await generateAiReply(text, sources, toolContext)
      speak(reply)
      setMemory((current) => updateMemoryFromTurn(current, text, topicResults.map((result) => result.title)))
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', text: reply, sources },
      ])
      setSearchState('done')
    } catch {
      const reply = makePartnerReply(text, language.reply, mode, pdfContext, sources, toolContext)
      speak(reply)
      setMemory((current) => updateMemoryFromTurn(current, text, topicResults.map((result) => result.title)))
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `${reply}\n\nI could not complete AI generation this time, so I stayed with the available tool context.`,
          sources,
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
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{copy.title}</h1>
          </div>
          <div className="topbar-actions">
            <div className="view-counts">
              <span>{copy.views}: <b id="vercount_value_page_pv">-</b></span>
              <span>{copy.siteViews}: <b id="vercount_value_site_pv">-</b></span>
              <span>{copy.visitors}: <b id="vercount_value_site_uv">-</b></span>
            </div>
            <div className={`status-pill ${searchState}`}>
              <Globe2 size={16} />
              {searchState === 'searching' ? copy.searching : searchState === 'error' ? copy.offline : copy.ready}
            </div>
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
                    <button
                      className="source-action"
                      type="button"
                      onClick={() => speak(message.text)}
                      aria-label={copy.voice}
                      title={copy.voice}
                    >
                      <Volume2 size={15} />
                    </button>
                    {message.role === 'assistant' ? (
                      <button
                        className="source-action"
                        type="button"
                        onClick={() => beginShadowing(message.text)}
                        aria-label={copy.shadowing}
                        title={copy.shadowing}
                      >
                        <Headphones size={15} />
                      </button>
                    ) : null}
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
            title={supportsSpeech ? copy.voiceInput : copy.voiceUnavailable}
            aria-label={copy.voiceInput}
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
            placeholder={copy.placeholder}
            rows={2}
          />
          <button
            className="send-button"
            type="button"
            onClick={() => void handleSend()}
            disabled={!query.trim() || searchState === 'searching'}
            aria-label={copy.send}
            title={copy.send}
          >
            <Send size={20} />
          </button>
        </div>
      </section>

      <aside className="control-panel">
        <section className="panel-block">
          <div className="block-title">
            <Settings2 size={18} />
            <h2>{copy.partner}</h2>
          </div>
          <label>
            {copy.interfaceLanguage}
            <select value={uiLanguage} onChange={(event) => setUiLanguage(event.target.value as UiLanguage)}>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {copy.partnerLanguage}
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
          <label>
            {copy.voice}
            <select value={voiceGender} onChange={(event) => setVoiceGender(event.target.value as VoiceGender)}>
              <option value="female">{copy.femaleVoice}</option>
              <option value="male">{copy.maleVoice}</option>
            </select>
          </label>
          <div className="segmented" role="group" aria-label={copy.teachingMode}>
            <button className={mode === 'companion' ? 'selected' : ''} onClick={() => setMode('companion')}>
              <Sparkles size={16} />
              {copy.chat}
            </button>
            <button className={mode === 'balanced' ? 'selected' : ''} onClick={() => setMode('balanced')}>
              <Brain size={16} />
              {copy.balanced}
            </button>
            <button className={mode === 'coach' ? 'selected' : ''} onClick={() => setMode('coach')}>
              <GraduationCap size={16} />
              {copy.coach}
            </button>
          </div>
        </section>

        <section className="panel-block">
          <div className="block-title">
            <Brain size={18} />
            <h2>{copy.localAi}</h2>
          </div>
          <div className={`ai-status ${webLLM.isLoaded ? 'ready' : webLLM.isLoading ? 'loading' : 'fallback'}`}>
            <Sparkles size={17} />
            {webLLM.isLoaded
              ? copy.gemmaReady
              : webLLM.isLoading
                ? `${copy.preparingAi} ${webLLM.progress}%`
                : copy.aiFallback}
          </div>
          <p className="ai-progress">{webLLM.selectedModel}</p>
        </section>

        <section className="panel-block">
          <div className="block-title">
            <Globe2 size={18} />
            <h2>{copy.topicBank}</h2>
          </div>
          <p className="ai-progress">
            {topicItems.length} {copy.topicCount}
          </p>
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as TopicDifficulty | 'all')}>
            <option value="all">{copy.allDifficulty}</option>
            <option value="easy">{copy.easy}</option>
            <option value="medium">{copy.medium}</option>
            <option value="hard">{copy.hard}</option>
          </select>
          <div className="topic-list">
            {visibleTopics.slice(0, 5).map((item) => (
              <button type="button" key={item.id} onClick={() => setQuery(item.title)}>
                <span>{item.title}</span>
                <small>
                  {copy[item.difficulty]} · {copy.useTopic}
                </small>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <div className="block-title">
            <NotebookTabs size={18} />
            <h2>{copy.learningMemory}</h2>
          </div>
          <div className="stat-grid">
            <span>Level <b>{memory.level}</b></span>
            <span>Turns <b>{memory.turns}</b></span>
          </div>
          <p className="ai-progress">{memory.favoriteTopics.join(', ') || 'No favorite topics yet'}</p>
        </section>

        <section className="panel-block">
          <div className="block-title">
            <GraduationCap size={18} />
            <h2>{copy.errorBook}</h2>
          </div>
          <div className="note-list">
            {errorBook.slice(0, 4).map((note) => (
              <article key={note.id}>
                <strong>{note.suggestion}</strong>
                <span>{note.note}</span>
              </article>
            ))}
            {errorBook.length === 0 ? <p className="ai-progress">No notes yet</p> : null}
          </div>
        </section>

        <section className="panel-block">
          <div className="block-title">
            <Headphones size={18} />
            <h2>{copy.shadowing}</h2>
          </div>
          <button
            className="ai-button"
            type="button"
            onClick={() => beginShadowing(latestAssistantMessage?.text ?? starterMessages[0].text)}
            disabled={!supportsSpeech || shadowingState === 'listening'}
          >
            <Mic size={17} />
            {copy.startShadowing}
          </button>
          {shadowingText ? <p className="ai-progress">{shadowingText}</p> : null}
          {shadowingSpoken ? <p className="ai-progress">{shadowingSpoken}</p> : null}
          {shadowingScore !== null ? (
            <p className="ai-progress">
              {copy.shadowingScore}: {shadowingScore}%
            </p>
          ) : null}
        </section>

        <section className="panel-block">
          <div className="block-title">
            <FileText size={18} />
            <h2>{copy.pdfContext}</h2>
          </div>
          <label className="upload-zone">
            <Upload size={22} />
            <span>{pdfBusy ? copy.readingPdf : pdfName || copy.uploadPdf}</span>
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
          {copy.reset}
        </button>
      </aside>
    </main>
  )
}

export default App
