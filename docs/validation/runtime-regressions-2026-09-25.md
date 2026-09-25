# Runtime regression checks · 2026-09-25

The main-branch quality workflow was green before this review. These cases require
state transitions that its existing smoke tests did not exercise:

- **Shared settings:** A edits a value and returns it to the original value before
  saving; B then saves a different value. A's refresh must adopt B's value without
  writing. Repeat with A's first write still in flight: its later reversal must
  reach disk. Test the sequence, not just a single successful save.
- **Focused graph signals:** Let Explore become still before first focus. The first
  emission must have real segment lengths and a nonempty route. Focus initialization
  must use current geometry even when no animation frame was previously active.
- **Local preview worker:** Build a second preview while the first worker still
  runs. A loaded .NET DLL locks its output on Windows; a green build with no worker
  does not cover this case. Check concurrent startup and cleanup of isolated output.
- **MP4 playback:** MIME support and nonempty chunks do not establish a playable
  recording. In the local Chromium preview, an in-memory canvas capture switched
  from 320×180 to 400×200. An `avc3` MP4 played to its end; video-frame callbacks
  decoded frames at both sizes. This checked the browser encoder without capturing
  the user's screen.

The browser checks cover the local preview, not native WebView2 or Windows taskbar
recovery. Those remain separate release gates.
