/**
 * Default prompts for Greeting Tools LLM generation features.
 * These can be customized via extension settings.
 */

import { translate } from '../../../i18n.js';

/** System prompt template for greeting title/description generation */
export const DEFAULT_GENERATE_SYSTEM_PROMPT = translate(`You are helping organize greeting messages for a character named '{{char}}'.

Your task is to generate a short, memorable **title** and a brief **description** for the following greeting message.

## Instructions
- The **title** should be 2-7 words, catchy and descriptive of the greeting's theme or mood, making it unique and recognizable between the other greetings
- The **description** should be 2-6 sentences summarizing the greeting, picking up what makes this unique
  - Add double linebreaks to split the description if needed, for better formatting
  - Be creative but accurate to the greeting's content
  - Keep the description precise and as a summary of the greeting
  - This is not a meta summary, but a direct description of the greeting content
  - **DO NOT** start with "This greeting..." or similar phrase
- Output **ONLY** the title and description in the exact format shown below

{{#if charDescription}}
## Character Description (for context)
{{charDescription}}

{{/if}}
{{#if charPersonality}}
## Character Personality
{{charPersonality}}

{{/if}}
{{#if scenario}}
## Scenario
{{scenario}}

{{/if}}
{{#if existingTitles}}
## Existing Greeting Titles (avoid identical or too similar names)
{{existingTitles}}

{{/if}}

## Required Output Format
You **MUST** respond with exactly this format, no other text:

\`\`\`title
[Your generated title here]
\`\`\`

\`\`\`description
[Your generated description here]
\`\`\``, 'DEFAULT_GENERATE_SYSTEM_PROMPT');

/** System prompt template for generating new greeting content */
export const DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT = translate(`You are writing a new opening greeting message for a roleplay character named '{{char}}'.

## Your Task
Write a compelling, immersive **first message** that establishes an interesting scenario or situation. This message should:
- Be written from {{char}}'s perspective (first person or third person narrative as appropriate)
- Set up an engaging scene, situation, or encounter
- Reflect the character's personality and speaking style
- Be detailed enough to give {{user}} something to respond to
- Include scene-setting, actions, dialogue, or inner thoughts as appropriate

{{#if charDescription}}
## Character Description
{{charDescription}}

{{/if}}
{{#if charPersonality}}
## Character Personality
{{charPersonality}}

{{/if}}
{{#if scenario}}
## Base Scenario
{{scenario}}

{{/if}}
{{#if existingTitles}}
## Existing Greeting Themes (try to create something different)
The following greetings already exist. Try to create a unique scenario that differs from these:
{{existingTitles}}

{{/if}}
{{#if customPrompt}}
## Special Instructions
The user has requested the following specific theme or scenario for this greeting:

{{customPrompt}}

Make sure to incorporate this into the greeting while staying true to the character.

{{/if}}
## Output Format
Write ONLY the greeting message itself. Do not include titles, labels, explanations, or meta-commentary.
Just write the actual greeting text that {{char}} would say/do to start a conversation or scene with {{user}}.`, 'DEFAULT_GENERATE_GREETING_SYSTEM_PROMPT');

/** Default prompt sent to LLM when generating a greeting WITH a custom theme */
export const DEFAULT_GENERATION_PROMPT_WITH_THEME = translate(`Generate a greeting for {{char}} with this theme:
{{customPrompt}}`, 'DEFAULT_GENERATION_PROMPT_WITH_THEME');

/** Default prompt sent to LLM when generating a greeting WITHOUT a custom theme */
export const DEFAULT_GENERATION_PROMPT_WITHOUT_THEME = translate('Generate a new greeting for {{char}} that differs from existing greetings.',
    'DEFAULT_GENERATION_PROMPT_WITHOUT_THEME');
