#!/bin/bash

# =========================================================================
# LARIAT DESKTOP APP LAUNCHER DRIVER
# =========================================================================

# AppleScript wrappers run in stripped environments. Must mount Homebrew paths manually.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Kill any existing instances mapping 3000 (Avoids EADDRINUSE crash loops)
PIDS=$(lsof -ti:3000)
if [ ! -z "$PIDS" ]; then
    kill -9 $PIDS
fi

# 2. Navigate to the absolute project workspace
cd /Users/seanburdges/Dev/Lariat

# 3. Spool the Next.js local engine entirely detached in the background
nohup npm run dev > .lariat_dev.log 2>&1 &

# 4. Give the NextJS compilation cycle enough time to hydrate
sleep 4

# 5. Trap Google Chrome in boundary-less App Mode (Looking like a native app)
open -n -a "Google Chrome" --args --app="http://localhost:3000"
