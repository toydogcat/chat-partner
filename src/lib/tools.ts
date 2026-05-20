export type SearchResult = {
  title: string
  snippet: string
  url: string
  source: 'web' | 'topic-bank' | 'dictionary'
}

export type TopicDifficulty = 'easy' | 'medium' | 'hard'

export type TopicBankItem = {
  id: string
  title: string
  description: string
  path: string
  source: string
  difficulty: TopicDifficulty
}

export type DictionaryEntry = {
  word: string
  phonetic: string
  partOfSpeech: string
  definition: string
  example: string
  synonyms: string[]
  cefr: string
}

const baseUrl = import.meta.env.BASE_URL
let topicManifestCache: TopicBankItem[] | null = null
const topicTextCache = new Map<string, string>()

function cleanSnippet(snippet: string) {
  const element = document.createElement('span')
  element.innerHTML = snippet
  return element.textContent ?? snippet
}

function absolutePublicUrl(path: string) {
  return `${baseUrl}${path}`.replace(/\/{2,}/g, '/')
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'|/\\]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function scoreText(query: string, text: string) {
  const haystack = text.toLowerCase()
  return tokenize(query).reduce((score, token) => score + (haystack.includes(token) ? token.length : 0), 0)
}

export async function loadTopicManifest() {
  if (topicManifestCache) {
    return topicManifestCache
  }

  const response = await fetch(absolutePublicUrl('topic-bank/manifest.json'))
  if (!response.ok) {
    throw new Error(`Topic bank manifest failed with ${response.status}`)
  }

  topicManifestCache = (await response.json()) as TopicBankItem[]
  return topicManifestCache
}

async function loadTopicText(item: TopicBankItem) {
  const cached = topicTextCache.get(item.id)
  if (cached) {
    return cached
  }

  const response = await fetch(absolutePublicUrl(item.path))
  if (!response.ok) {
    throw new Error(`Topic file failed with ${response.status}`)
  }

  const text = await response.text()
  topicTextCache.set(item.id, text)
  return text
}

export async function searchWeb(query: string, languageCode: string): Promise<SearchResult[]> {
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
    source: 'web',
  }))
}

export async function searchTopicBank(query: string, limit = 3): Promise<SearchResult[]> {
  const manifest = await loadTopicManifest()
  const ranked = manifest
    .map((item) => ({
      item,
      score: scoreText(query, `${item.title} ${item.description} ${item.id}`),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const results = await Promise.all(
    ranked.map(async ({ item }) => {
      const markdown = await loadTopicText(item)
      const body = markdown
        .replace(/^---[\s\S]*?---/, '')
        .replace(/[#*_>`-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const snippet = body.slice(0, 420)

      return {
        title: item.title,
        snippet,
        url: absolutePublicUrl(item.path),
        source: 'topic-bank' as const,
      }
    }),
  )

  return results
}

function estimateCefr(word: string) {
  const clean = word.toLowerCase()
  if (clean.length <= 4) return 'A1-A2'
  if (clean.length <= 7) return 'B1'
  if (/(tion|sion|ment|ance|ence|ology|ization)$/.test(clean)) return 'B2-C1'
  return 'B1-B2'
}

function makeExample(word: string, definition: string) {
  return `I noticed the word "${word}" in this topic, so I asked my partner to explain it in a natural sentence.`
    .replace('this topic', definition.length > 0 ? 'the conversation' : 'this topic')
}

export async function lookupDictionary(input: string): Promise<DictionaryEntry | null> {
  const match = input.match(/(?:define|dictionary|word|vocab|單字|字典|查詞|意思)\s*[:：]?\s*([A-Za-z][A-Za-z -]{1,40})/i)
  const word = match?.[1]?.trim().split(/\s+/).slice(0, 3).join(' ')
  if (!word) return null

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
    if (!response.ok) throw new Error(`Dictionary failed with ${response.status}`)
    const data = (await response.json()) as Array<{
      word: string
      phonetic?: string
      meanings?: Array<{
        partOfSpeech?: string
        synonyms?: string[]
        definitions?: Array<{ definition?: string; example?: string; synonyms?: string[] }>
      }>
    }>
    const first = data[0]
    const meaning = first?.meanings?.[0]
    const definition = meaning?.definitions?.[0]
    if (!first || !definition?.definition) return null

    return {
      word: first.word || word,
      phonetic: first.phonetic || '',
      partOfSpeech: meaning?.partOfSpeech || '',
      definition: definition.definition,
      example: definition.example || makeExample(word, definition.definition),
      synonyms: [...(meaning?.synonyms ?? []), ...(definition.synonyms ?? [])].slice(0, 6),
      cefr: estimateCefr(word),
    }
  } catch {
    return {
      word,
      phonetic: '',
      partOfSpeech: '',
      definition: `A learner-facing explanation for "${word}" is not available from the dictionary API right now.`,
      example: makeExample(word, ''),
      synonyms: [],
      cefr: estimateCefr(word),
    }
  }
}

function extractExpression(input: string) {
  const explicit = input.match(/(?:calc|calculate|計算|算一下)\s*[:：]?\s*([0-9+\-*/%().,\sA-Za-z_]+)$/i)
  if (explicit) {
    return explicit[1].trim()
  }

  const mathLike = input.match(/([0-9][0-9+\-*/%().,\s]*(?:\*\*|[+\-*/%])[0-9+\-*/%().,\s]*)/)
  return mathLike?.[1]?.trim() ?? ''
}

export function runJsCalculation(input: string): string | null {
  const expression = extractExpression(input)
  if (!expression) {
    return null
  }

  const allowed = /^[0-9+\-*/%().,\sA-Za-z_]+$/.test(expression)
  const allowedNames =
    /\b(?!Math\b|abs\b|ceil\b|floor\b|round\b|sqrt\b|pow\b|max\b|min\b|sin\b|cos\b|tan\b|log\b|log10\b|exp\b|PI\b|E\b)[A-Za-z_]+\b/.test(
      expression,
    ) === false

  if (!allowed || !allowedNames) {
    return 'Calculation skipped: unsupported expression.'
  }

  try {
    const calculate = Function(
      '"use strict"; const {abs,ceil,floor,round,sqrt,pow,max,min,sin,cos,tan,log,log10,exp,PI,E}=Math; return (' +
        expression +
        ')',
    )
    const result = calculate()
    return Number.isFinite(result) ? `${expression} = ${result}` : `${expression} = ${String(result)}`
  } catch (error) {
    return `Calculation error: ${error instanceof Error ? error.message : String(error)}`
  }
}

export function formatToolContext(
  webResults: SearchResult[],
  topicResults: SearchResult[],
  calculation: string | null,
  dictionary: DictionaryEntry | null,
) {
  const sections: string[] = []

  if (webResults.length > 0) {
    sections.push(
      `Web search results:\n${webResults
        .map((result, index) => `${index + 1}. ${result.title}: ${result.snippet}`)
        .join('\n')}`,
    )
  }

  if (topicResults.length > 0) {
    sections.push(
      `Topic bank matches:\n${topicResults
        .map((result, index) => `${index + 1}. ${result.title}: ${result.snippet}`)
        .join('\n')}`,
    )
  }

  if (calculation) {
    sections.push(`JS calculation:\n${calculation}`)
  }

  if (dictionary) {
    sections.push(
      `Dictionary lookup:\n${dictionary.word} ${dictionary.phonetic} (${dictionary.partOfSpeech}, ${dictionary.cefr})\nDefinition: ${dictionary.definition}\nExample: ${dictionary.example}\nSynonyms: ${dictionary.synonyms.join(', ') || 'none'}`,
    )
  }

  return sections.join('\n\n')
}
