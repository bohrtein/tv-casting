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

echo === tv-casting deploy ===
echo.

echo [1/3] Pushing local commits to GitHub...
git push origin main
if errorlevel 1 (
    echo.
    echo Push failed -- fix that first. Nothing was touched on the server.
    pause
    exit /b 1
)

echo.
echo [2/3] Pulling on the server and restarting relay + resolver...
ssh -i "%SSH_KEY%" %SSH_HOST% "cd %APPHUB_CLONE% && git pull && sudo systemctl restart --no-block tv-casting-relay && sudo systemctl restart --no-block tv-casting-resolver"
if errorlevel 1 (
    echo.
    echo Something failed pulling/restarting relay or resolver -- see above.
    pause
    exit /b 1
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
echo relay, resolver, and companion are updated and restarted on the server.
echo.
echo NOTE: tv-receiver was NOT touched. If tv-receiver/ changed, rebuild +
echo resideload it yourself via the Tizen VS Code extension (Build Project,
echo then Run Project with the TV/emulator selected).
echo.
pause
