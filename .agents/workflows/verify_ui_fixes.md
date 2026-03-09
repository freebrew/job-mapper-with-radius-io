---
description: How to verify UI fixes before handing off to the user
---

# UI Verification Protocol

## Mandatory Browser Verification
Before concluding any task that involves modifying existing UI components, styling, or frontend client logic (e.g., React, Vue, Vanilla JS, HTML), the Agent MUST:
1. Launch the `browser_subagent` tool on the local development server (e.g., `http://localhost:5173`).
2. Instruct the subagent to actively interact with the modified elements (click buttons, type in inputs, open modals).
3. Explicitly ask the subagent to report any `Console Errors` or `Network 4xx/5xx Errors`.
4. Only notify the user of task completion **AFTER** the subagent confirms the UI change works visually and functionally without breaking background processes. 
5. If the subagent finds a defect, the Agent must fix it and re-verify again until clean.

This ensures no code is handed off blindly.
