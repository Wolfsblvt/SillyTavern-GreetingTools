# SillyTavern Greeting Tools [Extension]

[![extension version](https://img.shields.io/badge/dynamic/json?color=blue&label=extension%20version&query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2FWolfsblvt%2FSillyTavern-GreetingTools%2Fmain%2Fmanifest.json)](https://github.com/Wolfsblvt/SillyTavern-GreetingTools/)
[![release version](https://img.shields.io/github/release/Wolfsblvt/SillyTavern-GreetingTools?color=lightblue&label=release)](https://github.com/Wolfsblvt/SillyTavern-GreetingTools/releases/latest)
[![required ST version](https://img.shields.io/badge/required%20ST%20version-staging-darkred?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABRFBMVEVHcEyEGxubFhafFRWfFRWeFBSaFhaWFRWfFRWfFRWOFhaeFRWeFBSeFBSfFRWfFRWdFRWbFBSfFBSfFBSdFRWeExOfFBSfFRWdFBSfFRWfFRWfGxudFRWeFBSTFRWeFRWeFRWfFRWcFhaeFRWfFRWeFRWfFRWfFRWeFRWeFRWeFRWgFBSgFRWfFRWfFRWgFRX26ur4+Pj9+/ugFBT9/v6fFRWtOzueFRWeFRWgFRX///+fFRX6+/vXo6OfFBSrODj6/PzIenr28PD+/f2gFRX06ur17e3dr6+rMzPTlJS5VVW+ZGT9/v7y39/y6OioMTHx//+1Skrrz8+qMDD7+/v7/Pzq0tLkvb22UVHHe3v4+Pi3WFjIgoL4+PjNjIy5XFyuQEDmzMzZpKThubn8/Py+YWHz8/P8/Pz9//+gFRX////36+tJcu2kAAAAaXRSTlMAARDDqIkMB8qyAzqXUrnQGROErSmd1o41pL4iL2oFTFiTHYt5ccZ1PF1G6ONj2/z1gv1n32CkQz/t7ceYYH+KqdZT5fSoY+XbwLSH1u8elxi8+OmeqJ78nTmbXBds8WlWNc+EwcovuYtEjPKpAAACkklEQVQ4y3VTZXfbQBBcwYlZlmSRLdmWmRpwqGFOw1BmPvf/f+/JeU3ipr0Pp/d2VzszO7cAJfj/oXiAxK5xFEU9TkoSxa1pLejggcayrMVNp2lk26w2wEvg4iUry7IATUGVPG12tlfrYB2iWjmPFJjGAxiqwYT5dyEr3MVkoUWZhgTAF0K+JRQfkyrrvhYoYcTWGVEvT/EpF/PudIAKBRTU18LQYswcR1bNiRxv0JXzDjYRzWsiIcuzKgk0OzglkMDVMW4QDiteXu5VJ7dLMBoYMxPxLV0QUk9zRK6SAEIwX+FEL0hTgRGSW00mXXY6Ce8oaw5UETiWokhqN21z9D3RUDMKH0dXo/Ozs/PRwfqbV5UgnNKodtHmydxwOPf+Mr+HJy87rT8ie5kBoLhXw/HXm5uNzf2N4/Hcxu6B6wAYtZiGxgBryNOdi+Xl70ABqsKT8WsKqr7rpAwe1ABhLCDPjT9sj39cX/88QqTgqRm1Yx1ZZAAWhKlPDElZ9vP28szM+HI9L1ADUbSIg061QlTmc252Z+nTTxer27+e5QW82evmdt0bLItvt7a2vn1ZnhTsloAXF++8pznVsu3T4xlyxi/Wqefj/UyibNFSOZq0oGKdERR/JVzd3Ht3eDhC8dHeqhZVGEcRGD2mwHAxbkEJ2Y4CUCmiapHw8lg2IyZh7BrA2bhPZHCJ6OeUFD+HVZRFYnShj21ip5FEEy4VTS1JbUZQeV71b22KEuOBHZzYZ1mx3WRZ3/X/sU2SFRTbbfIHXYyK9YdPnF+cPMlYiO5jTT33UpKbeadspxPLcqwvTNmvz8tyY2mnR+bAYtxnmHoyjdhbYZguxspkHwKZNum/1pcioYW6MJm3Yf5v+02S+Q13BVQ4NCDLNAAAAABJRU5ErkJggg==)](https://github.com/SillyTavern/SillyTavern/tree/staging)

A complete overhaul of greeting management in SillyTavern. Organize your character greetings with titles, descriptions, and AI-powered generation - all from a redesigned popup and an inline chat selector.

This extension replaces the default "Alternate Greetings" button and popup with a much more powerful **Greeting Tools** experience. Give every greeting a name, find the one you want instantly, generate new ones with your LLM, and switch between them directly in the chat.

> [!IMPORTANT]
> This extension requires the **staging** branch of SillyTavern.

> [!NOTE]
> This extension requires the **[Experimental Macro Engine](https://docs.sillytavern.app/usage/core-concepts/macros/#macros)** to be enabled.

## Installation

Install using SillyTavern's extension installer from the URL:

```txt
https://github.com/Wolfsblvt/SillyTavern-GreetingTools
```

## Features

### Greeting Tools Popup

The extension replaces the built-in "Alternate Greetings" button on the character panel with a **Greeting Tools** button, which includes a count of the total greetings.

Clicking it opens the Greeting Tools popup, which gives you a full overview and editor for all of your character's greetings in one place.

- **Titles and descriptions** — Give each greeting a custom title and an optional description. This makes it easy to tell your greetings apart at a glance, especially when a character has many of them or they are very long.
- **Edit greeting content** — The full greeting text is editable right in the popup. Each greeting can be expanded or collapsed individually, and there's a maximize button to open a greeting in a full-screen editor.
- **Reorder greetings** — Move greetings up and down with the arrow buttons. You can even swap an alternate greeting with the main greeting.
- **Add and delete greetings** — Add new blank greetings or delete ones you no longer need, with a confirmation prompt to prevent accidents.
- **Collapse / Expand all** — Toolbar buttons to quickly collapse or expand every greeting at once.
- **Keyboard navigation** — Use Arrow Up/Down to navigate between greeting blocks. Hold Ctrl+Arrow while inside a textarea to jump to the next greeting.

<img width="559" height="456" alt="Screenshot of the Greeting Tools popup showing the main greeting and a few alternate greetings with titles" src="https://github.com/user-attachments/assets/50919d4d-e535-4f27-b3a1-d87571353107" />

### Inline Greeting Selector (Chat Widget)

When a chat starts with a character greeting, an inline **greeting selector** widget appears directly above the first message.

- **See which greeting is active** — The widget shows the current greeting's title and description right in the chat, so you always know which greeting you're looking at.
- **Switch greetings from the chat** — Click the shuffle button to open a searchable dropdown of all available greetings. The dropdown supports **fuzzy search** across titles, descriptions, and even greeting content, so you can find the right one fast.
- **Swipe counter** — Shows the current position (e.g., *2 / 5*) so you know where you are among the available greetings.
- **Jump to the editor** — The pencil button opens the Greeting Tools popup and highlights the currently active greeting.
- **Only when changeable** — The selector buttons are only interactive when the chat has exactly one message (the greeting). Once the conversation continues, it switches to a read-only display.

![GIF of the greeting selector widget in the chat, showing the title, description and action buttons; opening the selector and searching for a new greeting to navigate to](https://github.com/user-attachments/assets/4ffcdd80-d01a-4e0b-9db4-45b58db51265)

### AI-Powered Title & Description (Auto-Fill)

Don't want to come up with titles yourself? Let the LLM do it.

- **Auto-fill button** (wand icon on each greeting, or wand button in edit popup) — Sends the greeting content to your LLM and generates a short, catchy title and a brief description automatically.
- **Smart fill behavior** — If a title or description already exists, the extension asks before overwriting and shows a before/after preview so you can decide.
- **Edit title popup** — Click the pencil icon on any greeting to manually edit its title and description. The Auto-Fill button is also available inside this popup.
- **Context-aware** — The LLM receives existing greeting titles so it can generate names that are distinct and don't overlap.

![GIF of the auto-fill wand button and the generated title/description appearing](https://github.com/user-attachments/assets/0716ec32-46e2-447c-b995-09fc3a297b73)

### AI-Powered Greeting Generation

Generate entirely new greeting messages using your LLM, directly from the popup or from the chat.

- **Generate from the popup** — Click **"Generate New Greeting"** in the toolbar. You'll be asked for an optional theme or scenario (e.g., *"A rainy day at a café"*). Leave it empty for a general new greeting based on the character.
- **Title & description included** — A checkbox (on by default) lets you also generate a title and description alongside the greeting content in a single flow.
- **Character-aware** — The generation prompt includes the character's description, personality, and scenario, so the output matches the character's style.
- **Diverse results** — Existing greeting titles are sent as context so the LLM avoids creating something too similar to what already exists.
- **Automatic macro replacement** — By default, character and user names in the generated text are replaced with `{{char}}` and `{{user}}` macros, keeping your greetings portable. This can be toggled off in settings. (Changeable via [settings](#settings))

<img width="336" height="182" alt="Screenshot of the 'Generate New Greeting' popup with the theme input and checkbox" src="https://github.com/user-attachments/assets/7bff6156-ddc1-401f-9368-6d5c8c481384" />

### Temporary Greetings

Generate a greeting on-the-fly without permanently adding it to the character.

- **Generate temporary greeting** — From the greeting selector widget in the chat, click the wand icon. You'll get the same generation popup, and the result is added as a new swipe on the first message.
- **Marked as `TEMP`** — Temporary greetings are clearly tagged with a `TEMP` marker in both the selector and the popup, so you won't confuse them with saved greetings.
- **Try before you save** — Browse the temporary greeting in the chat to see how it reads. If you like it, click the save button (floppy disk icon) to permanently add it as an alternate greeting. If not, just discard it.
- **Persisted per chat** — Temporary greetings are stored in the chat metadata, so they survive a page refresh within the same chat session. They don't affect the character card itself until you save them.

<img width="403" height="148" alt="Screenshot of temporary greetings in the popup with the TEMP marker, and the save/discard buttons" src="https://github.com/user-attachments/assets/902a01b1-6407-4d60-a33d-b56113c7e786" />

### Settings

Access the extension settings under **Extensions → Greeting Tools** in SillyTavern's settings panel.

- **Collapse greetings by default** — When enabled, greeting blocks in the popup start collapsed instead of expanded. Useful if you have many greetings and prefer a compact overview, or if you only want to see the descriptions.
- **Replace names with macros in generated greetings** — When enabled (default), the extension automatically replaces the character's and user's names with `{{char}}` and `{{user}}` in any LLM-generated greeting text.
- **Customizable prompt templates** — Expand the *Greeting Tool Prompt Templates* drawer to fully customize the prompts sent to the LLM:
  - **Title/Description Generation** — The system prompt used when auto-filling titles and descriptions.
  - **Greeting Generation** — The system prompt used when generating new greeting content.
  - **Greeting Base (with theme)** — The user prompt sent to the LLM when a custom theme/scenario is provided.
  - **Greeting Base (without theme)** — The user prompt sent to the LLM when no theme is provided.
  - Each prompt has a **Reset to default** button to restore the built-in prompt.
  - Any macros will be replaced as usual in prompts, before sending to the LLM.
  - Available dynamic macros are documented directly in the settings UI (e.g., `{{existingTitles}}`, `{{customPrompt}}`).

### How Greeting Data is Stored

- **Titles, descriptions, and ID mappings** are stored in the character's extension data (`data.extensions.greeting_tools`). This means they persist with the character card and survive exports/imports.
- **Temporary greetings** are stored in the chat metadata and are tied to a specific chat session.
- The extension never modifies greetings that already exist — it only adds its own metadata layer on top.

## Roadmap

This is the roadmap of planned or suggested features that might make it into a future release.

- [x] Allow secondary connection via optional 'Connection Profile' that can be chosen (plus slash command)
- [ ] "Greeting Length" setting, instead of having to manually edit prompt
- [ ] Batch auto-fill titles for all greetings at once
- [ ] Stream generation of title/description if possible - also show thinking
- [ ] Uninstall hook with (optional) removal of any greeting data (including stored in character metadata)
- [ ] Slash commands to manage greetings, titles and descriptions
- [ ] Greeting usage statistics (which greeting was used how often)

## ToDo List

This list mostly functions as a personal reminder of what still needs to be done.

- [x] Greeting Tools popup replacing the default alternate greetings editor
- [x] Inline greeting selector widget in chat
- [x] Fuzzy search in greeting selector dropdown
- [x] Titles and descriptions for each greeting
- [x] LLM auto-fill for titles and descriptions
- [x] LLM-powered greeting generation (with optional theme)
- [x] Temporary greetings (generate, preview, save/discard)
- [x] Customizable prompt templates
- [x] Check if experimental macro engine is enabled, and warn/prompt otherwise
- [ ] Add init/success state of extension, so functions only "work" if the extension was initialized successfully
- [x] Make temp greeting title/desc editable and generateable
- [x] Refactoring / code cleanup (move functions, rename scripts, for separation of concerns) + Move most scripts into subfolder (keeping main repo page clean)
- [x] "Replace names with macros" button in the popup for manual replacing
- [x] "Expand" button in the in-chat widget to see full description
- [ ] Store extension version in extension metadata - on update check/ask if default prompts should be updated

## License

AGPL-3.0

## Contribution

- Discord: `@Wolfsblvt`
- Issues and pull requests are welcome.
- Any features/fixes should be pushed to the `dev` branch.
