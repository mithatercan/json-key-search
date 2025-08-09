const vscode = require('vscode')

function activate(context) {
  let disposable = vscode.commands.registerCommand('extension.searchJsonKey', async function () {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const input = await vscode.window.showInputBox({
      prompt: 'Enter dot notation (e.g., a.b.c.d)',
    })

    if (!input) return

    const pathArray = input.split('.')
    const text = editor.document.getText()

    const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Allow strings, numbers (int/float/exponent), booleans, null, objects, arrays
    const stringPattern = '"(?:\\\\.|[^"\\\\])*"'
    const numberPattern = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'
    const valuePattern = `({|\\[|${stringPattern}|${numberPattern}|true|false|null)`

    const parts = pathArray.map(segment => {
      const key = escapeRegex(segment)
      // Match either quoted or unquoted JS identifier keys, followed by a colon and a value
      return `(?:"${key}"|\\b${key}\\b)\\s*:\\s*${valuePattern}`
    })

    const regex = parts.join('[\\s\\S]*?')
    const matches = [...text.matchAll(new RegExp(regex, 'g'))]

    if (matches.length === 0) {
      vscode.window.showInformationMessage('No matches found')
      return
    }
    const matched = matches[0][0]
    const matchStart = text.indexOf(matched)
    const matchEnd = matchStart + matched.length
    const lastKey = pathArray[pathArray.length - 1]
    const keyHeaderRe = new RegExp(`(?:"${escapeRegex(lastKey)}"|\\b${escapeRegex(lastKey)}\\b)\\s*:\\s*`)
    const headerMatch = keyHeaderRe.exec(text.slice(matchStart, matchEnd))
    if (!headerMatch) {
      vscode.window.showInformationMessage('No matches found')
      return
    }
    let valueStartIdx = matchStart + headerMatch.index + headerMatch[0].length
    while (valueStartIdx < text.length && /\s/.test(text[valueStartIdx])) valueStartIdx++
    const findStringEnd = startQuoteIdx => {
      let i = startQuoteIdx + 1
      while (i < text.length) {
        const ch = text[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '"') return i
        i++
      }
      return -1
    }
    const findMatchingBracket = startIdx => {
      const open = text[startIdx]
      const close = open === '{' ? '}' : ']'
      let depth = 1
      let i = startIdx + 1
      let inString = false
      while (i < text.length) {
        const ch = text[i]
        if (inString) {
          if (ch === '\\') {
            i += 2
            continue
          }
          if (ch === '"') {
            inString = false
            i++
            continue
          }
          i++
          continue
        }
        if (ch === '"') {
          inString = true
          i++
          continue
        }
        if (ch === open) {
          depth++
          i++
          continue
        }
        if (ch === close) {
          depth--
          if (depth === 0) return i
          i++
          continue
        }
        i++
      }
      return -1
    }
    {
      const trimLeftWs = idx => {
        while (idx < text.length && /\s/.test(text[idx])) idx++
        return idx
      }
      let regionStart = 0
      let regionEnd = text.length
      valueStartIdx = -1
      for (let i = 0; i < pathArray.length; i++) {
        const segment = pathArray[i]
        const keyRegex = new RegExp(`(?:\"${escapeRegex(segment)}\"|\\b${escapeRegex(segment)}\\b)\\s*:\\s*`, 'g')
        const slice = text.slice(regionStart, regionEnd)
        const match = keyRegex.exec(slice)
        if (!match) {
          vscode.window.showInformationMessage('No matches found')
          return
        }
        valueStartIdx = trimLeftWs(regionStart + match.index + match[0].length)
        if (i < pathArray.length - 1) {
          const ch = text[valueStartIdx]
          if (ch !== '{' && ch !== '[') {
            vscode.window.showInformationMessage('No matches found')
            return
          }
          const containerEnd = findMatchingBracket(valueStartIdx)
          if (containerEnd === -1) {
            vscode.window.showInformationMessage('Unbalanced braces/brackets while searching')
            return
          }
          regionStart = valueStartIdx + 1
          regionEnd = containerEnd
        }
      }
    }
    const firstChar = text[valueStartIdx]
    let selectStart = valueStartIdx
    let selectEnd = valueStartIdx
    if (firstChar === '"') {
      const endQuote = findStringEnd(valueStartIdx)
      if (endQuote === -1) {
        vscode.window.showInformationMessage('Unterminated string for value')
        return
      }
      selectStart = valueStartIdx + 1
      selectEnd = endQuote
    } else if (firstChar === '{' || firstChar === '[') {
      const endIdx = findMatchingBracket(valueStartIdx)
      if (endIdx === -1) {
        vscode.window.showInformationMessage('Unbalanced braces/brackets for value')
        return
      }
      selectStart = valueStartIdx
      selectEnd = endIdx + 1
    } else {
      let i = valueStartIdx
      while (i < text.length && !/[\s,}\]]/.test(text[i])) i++
      selectStart = valueStartIdx
      selectEnd = i
    }
    const startPos = editor.document.positionAt(selectStart)
    const endPos = editor.document.positionAt(selectEnd)
    editor.selection = new vscode.Selection(startPos, endPos)
    editor.revealRange(new vscode.Range(startPos, endPos))
  })

  // Live search command: updates selection on each keystroke
  const liveDisposable = vscode.commands.registerCommand('extension.searchJsonKeyLive', async function () {
    const editor = vscode.window.activeTextEditor
    if (!editor) return

    const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const trimLeftWs = (text, idx) => {
      while (idx < text.length && /\s/.test(text[idx])) idx++
      return idx
    }
    const findStringEnd = (text, startQuoteIdx) => {
      let i = startQuoteIdx + 1
      while (i < text.length) {
        const ch = text[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '"') return i
        i++
      }
      return -1
    }
    const findMatchingBracket = (text, startIdx) => {
      const open = text[startIdx]
      const close = open === '{' ? '}' : ']'
      let depth = 1
      let i = startIdx + 1
      let inString = false
      while (i < text.length) {
        const ch = text[i]
        if (inString) {
          if (ch === '\\') {
            i += 2
            continue
          }
          if (ch === '"') {
            inString = false
            i++
            continue
          }
          i++
          continue
        }
        if (ch === '"') {
          inString = true
          i++
          continue
        }
        if (ch === open) {
          depth++
          i++
          continue
        }
        if (ch === close) {
          depth--
          if (depth === 0) return i
          i++
          continue
        }
        i++
      }
      return -1
    }
    const computeSelectionForPath = (text, dotPath) => {
      if (!dotPath) return null
      const parts = dotPath.split('.')
      let regionStart = 0
      let regionEnd = text.length
      let valueStartIdx = -1
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i]
        const keyRe = new RegExp(`(?:\"${escapeRegex(seg)}\"|\\b${escapeRegex(seg)}\\b)\\s*:\\s*`, 'g')
        const slice = text.slice(regionStart, regionEnd)
        const m = keyRe.exec(slice)
        if (!m) return null
        valueStartIdx = trimLeftWs(text, regionStart + m.index + m[0].length)
        if (i < parts.length - 1) {
          const ch = text[valueStartIdx]
          if (ch !== '{' && ch !== '[') return null
          const endIdx = findMatchingBracket(text, valueStartIdx)
          if (endIdx === -1) return null
          regionStart = valueStartIdx + 1
          regionEnd = endIdx
        }
      }
      const first = text[valueStartIdx]
      if (first === '"') {
        const endQ = findStringEnd(text, valueStartIdx)
        if (endQ === -1) return null
        return { start: valueStartIdx + 1, end: endQ }
      }
      if (first === '{' || first === '[') {
        const end = findMatchingBracket(text, valueStartIdx)
        if (end === -1) return null
        return { start: valueStartIdx, end: end + 1 }
      }
      let i = valueStartIdx
      while (i < text.length && !/[\s,}\]]/.test(text[i])) i++
      return { start: valueStartIdx, end: i }
    }

    const run = val => {
      const text = editor.document.getText()
      const sel = computeSelectionForPath(text, val.trim())
      if (!sel) return
      const startPos = editor.document.positionAt(sel.start)
      const endPos = editor.document.positionAt(sel.end)
      editor.selection = new vscode.Selection(startPos, endPos)
      editor.revealRange(new vscode.Range(startPos, endPos))
    }

    const inputBox = vscode.window.createInputBox()
    inputBox.title = 'Search JSON key (live)'
    inputBox.placeholder = 'e.g., messages.errors.no_permission'
    inputBox.ignoreFocusOut = false
    let timer
    inputBox.onDidChangeValue(val => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => run(val), 120)
    })
    inputBox.onDidAccept(() => {
      if (timer) clearTimeout(timer)
      run(inputBox.value)
      inputBox.hide()
    })
    inputBox.onDidHide(() => inputBox.dispose())
    inputBox.show()
  })

  context.subscriptions.push(disposable, liveDisposable)
}

function deactivate() {}

module.exports = { activate, deactivate }
