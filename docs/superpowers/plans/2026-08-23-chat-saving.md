# Chat Saving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to save ChatGPT and Gemini chats to Anytype by adding site-specific domain filtering for forms and a specialized "Chat Content" page property.

**Architecture:** Modifies popup UI state to hold target domains, filters forms on load, adds a background script message to extract chat DOM structure into markdown, and exposes this as a new WebPageProperty.

**Tech Stack:** JavaScript (Chrome Extension Manifest V3), HTML, CSS.

## Global Constraints

- No third-party libraries for chat extraction (use native DOM parsing).
- Adhere to the existing `WebPagePropierties` structure.

---

### Task 1: Add Properties and Localizations

**Files:**
- Modify: `save-to-anytype/popup.js`
- Modify: `save-to-anytype/localizations.json`

**Interfaces:**
- Produces: `WebPagePropierties` will have `page_chat_content` and localizations will have `page_chat_content` and `target_domains`.

- [ ] **Step 1: Modify `WebPagePropierties` in `popup.js`**

Add `{ id: "page_chat_content", nameKey: "page_chat_content", value: "" }` around line 673.

- [ ] **Step 2: Add to `localizations.json`**

In the English (`en`) section, add:
```json
"page_chat_content": "Chat Content",
"target_domains": "Target Domains (comma-separated, optional)",
"TargetDomainsInputPlaceholder": "chatgpt.com, gemini.google.com"
```
In the Russian (`ru`) section, add:
```json
"page_chat_content": "Содержимое чата",
"target_domains": "Показывать только на доменах (опционально)",
"TargetDomainsInputPlaceholder": "chatgpt.com, gemini.google.com"
```

- [ ] **Step 3: Commit**

```bash
git add save-to-anytype/popup.js save-to-anytype/localizations.json
git commit -m "feat: add page_chat_content property and localizations"
```

### Task 2: UI modifications for Domain Scoping

**Files:**
- Modify: `save-to-anytype/popup.html`
- Modify: `save-to-anytype/popup.js`

**Interfaces:**
- Consumes: `localizations.json` keys.
- Produces: `targetDomains` saved in the form object.

- [ ] **Step 1: Modify `popup.html`**

In the `<div id="createFormSection"` block, right before the `<div class="section-title" id="SelectCollectionPrintedSaveToAnytype_SOT">`, add:
```html
<div class="section-title" id="target_domains">Target Domains (comma-separated, optional)</div>
<input type="text" id="targetDomainsInput" class="input-modern" placeholder="chatgpt.com, gemini.google.com">
```

- [ ] **Step 2: Wire up UI elements in `popup.js`**

At the top of `popup.js` in the `elements` object (around line 70), add:
```javascript
targetDomainsInput: document.getElementById('targetDomainsInput'),
targetDomainsLabel: document.getElementById('target_domains'),
```

In `document.addEventListener('DOMContentLoaded', ...)` where localization happens, add:
```javascript
if (elements.targetDomainsLabel) elements.targetDomainsLabel.innerText = Localize('target_domains', state.language);
if (elements.targetDomainsInput) elements.targetDomainsInput.placeholder = Localize('TargetDomainsInputPlaceholder', state.language);
```

- [ ] **Step 3: Save `targetDomains` to Form object**

In `elements.saveFormBtn.addEventListener('click', ...)` (around line 1530) when creating `const form = { ... }`, add:
```javascript
targetDomains: elements.targetDomainsInput?.value.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0) || []
```

In `showCreateFormSection()`, clear it:
```javascript
if (elements.targetDomainsInput) elements.targetDomainsInput.value = '';
```

- [ ] **Step 4: Commit**

```bash
git add save-to-anytype/popup.html save-to-anytype/popup.js
git commit -m "feat: add domain scoping UI and form state"
```

### Task 3: Form Rendering Filter

**Files:**
- Modify: `save-to-anytype/popup.js`

**Interfaces:**
- Consumes: `form.targetDomains` from state.

- [ ] **Step 1: Filter in `LoadFormsForMainSection()`**

Inside the loop where forms are iterated (around `state.forms.forEach((form) => { ... }` inside `LoadFormsForMainSection`), add the filtering logic early:
```javascript
const [tab] = chromeTABS || [];
const currentHostname = (tab && tab.url) ? new URL(tab.url).hostname.toLowerCase() : "";

if (form.targetDomains && form.targetDomains.length > 0) {
    const isMatch = form.targetDomains.some(domain => currentHostname.includes(domain));
    if (!isMatch) {
        return; // skip rendering this form
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add save-to-anytype/popup.js
git commit -m "feat: filter rendered forms by domain"
```

### Task 4: Chat Extraction Logic

**Files:**
- Modify: `save-to-anytype/background.js`
- Modify: `save-to-anytype/popup.js`

**Interfaces:**
- Consumes: Background message passing.
- Produces: `page_chat_content` value in `WebPagePropierties`.

- [ ] **Step 1: Background script extraction**

In `save-to-anytype/background.js`, add the extraction function:
```javascript
function extractChatText() {
    try {
        const hostname = window.location.hostname.toLowerCase();
        let markdown = "";
        
        if (hostname.includes("chatgpt.com")) {
            const messages = document.querySelectorAll('[data-message-author-role]');
            messages.forEach(msg => {
                const role = msg.getAttribute('data-message-author-role');
                const text = msg.innerText;
                markdown += `**${role.charAt(0).toUpperCase() + role.slice(1)}:**\n${text}\n\n`;
            });
        } else if (hostname.includes("gemini.google.com")) {
            const userQueries = document.querySelectorAll('user-query');
            const modelResponses = document.querySelectorAll('model-response');
            const maxLen = Math.max(userQueries.length, modelResponses.length);
            for (let i = 0; i < maxLen; i++) {
                if (userQueries[i]) markdown += `**User:**\n${userQueries[i].innerText}\n\n`;
                if (modelResponses[i]) markdown += `**Assistant:**\n${modelResponses[i].innerText}\n\n`;
            }
        }
        
        return markdown || "";
    } catch (error) {
        console.error("Chat Extraction Error: ", error);
        return "";
    }
}
```

Also in `background.js`, add the message listener (next to `executeScript_extractPageText` block):
```javascript
if (request.action === "executeScript_extractChatText") {
    chrome.scripting.executeScript(
        {
            target: request.target,
            func: extractChatText
        },
        (result) => {
            sendResponse(result);
        }
    );
    return true;
}
```

- [ ] **Step 2: Request extraction from `popup.js`**

In `save-to-anytype/popup.js`, where it populates `WebPagePropierties` (inside `try { ... const [tab] = chromeTABS; ... }` block, right after setting `page_content`), add:
```javascript
const resultExtractChatText = await chrome.runtime.sendMessage({
    action: "executeScript_extractChatText",
    target: { tabId: tab.id },
});
const chatMarkdown = resultExtractChatText?.[0]?.result || "";
WebPagePropierties.find(p => p.id == "page_chat_content").value = chatMarkdown;
```

- [ ] **Step 3: Commit**

```bash
git add save-to-anytype/background.js save-to-anytype/popup.js
git commit -m "feat: extract ChatGPT and Gemini chat content"
```
