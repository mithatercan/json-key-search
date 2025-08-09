const vscode = require('vscode')

function activate(context) {
  // Utility functions
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

    // Traverse each part of the path
    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i].trim()
      if (!segment) continue

      // Create regex to find the key within current region
      const keyRegex = new RegExp(`(?:"${escapeRegex(segment)}"|\\b${escapeRegex(segment)}\\b)\\s*:\\s*`, 'g')
      const slice = text.slice(regionStart, regionEnd)

      // Find the key in current region
      keyRegex.lastIndex = 0 // Reset regex state
      const match = keyRegex.exec(slice)
      if (!match) {
        return null // Key not found
      }

      // Calculate absolute position of value start
      valueStartIdx = trimLeftWs(text, regionStart + match.index + match[0].length)

      // If not the last segment, we need to narrow down to this object/array
      if (i < parts.length - 1) {
        const ch = text[valueStartIdx]
        if (ch !== '{' && ch !== '[') {
          return null // Expected object or array but found primitive
        }

        const containerEnd = findMatchingBracket(text, valueStartIdx)
        if (containerEnd === -1) {
          return null // Unbalanced brackets
        }

        // Narrow the search region to inside this container
        regionStart = valueStartIdx + 1
        regionEnd = containerEnd
      }
    }

    // Determine selection bounds based on value type
    const firstChar = text[valueStartIdx]
    if (firstChar === '"') {
      // String value - select content inside quotes
      const endQuote = findStringEnd(text, valueStartIdx)
      if (endQuote === -1) return null
      return { start: valueStartIdx + 1, end: endQuote }
    } else if (firstChar === '{' || firstChar === '[') {
      // Object or array - select entire structure
      const endIdx = findMatchingBracket(text, valueStartIdx)
      if (endIdx === -1) return null
      return { start: valueStartIdx, end: endIdx + 1 }
    } else {
      // Primitive value (number, boolean, null) - select until delimiter
      let i = valueStartIdx
      while (i < text.length && !/[\s,}\]]/.test(text[i])) i++
      return { start: valueStartIdx, end: i }
    }
  }

  // Regular search command
  let disposable = vscode.commands.registerCommand('extension.searchJsonKey', async function () {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found')
      return
    }

    const input = await vscode.window.showInputBox({
      prompt: 'Enter dot notation path (e.g., page.inventory.definitions.product.action_type.title)',
      placeHolder: 'a.b.c.d...',
    })

    if (!input) return

    const text = editor.document.getText()
    const selection = computeSelectionForPath(text, input.trim())

    if (!selection) {
      vscode.window.showInformationMessage(`No match found for path: ${input}`)
      return
    }

    const startPos = editor.document.positionAt(selection.start)
    const endPos = editor.document.positionAt(selection.end)
    editor.selection = new vscode.Selection(startPos, endPos)
    editor.revealRange(new vscode.Range(startPos, endPos))

    vscode.window.showInformationMessage(`Found and selected: ${input}`)
  })

  // Live search command
  const liveDisposable = vscode.commands.registerCommand('extension.searchJsonKeyLive', async function () {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found')
      return
    }

    const run = value => {
      const text = editor.document.getText()
      const selection = computeSelectionForPath(text, value.trim())

      if (!selection) return

      const startPos = editor.document.positionAt(selection.start)
      const endPos = editor.document.positionAt(selection.end)
      editor.selection = new vscode.Selection(startPos, endPos)
      editor.revealRange(new vscode.Range(startPos, endPos))
    }

    const inputBox = vscode.window.createInputBox()
    inputBox.title = 'Search JSON key (live updates)'
    inputBox.placeholder = 'e.g., page.inventory.definitions.product.action_type.title'
    inputBox.ignoreFocusOut = false

    let timer
    inputBox.onDidChangeValue(value => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => run(value), 150) // Slightly longer delay for better performance
    })

    inputBox.onDidAccept(() => {
      if (timer) clearTimeout(timer)
      run(inputBox.value)
      inputBox.hide()
    })

    inputBox.onDidHide(() => {
      if (timer) clearTimeout(timer)
      inputBox.dispose()
    })

    inputBox.show()
  })

  context.subscriptions.push(disposable, liveDisposable)
}

function deactivate() {}

module.exports = { activate, deactivate }
