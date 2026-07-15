# Codex Agent Office

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run local
npm run build
```

`npm run local` starts both the site and its local Codex bridge. Open the
`Local` URL printed in the terminal. Press Ctrl+C to stop both processes.

## Secure local Bridge

When the Bridge starts, it prints a six-digit pairing code. Enter that code in
the Office UI. The code is only for pairing and expires after ten minutes. The
paired session remains valid until the browser tab closes, the user disconnects,
or the Bridge stops. Pairing sessions are kept in memory and are never written
to disk.

The Bridge only accepts requests from these origins by default:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `https://codex-agent-office.dattsu.chatgpt.site`

Add trusted origins with a comma-separated environment variable:

```bash
CODEX_OFFICE_ALLOWED_ORIGINS=https://office.example.com npm run bridge
```

Every Codex task displays a native confirmation dialog on the local Mac before
execution. The Bridge binds only to `127.0.0.1`.

## Codex detection and history

The Bridge checks `CODEX_BIN`, the ChatGPT desktop app, `PATH`, and common
installation locations. To select a specific binary:

```bash
CODEX_BIN=/path/to/codex npm run bridge
```

Task and chat history is stored locally at `~/.codex/office/history.json` with
owner-only file permissions. Pairing tokens, API keys, and attachment contents
are not stored there. History survives a Bridge restart; an interrupted running
task is restored as interrupted rather than resumed.

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run local`: start the site and local Codex bridge together
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
