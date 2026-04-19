-- 4-window Food/Bev lab (Terminal.app): workspace, Codex, Gemini, Claude — use when iTerm2 is not installed.
-- Usage: osascript scripts/terminal-food-bev-lab.applescript "$ROOT" "$CMD_CODEX" "$CMD_GEMINI" "$CMD_CLAUDE"

on run argv
	if (count of argv) < 4 then
		error "Need 4 args: ROOT CODEX_CMD GEMINI_CMD CLAUDE_CMD"
	end if
	set root to item 1 of argv
	set cmdCodex to item 2 of argv
	set cmdGemini to item 3 of argv
	set cmdClaude to item 4 of argv

	tell application "Terminal"
		activate
		do script "cd " & quoted form of root & " && printf '\\n\\n=== Window 1 · Workspace · F&B datasheets & scheduling ===\\n\\n' && exec zsh -l"
		do script "cd " & quoted form of root & " && clear && printf '\\n=== Window 2 · Codex ===\\n\\n' && " & cmdCodex
		do script "cd " & quoted form of root & " && clear && printf '\\n=== Window 3 · Gemini ===\\n\\n' && " & cmdGemini
		do script "cd " & quoted form of root & " && clear && printf '\\n=== Window 4 · Claude ===\\n\\n' && " & cmdClaude
	end tell
end run
