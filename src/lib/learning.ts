export type MemoryProfile = {
  level: string
  favoriteTopics: string[]
  commonMistakes: string[]
  turns: number
}

export type ErrorNote = {
  id: string
  original: string
  suggestion: string
  note: string
  createdAt: string
}

const memoryKey = 'chat-partner-memory'
const errorBookKey = 'chat-partner-error-book'

const defaultMemory: MemoryProfile = {
  level: 'B1',
  favoriteTopics: [],
  commonMistakes: [],
  turns: 0,
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadMemory() {
  return readJson<MemoryProfile>(memoryKey, defaultMemory)
}

export function saveMemory(memory: MemoryProfile) {
  writeJson(memoryKey, memory)
}

export function loadErrorBook() {
  return readJson<ErrorNote[]>(errorBookKey, [])
}

export function saveErrorBook(notes: ErrorNote[]) {
  writeJson(errorBookKey, notes)
}

export function inferTopic(text: string) {
  const lower = text.toLowerCase()
  if (/ai|openai|data|iphone|tech|computer|privacy/.test(lower)) return 'technology'
  if (/food|dish|bread|soup|dessert|coffee|tequila|pancake/.test(lower)) return 'food'
  if (/taiwan|china|trump|iran|tax|law|lawsuit/.test(lower)) return 'news'
  if (/travel|destination|airplane|tulip|hong kong/.test(lower)) return 'travel'
  return ''
}

export function updateMemoryFromTurn(memory: MemoryProfile, userText: string, topicTitles: string[]) {
  const topic = inferTopic(`${userText} ${topicTitles.join(' ')}`)
  const favoriteTopics = topic && !memory.favoriteTopics.includes(topic)
    ? [topic, ...memory.favoriteTopics].slice(0, 5)
    : memory.favoriteTopics

  return {
    ...memory,
    favoriteTopics,
    turns: memory.turns + 1,
  }
}

export function detectErrorNote(text: string): ErrorNote | null {
  const checks: Array<{ pattern: RegExp; suggestion: string; note: string }> = [
    {
      pattern: /\bi am agree\b/i,
      suggestion: 'I agree.',
      note: 'Use "agree" as a verb without "am".',
    },
    {
      pattern: /\bhe go\b/i,
      suggestion: 'He goes.',
      note: 'Third-person singular verbs usually add -s.',
    },
    {
      pattern: /\bshe go\b/i,
      suggestion: 'She goes.',
      note: 'Third-person singular verbs usually add -s.',
    },
    {
      pattern: /\bmore better\b/i,
      suggestion: 'better',
      note: '"Better" already means "more good".',
    },
    {
      pattern: /\bdiscuss about\b/i,
      suggestion: 'discuss',
      note: '"Discuss" does not need "about" after it.',
    },
    {
      pattern: /\bpeople is\b/i,
      suggestion: 'people are',
      note: '"People" is plural in ordinary use.',
    },
  ]

  const found = checks.find((check) => check.pattern.test(text))
  if (!found) return null

  return {
    id: crypto.randomUUID(),
    original: text,
    suggestion: found.suggestion,
    note: found.note,
    createdAt: new Date().toISOString(),
  }
}

export function compareSpeech(target: string, spoken: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)

  const targetWords = normalize(target)
  const spokenWords = normalize(spoken)
  if (targetWords.length === 0) return 0

  const matched = targetWords.filter((word) => spokenWords.includes(word)).length
  return Math.round((matched / targetWords.length) * 100)
}
