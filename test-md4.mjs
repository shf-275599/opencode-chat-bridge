// Test: use plain text delimiter
function escapeMarkdownV2(text) {
  let result = text.replace(/\\/g, "\\\\")
  result = result.replace(/([_\*\[\]()~`>#+\-=|{}.!])/g, "\\$1")
  return result
}

function mdToMarkdownV2(text) {
  const bld = [], italic = [], links = [], codeblocks = [], inlinecodes = []
  let md = text.replace(/\r\n/g, "\n")

  md = md.replace(/```([a-zA-Z0-9_+-]+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeblocks.push((lang ? '\x02' + lang + '\x03' + '\n' : '') + code.trimEnd() + '\x02\x03') - 1
    return '\x02CODEBLOCK' + index + '\x03'
  })

  md = md.replace(/`([^`]+)`/g, (_match, code) => {
    const index = inlinecodes.push('\x02' + code + '\x03') - 1
    return '\x02INLINECODE' + index + '\x03'
  })

  md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, text, url) => {
    const index = links.push('\x02' + text + '\x03(' + url + ')') - 1
    return '\x02LINK' + index + '\x03'
  })

  md = md.replace(/\*\*([^*]+)\*\*/g, (_match, content) => {
    const index = bld.push('\x02' + content + '\x03') - 1
    return '\x02BOLD' + index + '\x03'
  })

  md = md.replace(/\*([^*]+)\*/g, (_match, content) => {
    const index = italic.push('\x02' + content + '\x03') - 1
    return '\x02ITALIC' + index + '\x03'
  })
  md = md.replace(/_(?![\x02\x03])([^_]+)_(?![\x02\x03])/g, (_match, content) => {
    const index = italic.push('\x02' + content + '\x03') - 1
    return '\x02ITALIC' + index + '\x03'
  })

  md = md.replace(/^>\s?(.*)$/gm, "$1")
  md = md.replace(/^\s*-\s+(.*)$/gm, "• $1")
  md = md.replace(/^\s*\d+\.\s+(.*)$/gm, "$1")
  md = md.replace(/\|\|([^|]+)\|\|/g, "||$1||")
  md = md.replace(/~~([^~]+)~~/g, "~$1~")

  md = escapeMarkdownV2(md)

  md = md.replace(/\x02BOLD(\d+)\x03/g, (_m, idx) => '**' + bld[Number(idx)] + '**')
  md = md.replace(/\x02ITALIC(\d+)\x03/g, (_m, idx) => '*' + italic[Number(idx)] + '*')
  md = md.replace(/\x02LINK(\d+)\x03/g, (_m, idx) => '[' + links[Number(idx)] + ']')
  md = md.replace(/\x02CODEBLOCK(\d+)\x03/g, (_m, idx) => codeblocks[Number(idx)])
  md = md.replace(/\x02INLINECODE(\d+)\x03/g, (_m, idx) => '`' + inlinecodes[Number(idx)] + '`')

  return md
}

const tests = [
  { name: 'bold', input: '**bold**', expect: '**bold**' },
  { name: 'italic star', input: '*italic*', expect: '*italic*' },
  { name: 'italic underscore', input: '_italic_', expect: '*_italic_*' },
  { name: 'link', input: '[link](https://example.com)', expect: '*[link](https://example.com)*' },
  { name: 'inline code', input: '`const x = 1`', expect: '`*const x = 1`*' },
  { name: 'code block', input: '```ts\nconst x = 1\n```', expect: '*```ts\nconst x = 1\n```*' },
  { name: 'paren', input: '(text)', expect: '*(text)*' },
  { name: 'dash', input: 'a-b', expect: '*a-b*' },
]
let passed = 0, failed = 0
for (const t of tests) {
  const out = mdToMarkdownV2(t.input)
  const ok = out === t.expect
  if (ok) { passed++; console.log('✅', t.name) }
  else { failed++; console.log('❌', t.name, '| out:', JSON.stringify(out), '| exp:', JSON.stringify(t.expect)) }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed')

// Full test case
console.log('\nFull test:')
const md = mdToMarkdownV2("**bold**\n_italic_\n[link](https://example.com)\n```ts\nconst x = 1\n```")
console.log('Has **bold**:', md.includes('**bold**'))
console.log('Has _italic_:**bold**_:**', md.includes('**bold**'))
console.log('Has [link](:', md.includes('[link]('))
console.log('Has ```ts:', md.includes('```ts'))
console.log('Has const x = 1:', md.includes('const x = 1'))
console.log('Output:', JSON.stringify(md))
