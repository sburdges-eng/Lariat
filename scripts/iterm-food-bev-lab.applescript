-- 4-tab Food/Bev + scheduling lab: workspace shell, Codex, Gemini, Claude (parallel CLIs).
-- Usage: osascript scripts/iterm-food-bev-lab.applescript "$ROOT" "$CMD_CODEX" "$CMD_GEMINI" "$CMD_CLAUDE"

on run argv
	if (count of argv) < 4 then
		error "Need 4 args: ROOT CODEX_CMD GEMINI_CMD CLAUDE_CMD"
	end if
	set root to item 1 of argv
	set cmdCodex to item 2 of argv
	set cmdGemini to item 3 of argv
	set cmdClaude to item 4 of argv

	tell application "iTerm"
		activate
		create window with default profile

		-- Tab 1: project workspace (CSV, scripts, LARIAT, scheduling files)
		tell current session of current tab of current window
			write text "cd " & quoted form of root & " && printf '\\n\\n=== Tab 1 · Workspace · F&B datasheets & scheduling ===\\n\\n' && exec zsh -l"
		end tell

		tell current window
			create tab with default profile
		end tell
		tell current session of current tab of current window
			write text "cd " & quoted form of root & " && clear && printf '\\n=== Tab 2 · Codex ===\\n\\n' && " & cmdCodex
		end tell

		tell current window
			create tab with default profile
		end tell
		tell current session of current tab of current window
			write text "cd " & quoted form of root & " && clear && printf '\\n=== Tab 3 · Gemini ===\\n\\n' && " & cmdGemini
		end tell

		tell current window
			create tab with default profile
		end tell
		tell current session of current tab of current window
			write text "cd " & quoted form of root & " && clear && printf '\\n=== Tab 4 · Claude ===\\n\\n' && " & cmdClaude
		end tell
	end tell
end run
