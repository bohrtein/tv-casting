'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var resolver = createResolverClient(APP_CONFIG);
  var nowCasting = createNowCasting();
  var chip = document.getElementById('relay-chip');
  var chipLabel = document.getElementById('relay-chip-label');

  function setRelayChip(state, label) {
    chip.setAttribute('data-mx-state', state);
    chipLabel.textContent = label;
  }

  var relay = createRelayClient(APP_CONFIG, {
    onConnected: function () { setRelayChip('busy', 'connected'); },
    onDisconnected: function () { setRelayChip('err', 'reconnecting…'); },
    onJoined: function () { setRelayChip('ok', 'connected'); },
    onStatus: function () {},
    onError: function (msg) {
      if (msg.code !== 'TV_NOT_FOUND') return;
      setRelayChip('err', 'no tv');
      MX.toast(false, 'No TV is connected right now.');
    }
  });

  var savedView = createSavedView(resolver, document.getElementById('saved-view'), {
    onCast: function (url, title) {
      if (relay.sendCommand('play', { url: url, title: title })) {
        nowCasting.set(url, title);
        MX.toast(true, 'Casting: ' + title);
      } else {
        MX.toast(false, 'Connecting to the TV. Try casting again in a moment.');
      }
    }
  });

  function refresh() {
    resolver.getCache().then(function (cache) {
      savedView.render(cache);
    }).catch(function (err) { savedView.error(err); });
  }

  relay.connect();
  refresh();
  setInterval(refresh, 3000);
});
