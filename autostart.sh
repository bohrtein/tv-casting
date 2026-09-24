#!/bin/sh
# Makes App Hub and every TV Casting service start when the server boots,
# and starts any that aren't running now. Safe to run again any time.
#
#   sh autostart.sh
#
# Asks for your sudo password once. Units that aren't installed on this
# machine are skipped with a note, not treated as errors.

SYSTEM_UNITS="apphub tv-casting-relay tv-casting-resolver tv-casting-stremio tv-casting-torrent"
USER_UNITS="tv-casting-companion"

for unit in $SYSTEM_UNITS; do
  if systemctl cat "$unit" >/dev/null 2>&1; then
    sudo systemctl enable --now "$unit" && echo "on at boot: $unit"
  else
    echo "not installed, skipped: $unit"
  fi
done

# The companion runs as a user service (systemctl --user). Those only
# start once you log in, unless lingering is on for your account.
sudo loginctl enable-linger "$(id -un)"
for unit in $USER_UNITS; do
  if systemctl --user cat "$unit" >/dev/null 2>&1; then
    systemctl --user enable --now "$unit" && echo "on at boot: $unit (user service)"
  else
    echo "not installed, skipped: $unit (user service)"
  fi
done

echo
echo "The VPN (tv-casting-vpn) has no boot setting of its own: it starts"
echo "with the Stremio server and the torrent server."
