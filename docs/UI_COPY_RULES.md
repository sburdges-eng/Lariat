# USER-FACING LANGUAGE RULES

This app is for line cooks and kitchen staff during active shifts.
Write all user-facing text for speed, clarity, and low reading burden.
Do NOT use developer, startup, SaaS, enterprise, or abstract product language.

## GOAL
- Make every screen understandable in under 2 seconds
- Use kitchen-native wording
- Prefer short labels over descriptive paragraphs
- Assume the user is busy, stressed, distracted, and not technical

## READING LEVEL
- Target roughly 5th-8th grade reading level
- Use short sentences
- Use common words
- Avoid multi-clause instructions
- Avoid jargon unless it is kitchen jargon

## USE KITCHEN TERMS
Prefer words like:
- prep
- line
- par
- 86
- fire
- hold
- open
- close
- count
- low
- ready
- done
- need
- out
- rush
- clean
- check

## AVOID SOFTWARE TERMS
Never use these in user-facing copy unless absolutely required:
- workflow
- optimize
- configure
- dashboard
- analytics
- inventory management
- synchronization
- initiate
- execute
- module
- interface
- authenticate
- settings panel
- submit
- generate
- user
- error occurred
- validation failed

## PREFERRED REPLACEMENTS
- dashboard -> home
- submit -> save
- create task -> add prep
- inventory -> stock
- item availability -> in stock / out
- low inventory -> running low
- complete -> done
- issue -> problem
- report incident -> report problem
- open checklist -> open side work
- assign -> give to
- overdue -> late
- quantity -> count
- confirm -> yes / done
- cancel -> go back

## DESIGN RULES
- One main action per screen
- No paragraph-length instructions
- No hidden critical actions in menus
- Important buttons must use text labels, not icons only
- Buttons should use obvious verbs: Start, Done, Need, Out, Clean, Count
- Show status with plain words: Ready, Waiting, Low, Out, Done

## COPY STYLE
- Sound like a kitchen manager talking clearly, not a software company
- Be direct, brief, and practical
- Avoid sounding corporate, cheerful, or technical
- Never explain obvious things unless safety or mistakes are involved

## CODE RULE
- Internal variable/class names may remain technical and structured
- These language restrictions apply to UI labels, button text, alerts, onboarding, placeholders, and help text

## SELF-CHECK BEFORE RETURNING UI COPY
For every user-facing phrase, ask:
1. Would a line cook say this out loud?
2. Is this shorter than the current version?
3. Does this sound like kitchen language, not app language?
4. Can it be understood instantly while under pressure?
If not, rewrite it.
