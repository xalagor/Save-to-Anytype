# Design: Site-Specific Forms and Chat Extraction

## Objective
Enhance the Save-to-Anytype extension to support saving chat conversations from ChatGPT and Gemini. Introduce the ability to scope specific forms to execute only on designated domains.

## Architecture & Data Changes
1. **Form State Extension**: Forms in `state.forms` will now include an optional `targetDomains` property (an array of strings or a comma-separated string).
2. **WebPageProperties**: Add a new property `page_chat_content` alongside existing properties like `page_content`.

## UI Modifications (popup.html / popup.js)
1. **Form Creation**:
   - Add a new text input field labeled "Target Domains (comma-separated, optional)".
   - When a form is saved, capture this input, parse it into an array of lowercased domains (e.g., `["chatgpt.com", "gemini.google.com"]`), and save it to the form object.
2. **Form Rendering**:
   - In `LoadFormsForMainSection()`, check the current `tab.url`. If a form has a non-empty `targetDomains` array, ensure the current tab's hostname (or full URL) matches at least one of the target domains using a substring match. If it does not match, the form is excluded from the list shown to the user.
3. **Localization**:
   - Add localization keys for the new "Target Domains" input label, input placeholder, and the "Chat Content" source.

## Extraction Logic (background.js / extractors)
1. **Messaging**:
   - When `popup.js` initializes and gathers data from the active tab, it will dispatch a new background action `executeScript_extractChatText` (similar to `executeScript_extractPageText`).
2. **Extraction Script**:
   - A new extraction function injected by `background.js`.
   - The script determines the current domain:
     - **chatgpt.com**: Selects message containers (e.g., `[data-message-author-role]`), iterates through them, formats as `**User:** ...` or `**ChatGPT:** ...`, and aggregates them as Markdown.
     - **gemini.google.com**: Selects user queries and model responses using their specific tags/classes, formatting them similarly.
   - If the site is unrecognized, it falls back to standard text or returns an empty string/warning.
3. **Data Population**:
   - The extracted chat markdown is assigned to the `page_chat_content` property of `WebPagePropierties`, allowing users to map it to any Anytype block/field.
