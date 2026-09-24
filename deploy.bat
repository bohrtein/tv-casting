@echo off
setlocal

rem tv-casting deploy: push local commits to GitHub, then pull + restart
rem relay/resolver/companion on the home Ubuntu server. Does NOT touch
rem tv-receiver -- that still needs a manual rebuild + resideload via the
rem Tizen VS Code extension (no Tizen CLI tooling on this machine to
rem script it).
rem
rem Server layout this script assumes (checked live on 2026-09-21):
rem   relay + resolver run from the App Hub-imported clone at
rem     /home/bortein/Desktop/github/apphub/apps/tv-casting
rem     (systemd units tv-casting-relay / tv-casting-resolver, restarted
rem     via a NOPASSWD sudoers rule already scoped to just these units)
rem   companion runs from the separate primary clone at
rem     /home/bortein/Desktop/github/tv-casting
rem     (systemd --user unit tv-casting-companion, no sudo needed)
rem If that layout ever changes on the server, update the paths below.

set SSH_KEY=%USERPROFILE%\.ssh\bortein_temp
set SSH_HOST=bortein@192.168.2.31
set APPHUB_CLONE=/home/bortein/Desktop/github/apphub/apps/tv-casting
set MAIN_CLONE=/home/bortein/Desktop/github/tv-casting
set LOCAL_REPO=C:\tv-casting

echo === tv-casting deploy ===
echo.

rem Hardcoded, not %~dp0 -- this script also lives as a Desktop shortcut
rem copy, which would otherwise try to git-push from the Desktop folder.
cd /d "%LOCAL_REPO%" || (
    echo Couldn't find the repo at %LOCAL_REPO% -- edit LOCAL_REPO at the top of this script.
    pause
    exit /b 1
)

echo [1/3] Pushing local commits to GitHub...
git push origin main
if errorlevel 1 (
    echo.
    echo Push failed -- fix that first. Nothing was touched on the server.
    pause
    exit /b 1
)

echo.
echo [2/3] Pulling on the server and restarting relay + resolver + torrent server...
ssh -i "%SSH_KEY%" %SSH_HOST% "cd %APPHUB_CLONE% && git pull && sudo systemctl restart --no-block tv-casting-relay && sudo systemctl restart --no-block tv-casting-resolver"
if errorlevel 1 (
    echo.
    echo Something failed pulling/restarting relay or resolver -- see above.
    pause
    exit /b 1
)
rem The torrent server rebuilds its Docker image from the pulled code on
rem restart. sudo -n: if the sudoers rule doesn't cover this unit yet
rem (see torrent-server/README.md, "Deploy"), say so instead of hanging
rem on a password prompt, and carry on -- it's not worth failing the
rem whole deploy over.
ssh -i "%SSH_KEY%" %SSH_HOST% "sudo -n systemctl restart --no-block tv-casting-torrent"
if errorlevel 1 (
    echo.
    echo Couldn't restart tv-casting-torrent -- add it to the sudoers rule
    echo ^(torrent-server/README.md, "Deploy"^), or restart it by hand.
)

echo.
echo [3/3] Pulling on the server and restarting companion...
ssh -i "%SSH_KEY%" %SSH_HOST% "cd %MAIN_CLONE% && git pull && systemctl --user restart tv-casting-companion"
if errorlevel 1 (
    echo.
    echo Something failed pulling/restarting companion -- see above.
    pause
    exit /b 1
)

echo.
echo === Done ===
echo relay, resolver, torrent server and companion are updated and restarted on the server.
echo.
echo NOTE: tv-receiver was NOT touched. If tv-receiver/ changed, rebuild +
echo resideload it yourself via the Tizen VS Code extension (Build Project,
echo then Run Project with the TV/emulator selected).
echo.
pause
