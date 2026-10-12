# Native Live foreground voice call (draft)

This is an incremental iPhone foreground call UI built on the existing Native Live
conversation, Mac Claude Agent SDK and Mind Hook. It does not create another Claude
session or memory store and does not require a database migration.

## What exists on this branch

- The composer `+` menu includes a `Call Claude` action that opens the foreground
  SwiftUI call sheet for the active authenticated canonical conversation (not drafts).
  This action remains accessible when the attachment limit is reached; attachment
  actions are disabled separately. The old top-bar call button was removed. Each call utterance carries a
  `live_call` interaction marker alongside `input_mode=voice`; Claude sees this
  marker on the existing message prompt. No separate system prompt or thread is
  introduced, and ordinary dictation keeps its original voice annotation.
- iPhone's on-device Speech recognizer transcribes user audio; a 1.5s pause
  sends the transcript through the existing Native Live `inputMode: voice`.
- After a completed canonical assistant message, the iPhone submits up to
  1,100 characters of its text to `POST /api/v1/voice/speak`.
- The existing Web API Auth0 middleware protects the endpoint. Railway calls
  ElevenLabs and returns bounded MP3 bytes. The API key and voice ID never
  appear in the app or in a model prompt.
- Audio playback automatically resumes listening. The microphone control
  can interrupt playback; hangup stops capture/playback and prevents late audio.

## Configuration (not automatically provided by an ElevenLabs connector)

Selected voice: **Robert - Business Book Narrator**, verified in the owner\'s ElevenLabs voice library.
The public voice ID is `BtWabtumIemAotTjP5sk`. The Web API uses this by default;
`ELEVENLABS_VOICE_ID` is an optional server-side override.

Set `ELEVENLABS_API_KEY` **only in the server secret store** (never GitHub or iOS).
Without an API key, the voice endpoint reports unconfigured and returns HTTP 503. The separate Claude.ai / ChatGPT ElevenLabs connector does not
grant this independently deployed Railway service API credentials. Confirm that
the chosen ElevenLabs voice is available to the API key's workspace.

The service uses ElevenLabs `eleven_multilingual_v2` and
`mp3_44100_128`; requests are text-limited, audio-bounded, time-limited, and
returned without cache storage. It must not be exposed outside the existing
authenticated `/api/v1` mount.

## Real-device acceptance required

1. From an isolated feature branch, install the intended iOS sources on the
   iPhone using Xcode. Preserve the owner's existing local signing settings.
2. Check that the active Native Live conversation and Mac Companion are ready.
3. Start a call; approve speech and microphone permissions; speak in Chinese.
4. Verify one canonical voice-labelled user turn and one completed assistant
   turn in the **same** conversation with ordinary Mind Hook behavior.
5. With Railway speech credentials configured in a non-production test
   environment, verify playback, automatic next listening, manual playback
   interruption, hangup, network errors, and permission denial.
6. Verify that nothing is transmitted before the user starts the call.
7. Run backend typecheck / speech test / applicable native contract tests, and
   do a full Xcode build. A passing TypeScript test is not an iOS build.

## Deliberate limitations

This is **not** a production-ready full-duplex call or an iPhone lock-screen
incoming call. Silence detection uses Speech recognition partial text, not
real-time VAD; simultaneous speaking/listening is not implemented. Incoming
PushKit/CallKit calls and body-sound recognition remain separate future work.
Long assistant messages are read only through their first 1,100 characters,
while the canonical written response remains complete. The selected voice ID is an explicit owner-provided default, not a guessed choice;
keep API credentials separate and allow override via Railway environment.
No production deployment, schema mutation, or main merge is authorized by this
branch alone.
