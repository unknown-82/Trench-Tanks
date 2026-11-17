// Network settings for online play. This is the only file you need to edit
// to plug in your own TURN server.
window.TT = window.TT || {};
TT.NET_CONFIG = {
  // STUN lets each browser discover its public address (free, no account).
  // TURN relays the traffic when a direct connection is impossible (strict
  // mobile carriers, corporate firewalls). Without TURN roughly 1 in 10
  // connections fail on those networks.
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }

    // Option A: static TURN credentials (your own coturn, Metered, Twilio, ...):
    // , {
    //   urls: ['turn:YOUR.TURN.HOST:3478', 'turn:YOUR.TURN.HOST:443?transport=tcp', 'turns:YOUR.TURN.HOST:443'],
    //   username: 'YOUR_USERNAME',
    //   credential: 'YOUR_PASSWORD'
    // }
  ],

  // Option B: Open Relay by Metered (free tier). Sign up at
  // https://www.metered.ca/tools/openrelay/ , create an app, and paste its
  // credentials URL here. It returns a ready-made STUN+TURN list that is
  // added to ICE_SERVERS above. Leave '' to skip.
  // Example: 'https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_KEY'
  TURN_CREDENTIALS_URL: '',

  // null = the free public PeerJS signaling server (0.peerjs.com). It only
  // introduces the two browsers; game data never passes through it.
  // To self-host: { host: 'peer.example.com', port: 443, path: '/', secure: true }
  PEER_SERVER: null,

  CONNECT_TIMEOUT_MS: 15000,     // guest gives up connecting after this long
  JOIN_TIMEOUT_MS: 10000,        // host drops a connection that never says "join"
  HEARTBEAT_INTERVAL_MS: 2000,   // send a ping this often
  HEARTBEAT_TIMEOUT_MS: 10000,   // no message for this long = connection is dead
  MAX_MESSAGES_PER_SECOND: 40    // flood protection: extra messages are dropped
};
